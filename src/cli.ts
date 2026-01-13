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
  Flag.withDefault(1),
)

const concurrency = Flag.integer("concurrency").pipe(
  Flag.withAlias("c"),
  Flag.withDefault(1),
)

const root = Command.make("lalph", { iterations, concurrency }).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ iterations, concurrency }) {
      const runConcurrency = Math.max(1, concurrency)
      yield* Effect.log(
        `Executing ${iterations} iteration(s) with concurrency ${runConcurrency}`,
      )

      const runs = Array.from({ length: iterations })
      yield* Effect.forEach(runs, () => run, {
        concurrency: runConcurrency,
      })
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
