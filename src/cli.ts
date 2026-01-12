import { Command, Flag } from "effect/unstable/cli"
import { Effect, Option } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { CurrentProject, labelSelect, Linear } from "./Linear.ts"
import { layerKvs } from "./Kvs.ts"
import { Settings } from "./Settings.ts"
import { run } from "./Runner.ts"

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
      Effect.provide([layerKvs, Linear.layer, Settings.layer]),
    ),
  ),
)

const selectLabel = Command.make("select-label").pipe(
  Command.withDescription("Select the label to filter issues by"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const label = yield* labelSelect
        yield* Effect.log(
          `Selected Label: ${Option.match(label, {
            onNone: () => "No Label",
            onSome: (l) => l.name,
          })}`,
        )
      },
      Effect.provide([Linear.layer, Settings.layer]),
    ),
  ),
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
  Command.withSubcommands([selectProject, selectLabel]),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
