#!/usr/bin/env node

import { Command, Flag } from "effect/unstable/cli"
import {
  Cause,
  DateTime,
  Effect,
  FiberSet,
  Filter,
  Layer,
  Option,
} from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { CurrentProject, labelSelect, Linear } from "./Linear.ts"
import { layerKvs } from "./Kvs.ts"
import { Settings } from "./Settings.ts"
import { run, selectCliAgent } from "./Runner.ts"
import { RateLimiter } from "effect/unstable/persistence"

const selectProject = Command.make("select-project").pipe(
  Command.withDescription("Select the current Linear project"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const project = yield* CurrentProject.select
        yield* Effect.log(
          `Selected Linear Project: ${project.name} (${project.id})`,
        )
      },
      Effect.provide([layerKvs, Linear.layer]),
    ),
  ),
)

const selectLabel = Command.make("select-label").pipe(
  Command.withDescription("Select the label to filter issues by"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const label = yield* labelSelect
      yield* Effect.log(
        `Selected Label: ${Option.match(label, {
          onNone: () => "No Label",
          onSome: (l) => l.name,
        })}`,
      )
    }),
  ),
)

const selectAgent = Command.make("select-agent").pipe(
  Command.withDescription("Select the CLI agent to use"),
  Command.withHandler(() => selectCliAgent),
)

const iterations = Flag.integer("iterations").pipe(
  Flag.withDescription("Number of iterations to run, defaults to unlimited"),
  Flag.withAlias("i"),
  Flag.withDefault(Number.POSITIVE_INFINITY),
)

const concurrency = Flag.integer("concurrency").pipe(
  Flag.withDescription("Number of concurrent agents, defaults to 1"),
  Flag.withAlias("c"),
  Flag.withDefault(1),
)

const root = Command.make("lalph", { iterations, concurrency }).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ iterations, concurrency }) {
      const isFinite = Number.isFinite(iterations)
      const iterationsDisplay = isFinite ? iterations : "unlimited"
      const runConcurrency = Math.max(1, concurrency)
      const semaphore = Effect.makeSemaphoreUnsafe(runConcurrency)
      const limiter = yield* RateLimiter.makeSleep
      const fibers = yield* FiberSet.make()

      yield* Effect.log(
        `Executing ${iterationsDisplay} iteration(s) with concurrency ${runConcurrency}`,
      )

      let iteration = 0
      let lastStartedAt = DateTime.makeUnsafe(0)
      let inProgress = 0
      let quit = false

      while (true) {
        yield* semaphore.take(1)
        if (quit || (isFinite && iteration >= iterations)) {
          break
        }

        const currentIteration = iteration

        if (inProgress > 0) {
          yield* limiter({
            key: "lalph-runner",
            algorithm: "fixed-window",
            limit: 1,
            window: "30 seconds",
          })
        }

        lastStartedAt = yield* DateTime.now
        inProgress++

        yield* run.pipe(
          Effect.catchFilter(
            (e) =>
              e._tag === "NoMoreWork" || e._tag === "QuitError"
                ? Filter.fail(e)
                : e,
            (e) => Effect.logWarning(Cause.fail(e)),
          ),
          Effect.catchTags({
            NoMoreWork(_) {
              if (isFinite) {
                // If we have a finite number of iterations, we exit when no more
                // work is found
                iterations = currentIteration
                return Effect.log(
                  `No more work to process, ending after ${currentIteration} iteration(s).`,
                )
              }
              return Effect.log(
                "No more work to process, waiting 30 seconds...",
              ).pipe(Effect.andThen(Effect.sleep("30 seconds")))
            },
            QuitError(_) {
              quit = true
              return Effect.void
            },
          }),
          Effect.annotateLogs({
            iteration: currentIteration,
          }),
          Effect.ensuring(
            Effect.suspend(() => {
              inProgress--
              return semaphore.release(1)
            }),
          ),
          FiberSet.run(fibers),
        )
        iteration++
      }

      yield* FiberSet.awaitEmpty(fibers)
    }, Effect.scoped),
  ),
  Command.withSubcommands([selectProject, selectLabel, selectAgent]),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      Settings.layer,
      Linear.layer,
      RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)),
    ).pipe(Layer.provideMerge(NodeServices.layer)),
  ),
  NodeRuntime.runMain,
)
