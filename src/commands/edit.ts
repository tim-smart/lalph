import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { Config, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "../Prd.ts"

export const commandEdit = Command.make("edit").pipe(
  Command.withDescription("Open the prd.yml file in your editor"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const prd = yield* Prd
        const editor = yield* Config.string("LALPH_EDITOR").pipe(
          Config.orElse(() => Config.string("EDITOR")),
          Config.withDefault(() => "nvim"),
        )

        yield* ChildProcess.make(editor, [prd.path], {
          extendEnv: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }).pipe(ChildProcess.exitCode)
      },
      Effect.scoped,
      Effect.provide(
        Prd.layerLocal.pipe(Layer.provide(CurrentIssueSource.layer)),
      ),
    ),
  ),
)
