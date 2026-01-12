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
    }, Effect.provide(Linear.layer)),
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

const root = Command.make("lalph", { iterations }).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ iterations }) {
      yield* Effect.log(`Executing ${iterations} iteration(s)`)

      for (let i = 0; i < iterations; i++) {
        yield* run
      }
    }),
  ),
  Command.withSubcommands([selectProject, selectLabel, selectAgent]),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(
  Effect.provide(Settings.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain,
)
