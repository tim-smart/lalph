import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect"
import { ChildProcess } from "effect/unstable/process"

export class Worktree extends ServiceMap.Service<Worktree>()("lalph/Worktree", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
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

    const setupPath = pathService.resolve(
      pathService.join("scripts", "worktree-setup.sh"),
    )
    if (yield* fs.exists(setupPath)) {
      yield* ChildProcess.make({
        cwd: directory,
        extendEnv: true,
        shell: process.env.SHELL ?? true,
      })`${setupPath}`.pipe(ChildProcess.exitCode)
    }

    return { directory } as const
  }),
}) {
  static layer = Layer.effect(this, this.make)
  static layerLocal = Layer.effect(
    this,
    Effect.gen(function* () {
      const pathService = yield* Path.Path
      const directory = pathService.resolve(".")
      return { directory } as const
    }),
  )
}

const execIgnore = (command: ChildProcess.Command) =>
  command.pipe(ChildProcess.exitCode, Effect.catchCause(Effect.logWarning))
