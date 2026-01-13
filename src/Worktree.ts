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

    yield* execIgnore(ChildProcess.make`git pull`)
    yield* ChildProcess.make`git worktree add ${directory} -d HEAD`.pipe(
      ChildProcess.exitCode,
    )

    yield* fs.makeDirectory(pathService.join(directory, ".lalph"), {
      recursive: true,
    })
    yield* Effect.scoped(
      fs.open(pathService.join(directory, "PROGRESS.md"), {
        flag: "a+",
      }),
    )

    const setupPath = pathService.join(process.cwd(), ".lalph", "setup.sh")
    if (yield* fs.exists(setupPath)) {
      yield* ChildProcess.make({
        cwd: directory,
        extendEnv: true,
        shell: process.env.SHELL ?? true,
      })`${setupPath}`.pipe(ChildProcess.exitCode)
    }

    yield* Effect.forEach(
      [
        ChildProcess.make({
          cwd: directory,
          extendEnv: true,
          shell: process.env.SHELL ?? true,
        })`direnv allow`,
        ChildProcess.make({
          cwd: directory,
          extendEnv: true,
          shell: process.env.SHELL ?? true,
        })`devenv allow`,
        ChildProcess.make({
          cwd: directory,
        })`git submodule update --init --recursive`,
      ],
      execIgnore,
      { concurrency: "unbounded" },
    )

    return { directory } as const
  }),
}) {
  static layer = Layer.effect(this, this.make)
}

const execIgnore = (command: ChildProcess.Command) =>
  command.pipe(ChildProcess.exitCode, Effect.catchCause(Effect.logWarning))
