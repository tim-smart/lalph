import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "./IssueSources.ts"
import { Config, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "./Prd.ts"

export const editPrd = Command.make("edit").pipe(
  Command.withDescription("Open the prd.yml file in your editor"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const prd = yield* Prd
        const editor = yield* Config.string("EDITOR").pipe(
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
