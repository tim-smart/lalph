import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Prd } from "./Prd.ts"

export class Worktree extends ServiceMap.Service<Worktree>()("lalph/Worktree", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const prd = yield* Prd

    const inExisting = yield* fs.exists(pathService.join(".lalph", "worktree"))
    if (inExisting) {
      const directory = pathService.resolve(".")
      return { directory, inExisting } as const
    }

    const directory = yield* fs.makeTempDirectory()

    yield* Effect.addFinalizer(
      Effect.fnUntraced(function* () {
        yield* execIgnore(
          ChildProcess.make`git worktree remove --force ${directory}`,
        )
      }),
    )

    yield* ChildProcess.make`git worktree add ${directory} -d HEAD`.pipe(
      ChildProcess.exitCode,
    )

    yield* fs.makeDirectory(pathService.join(directory, ".lalph"), {
      recursive: true,
    })
    yield* Effect.scoped(
      fs.open(pathService.join(directory, ".lalph", "worktree"), {
        flag: "a+",
      }),
    )
    yield* fs.symlink(
      prd.path,
      pathService.join(directory, ".lalph", "prd.yml"),
    )

    const setupPath = pathService.resolve("scripts", "worktree-setup.sh")
    yield* seedSetupScript(setupPath)
    if (yield* fs.exists(setupPath)) {
      yield* ChildProcess.make({
        cwd: directory,
        extendEnv: true,
        shell: process.env.SHELL ?? true,
      })`${setupPath}`.pipe(ChildProcess.exitCode)
    }

    return { directory, inExisting } as const
  }),
}) {
  static layer = Layer.effect(this, this.make)
  static layerLocal = Layer.effect(
    this,
    Effect.gen(function* () {
      const pathService = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const directory = pathService.resolve(".")
      return {
        directory,
        inExisting: yield* fs.exists(pathService.join(".lalph", "prd.yml")),
      } as const
    }),
  )
}

const execIgnore = (command: ChildProcess.Command) =>
  command.pipe(ChildProcess.exitCode, Effect.catchCause(Effect.logWarning))

const seedSetupScript = Effect.fnUntraced(function* (setupPath: string) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path

  if (yield* fs.exists(setupPath)) {
    return
  }

  const baseBranch = yield* discoverBaseBranch

  yield* fs.makeDirectory(pathService.dirname(setupPath), {
    recursive: true,
  })
  yield* fs.writeFileString(setupPath, setupScriptTemplate(baseBranch))
  yield* fs.chmod(setupPath, 0o755)
})

const discoverBaseBranch = Effect.gen(function* () {
  const originHead =
    yield* ChildProcess.make`git symbolic-ref --short refs/remotes/origin/HEAD`.pipe(
      ChildProcess.string,
      Effect.catch((_) => Effect.succeed("")),
      Effect.map((output) => output.trim()),
    )

  if (originHead !== "") {
    return originHead.startsWith("origin/")
      ? originHead.slice("origin/".length)
      : originHead
  }

  const currentBranch =
    yield* ChildProcess.make`git branch --show-current`.pipe(
      ChildProcess.string,
      Effect.catch((_) => Effect.succeed("")),
      Effect.map((output) => output.trim()),
    )

  return currentBranch === "" ? "main" : currentBranch
})

const setupScriptTemplate = (baseBranch: string) => `#!/usr/bin/env bash
set -euo pipefail

git fetch origin
git checkout origin/${baseBranch}

# Seeded by lalph. Customize this to prepare new worktrees.
`
