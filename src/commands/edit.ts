import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "../Prd.ts"
import { configEditor } from "../shared/config.ts"

export const commandEdit = Command.make("edit").pipe(
  Command.withDescription("Open the prd.yml file in your editor"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const prd = yield* Prd
        const editor = yield* configEditor

        yield* ChildProcess.make(editor[0]!, [...editor.slice(1), prd.path], {
          extendEnv: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }).pipe(ChildProcess.exitCode)
      },
      Effect.scoped,
      Effect.provide(Prd.layer.pipe(Layer.provide(CurrentIssueSource.layer))),
    ),
  ),
)
