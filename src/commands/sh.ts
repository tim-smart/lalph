import { Command } from "effect/unstable/cli"
import { Effect, FileSystem, Layer, Path } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "../Prd.ts"
import { Worktree } from "../Worktree.ts"
import { layerProjectIdPrompt } from "../Projects.ts"
import { resolveLalphDirectory } from "../shared/lalphDirectory.ts"

export const commandSh = Command.make("sh").pipe(
  Command.withDescription(
    "Launch an interactive shell in the active project's worktree.",
  ),
  Command.withHandler(
    Effect.fnUntraced(
      function* () {
        const worktree = yield* Worktree
        const fs = yield* FileSystem.FileSystem
        const pathService = yield* Path.Path
        const lalphDirectory = yield* resolveLalphDirectory

        // link to lalph config
        yield* fs.symlink(
          pathService.join(lalphDirectory, ".lalph", "config"),
          pathService.join(worktree.directory, ".lalph", "config"),
        )
        yield* fs.symlink(
          pathService.join(lalphDirectory, ".lalph", "projects"),
          pathService.join(worktree.directory, ".lalph", "projects"),
        )

        yield* ChildProcess.make(process.env.SHELL || "/bin/bash", [], {
          cwd: worktree.directory,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }).pipe(ChildProcess.exitCode)
      },
      Effect.scoped,
      Effect.provide(
        Prd.layerProvided.pipe(Layer.provideMerge(layerProjectIdPrompt)),
      ),
    ),
  ),
)
