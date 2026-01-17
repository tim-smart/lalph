#!/usr/bin/env node

import { Command, Flag } from "effect/unstable/cli"
import { Cause, Duration, Effect, FiberSet, Filter, Layer } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Settings } from "./Settings.ts"
import { run } from "./Runner.ts"
import { RateLimiter } from "effect/unstable/persistence"
import { plan, planContinue } from "./Planner.ts"
import { getOrSelectCliAgent, selectCliAgent } from "./CliAgent.ts"
import { CurrentIssueSource, selectIssueSource } from "./IssueSources.ts"
import { checkForWork } from "./IssueSource.ts"

const selectAgent = Command.make("agent").pipe(
  Command.withDescription("Select the CLI agent to use"),
  Command.withHandler(() => selectCliAgent),
)

const selectSource = Command.make("source").pipe(
  Command.withDescription("Select the issue source to use"),
  Command.withHandler(() => selectIssueSource),
)

const planMode = Command.make("plan").pipe(
  Command.withDescription("Iterate on an issue plan and create PRD tasks"),
  Command.withHandler(() => plan),
  Command.provide(CurrentIssueSource.layer),
)

const planModeContinue = Command.make("plan-continue").pipe(
  Command.withDescription("Iterate on an issue plan and create PRD tasks"),
  Command.withHandler(() => planContinue),
  Command.provide(CurrentIssueSource.layer),
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

const autoMerge = Flag.boolean("auto-merge").pipe(
  Flag.withAlias("a"),
  Flag.withDescription("Automatically merge eligible PRs"),
)

const targetBranch = Flag.string("target-branch").pipe(
  Flag.withDescription("Target branch for PRs"),
  Flag.withAlias("b"),
  Flag.optional,
)

const maxIterationMinutes = Flag.integer("max-minutes").pipe(
  Flag.withDescription(
    "Maximum number of minutes to allow an iteration to run",
  ),
  Flag.withDefault(60),
)

const stallMinutes = Flag.integer("stall-minutes").pipe(
  Flag.withDescription(
    "If no activity occurs for this many minutes, the iteration will be stopped",
  ),
  Flag.withDefault(5),
)

const root = Command.make("lalph", {
  iterations,
  concurrency,
  autoMerge,
  targetBranch,
  maxIterationMinutes,
  stallMinutes,
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({
      iterations,
      concurrency,
      autoMerge,
      targetBranch,
      maxIterationMinutes,
      stallMinutes,
    }) {
      yield* getOrSelectCliAgent

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

        inProgress++

        yield* checkForWork.pipe(
          Effect.andThen(
            run({
              autoMerge,
              targetBranch,
              stallTimeout: Duration.minutes(stallMinutes),
            }),
          ),
          Effect.timeout(Duration.minutes(maxIterationMinutes)),
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
  Command.provide(CurrentIssueSource.layer),
  Command.withSubcommands([
    planMode,
    planModeContinue,
    selectSource,
    selectAgent,
  ]),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      Settings.layer,
      RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)),
    ).pipe(Layer.provideMerge(NodeServices.layer)),
  ),
  NodeRuntime.runMain,
)
