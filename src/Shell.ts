import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "./IssueSources.ts"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "./Prd.ts"

export const enterShell = Command.make("shell").pipe(
  Command.withDescription("Enter an interactive shell in the worktree"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        yield* ChildProcess.make(process.env.SHELL || "/bin/bash", [], {
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
