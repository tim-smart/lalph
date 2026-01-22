import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "./IssueSources.ts"
import { Effect, FileSystem, Layer, Path } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "./Prd.ts"
import { Worktree } from "./Worktree.ts"

export const enterShell = Command.make("shell").pipe(
  Command.withDescription("Enter an interactive shell in the worktree"),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const worktree = yield* Worktree
        const fs = yield* FileSystem.FileSystem
        const pathService = yield* Path.Path

        // link to lalph config
        yield* fs.symlink(
          pathService.resolve(pathService.join(".lalph", "config")),
          pathService.join(worktree.directory, ".lalph", "config"),
        )

        yield* ChildProcess.make(process.env.SHELL || "/bin/bash", [], {
          cwd: worktree.directory,
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
