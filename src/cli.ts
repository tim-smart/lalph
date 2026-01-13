#!/usr/bin/env node

import { Command, Flag } from "effect/unstable/cli"
import { Effect, Layer, Option } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { CurrentProject, labelSelect, Linear } from "./Linear.ts"
import { layerKvs } from "./Kvs.ts"
import { Settings } from "./Settings.ts"
import { run, selectCliAgent } from "./Runner.ts"

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
  Flag.withAlias("i"),
  Flag.withDefault(Number.POSITIVE_INFINITY),
)

const concurrency = Flag.integer("concurrency").pipe(
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

      yield* Effect.log(
        `Executing ${iterationsDisplay} iteration(s) with concurrency ${runConcurrency}`,
      )

      let iteration = 0

      while (true) {
        yield* semaphore.take(1)
        if (isFinite && iteration >= iterations) {
          break
        }

        const currentIteration = iteration

        yield* run.pipe(
          Effect.catchTag("NoMoreWork", (e) => {
            if (isFinite) {
              // If we have a finite number of iterations, we exit when no more
              // work is found
              iterations = currentIteration
              return Effect.fail(e)
            }
            return Effect.log(
              "No more work to process, waiting 30 seconds...",
            ).pipe(Effect.andThen(Effect.sleep("30 seconds")))
          }),
          Effect.catchCause(Effect.logWarning),
          Effect.annotateLogs({
            iteration: currentIteration,
          }),
          Effect.ensuring(semaphore.release(1)),
          Effect.forkChild,
        )
        iteration++
      }
    }),
  ),
  Command.withSubcommands([selectProject, selectLabel, selectAgent]),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(
  Effect.provide(
    Layer.mergeAll(Settings.layer, Linear.layer).pipe(
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
  NodeRuntime.runMain,
)
