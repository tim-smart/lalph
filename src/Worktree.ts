import {
  Chunk,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  flow,
  identity,
  Layer,
  Option,
  Path,
  Schema,
  ServiceMap,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { RunnerStalled } from "./domain/Errors.ts"
import type { CliAgent } from "./domain/CliAgent.ts"
import { constWorkerMaxOutputChunks, CurrentWorkerState } from "./Workers.ts"
import { AtomRegistry } from "effect/unstable/reactivity"

export class Worktree extends ServiceMap.Service<Worktree>()("lalph/Worktree", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path

    const inExisting = yield* fs.exists(pathService.join(".lalph", "prd.yml"))
    if (inExisting) {
      const directory = pathService.resolve(".")
      return {
        directory,
        inExisting,
        ...(yield* makeExecHelpers({ directory })),
      } as const
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

    const setupPath = pathService.resolve("scripts", "worktree-setup.sh")
    yield* seedSetupScript(setupPath)
    if (yield* fs.exists(setupPath)) {
      yield* ChildProcess.make({
        cwd: directory,
        extendEnv: true,
        shell: process.env.SHELL ?? true,
      })`${setupPath}`.pipe(ChildProcess.exitCode)
    }

    return {
      directory,
      inExisting,
      ...(yield* makeExecHelpers({ directory })),
    } as const
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
        ...(yield* makeExecHelpers({ directory })),
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

const makeExecHelpers = Effect.fnUntraced(function* (options: {
  readonly directory: string
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const provide = Effect.provideService(
    ChildProcessSpawner.ChildProcessSpawner,
    spawner,
  )

  const exec = (
    template: TemplateStringsArray,
    ...args: Array<string | number | boolean>
  ) =>
    ChildProcess.make({
      cwd: options.directory,
    })(template, ...args).pipe(ChildProcess.exitCode, provide)

  const execString = (
    template: TemplateStringsArray,
    ...args: Array<string | number | boolean>
  ) =>
    ChildProcess.make({
      cwd: options.directory,
    })(template, ...args).pipe(ChildProcess.string, provide)

  const viewPrState = (prNumber?: number) =>
    execString`gh pr view ${prNumber ? prNumber : ""} --json number,state`.pipe(
      Effect.flatMap(Schema.decodeEffect(PrState)),
      Effect.option,
      provide,
    )

  const execWithWorkerOutput = (options: { readonly cliAgent: CliAgent }) =>
    Effect.fnUntraced(function* (command: ChildProcess.Command) {
      const registry = yield* AtomRegistry.AtomRegistry
      const worker = yield* CurrentWorkerState

      const handle = yield* provide(command.asEffect())

      yield* handle.all.pipe(
        Stream.decodeText(),
        options.cliAgent.outputTransformer
          ? options.cliAgent.outputTransformer
          : identity,
        Stream.runForEachArray((output) => {
          for (const chunk of output) {
            process.stdout.write(chunk)
          }
          registry.update(
            worker.output,
            flow(
              Chunk.appendAll(Chunk.fromArrayUnsafe(output)),
              Chunk.takeRight(constWorkerMaxOutputChunks),
            ),
          )
          return Effect.void
        }),
      )
      return yield* handle.exitCode
    }, Effect.scoped)

  const execWithStallTimeout = (options: {
    readonly stallTimeout: Duration.Duration
    readonly cliAgent: CliAgent
  }) =>
    Effect.fnUntraced(function* (command: ChildProcess.Command) {
      const registry = yield* AtomRegistry.AtomRegistry
      const worker = yield* CurrentWorkerState
      let lastOutputAt = yield* DateTime.now

      const stallTimeout = Effect.suspend(function loop(): Effect.Effect<
        never,
        RunnerStalled
      > {
        const now = DateTime.nowUnsafe()
        const deadline = DateTime.addDuration(
          lastOutputAt,
          options.stallTimeout,
        )
        if (DateTime.isLessThan(deadline, now)) {
          return Effect.fail(new RunnerStalled())
        }
        const timeUntilDeadline = DateTime.distanceDuration(deadline, now)
        return Effect.flatMap(Effect.sleep(timeUntilDeadline), loop)
      })

      const handle = yield* provide(command.asEffect())

      yield* handle.all.pipe(
        Stream.decodeText(),
        options.cliAgent.outputTransformer
          ? options.cliAgent.outputTransformer
          : identity,
        Stream.runForEachArray((output) => {
          lastOutputAt = DateTime.nowUnsafe()
          for (const chunk of output) {
            process.stdout.write(chunk)
          }
          registry.update(
            worker.output,
            flow(
              Chunk.appendAll(Chunk.fromArrayUnsafe(output)),
              Chunk.takeRight(constWorkerMaxOutputChunks),
            ),
          )
          return Effect.void
        }),
        Effect.raceFirst(stallTimeout),
      )
      return yield* handle.exitCode
    }, Effect.scoped)

  const currentBranch = (dir: string) =>
    ChildProcess.make({
      cwd: dir,
    })`git branch --show-current`.pipe(
      ChildProcess.string,
      provide,
      Effect.flatMap((output) =>
        Option.some(output.trim()).pipe(
          Option.filter((b) => b.length > 0),
          Effect.fromOption,
        ),
      ),
    )

  return {
    exec,
    execString,
    viewPrState,
    execWithStallTimeout,
    execWithWorkerOutput,
    currentBranch,
  } as const
})

const PrState = Schema.fromJsonString(
  Schema.Struct({
    number: Schema.Finite,
    state: Schema.String,
  }),
)
