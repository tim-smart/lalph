import {
  Array,
  Cause,
  Config,
  Data,
  DateTime,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  FileSystem,
  Filter,
  identity,
  Iterable,
  Layer,
  Option,
  Path,
  pipe,
  Schema,
  Stream,
} from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { getOrSelectCliAgent } from "../CliAgent.ts"
import { Flag, CliError, Command } from "effect/unstable/cli"
import { checkForWork } from "../IssueSource.ts"
import { CurrentIssueSource } from "../IssueSources.ts"

const iterations = Flag.integer("iterations").pipe(
  Flag.withDescription("Number of iterations to run, defaults to unlimited"),
  Flag.withAlias("i"),
  Flag.withDefault(Number.POSITIVE_INFINITY),
)

const concurrency = Flag.integer("concurrency").pipe(
  Flag.withDescription("Number of concurrent agents, defaults to 1"),
  Flag.withAlias("c"),
  Flag.withDefault(1),
)

const targetBranch = Flag.string("target-branch").pipe(
  Flag.withDescription(
    "Target branch for PRs. Env variable: LALPH_TARGET_BRANCH",
  ),
  Flag.withAlias("b"),
  Flag.withFallbackConfig(Config.string("LALPH_TARGET_BRANCH")),
  Flag.withDefault(
    ChildProcess.make`git branch --show-current`.pipe(
      ChildProcess.string,
      Effect.orDie,
      Effect.flatMap((output) => {
        const branch = output.trim()
        return branch === ""
          ? Effect.fail(
              new CliError.MissingOption({
                option: "--target-branch",
              }),
            )
          : Effect.succeed(branch)
      }),
    ),
  ),
  Flag.optional,
)

const maxIterationMinutes = Flag.integer("max-minutes").pipe(
  Flag.withDescription(
    "Maximum number of minutes to allow an iteration to run. Defaults to 90 minutes. Env variable: LALPH_MAX_MINUTES",
  ),
  Flag.withFallbackConfig(Config.int("LALPH_MAX_MINUTES")),
  Flag.withDefault(90),
)

const stallMinutes = Flag.integer("stall-minutes").pipe(
  Flag.withDescription(
    "If no activity occurs for this many minutes, the iteration will be stopped. Defaults to 5 minutes. Env variable: LALPH_STALL_MINUTES",
  ),
  Flag.withFallbackConfig(Config.int("LALPH_STALL_MINUTES")),
  Flag.withDefault(5),
)

const specsDirectory = Flag.directory("specs").pipe(
  Flag.withDescription(
    "Directory to store plan specifications. Env variable: LALPH_SPECS",
  ),
  Flag.withAlias("s"),
  Flag.withFallbackConfig(Config.string("LALPH_SPECS")),
  Flag.withDefault(".specs"),
)

const commandPrefix = Flag.string("command-prefix").pipe(
  Flag.withDescription(
    `Prefix to add before the agent command (i.e. "docker sandbox run"). Env variable: LALPH_COMMAND_PREFIX`,
  ),
  Flag.withAlias("p"),
  Flag.withFallbackConfig(Config.string("LALPH_COMMAND_PREFIX")),
  Flag.map((s) => {
    const parts = s
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0)
    return Array.isArrayNonEmpty(parts)
      ? ChildProcess.prefix(parts[0], parts.slice(1))
      : identity
  }),
  Flag.withDefault(identity<ChildProcess.Command>),
)

// handled in cli.ts
const reset = Flag.boolean("reset").pipe(
  Flag.withDescription("Reset the current issue source before running"),
  Flag.withAlias("r"),
)

export const commandRoot = Command.make("lalph", {
  iterations,
  concurrency,
  targetBranch,
  maxIterationMinutes,
  stallMinutes,
  reset,
  specsDirectory,
  commandPrefix,
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({
      iterations,
      concurrency,
      targetBranch,
      maxIterationMinutes,
      stallMinutes,
      specsDirectory,
      commandPrefix,
    }) {
      const source = yield* Layer.build(CurrentIssueSource.layer)
      yield* getOrSelectCliAgent

      const isFinite = Number.isFinite(iterations)
      const iterationsDisplay = isFinite ? iterations : "unlimited"
      const runConcurrency = Math.max(1, concurrency)
      const semaphore = Effect.makeSemaphoreUnsafe(runConcurrency)
      const fibers = yield* FiberSet.make()

      yield* Effect.log(
        `Executing ${iterationsDisplay} iteration(s) with concurrency ${runConcurrency}`,
      )

      let iteration = 0
      let quit = false

      while (true) {
        yield* semaphore.take(1)
        if (quit || (isFinite && iteration >= iterations)) {
          break
        }

        const currentIteration = iteration

        const startedDeferred = yield* Deferred.make<void>()

        yield* checkForWork.pipe(
          Effect.andThen(
            run({
              startedDeferred,
              targetBranch,
              specsDirectory,
              stallTimeout: Duration.minutes(stallMinutes),
              runTimeout: Duration.minutes(maxIterationMinutes),
              commandPrefix,
            }),
          ),
          Effect.catchFilter(
            (e) =>
              e._tag === "NoMoreWork" || e._tag === "QuitError"
                ? Filter.fail(e)
                : e,
            (e) => Effect.logWarning(Cause.fail(e)),
          ),
          Effect.catchTags({
            NoMoreWork(_) {
              if (isFinite) {
                // If we have a finite number of iterations, we exit when no more
                // work is found
                iterations = currentIteration
                return Effect.log(
                  `No more work to process, ending after ${currentIteration} iteration(s).`,
                )
              }
              const log =
                Iterable.size(fibers) <= 1
                  ? Effect.log("No more work to process, waiting 30 seconds...")
                  : Effect.void
              return Effect.andThen(log, Effect.sleep(Duration.seconds(30)))
            },
            QuitError(_) {
              quit = true
              return Effect.void
            },
          }),
          Effect.annotateLogs({
            iteration: currentIteration,
          }),
          Effect.ensuring(semaphore.release(1)),
          Effect.ensuring(Deferred.completeWith(startedDeferred, Effect.void)),
          Effect.provide(source),
          FiberSet.run(fibers),
        )

        yield* Deferred.await(startedDeferred)

        iteration++
      }

      yield* FiberSet.awaitEmpty(fibers)
    }, Effect.scoped),
  ),
)

const run = Effect.fnUntraced(
  function* (options: {
    readonly startedDeferred: Deferred.Deferred<void>
    readonly targetBranch: Option.Option<string>
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly commandPrefix: (
      command: ChildProcess.Command,
    ) => ChildProcess.Command
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd

    const exec = (
      template: TemplateStringsArray,
      ...args: Array<string | number | boolean>
    ) =>
      ChildProcess.make({
        cwd: worktree.directory,
      })(template, ...args).pipe(ChildProcess.exitCode)

    const execWithStallTimeout = Effect.fnUntraced(function* (
      command: ChildProcess.Command,
    ) {
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

      const handle = yield* command

      yield* handle.all.pipe(
        Stream.runForEachArray((output) => {
          lastOutputAt = DateTime.nowUnsafe()
          for (const chunk of output) {
            process.stdout.write(chunk)
          }
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
        Effect.flatMap((output) =>
          Option.some(output.trim()).pipe(
            Option.filter((b) => b.length > 0),
            Effect.fromOption,
          ),
        ),
      )

    if (Option.isSome(options.targetBranch)) {
      yield* exec`git checkout ${`origin/${options.targetBranch.value}`}`
    }

    yield* Effect.gen(function* () {
      let taskId: string | undefined = undefined
      let taskGithubPrNumber: number | undefined = undefined
      yield* Effect.addFinalizer(
        Effect.fnUntraced(function* (exit) {
          if (exit._tag === "Success") return
          const prd = yield* Prd
          if (taskId) {
            yield* prd.maybeRevertIssue({
              issueId: taskId,
            })
          } else {
            yield* prd.revertUpdatedIssues
          }
        }, Effect.ignore),
      )

      yield* pipe(
        cliAgent.command({
          prompt: promptGen.promptChoose,
          prdFilePath: pathService.join(".lalph", "prd.yml"),
          outputMode: "inherit",
        }),
        ChildProcess.setCwd(worktree.directory),
        options.commandPrefix,
        ChildProcess.exitCode,
        Effect.timeoutOrElse({
          duration: options.stallTimeout,
          onTimeout: () => Effect.fail(new RunnerStalled()),
        }),
      )

      const taskJson = yield* fs.readFileString(
        pathService.join(worktree.directory, ".lalph", "task.json"),
      )
      const chosenTask = yield* Schema.decodeEffect(ChosenTask)(taskJson)
      taskId = chosenTask.id
      taskGithubPrNumber = chosenTask.githubPrNumber ?? undefined

      yield* Deferred.completeWith(options.startedDeferred, Effect.void)

      const cliCommand = pipe(
        cliAgent.command({
          outputMode: "pipe",
          prompt: promptGen.prompt({
            taskId,
            targetBranch: Option.getOrUndefined(options.targetBranch),
            specsDirectory: options.specsDirectory,
            githubPrNumber: taskGithubPrNumber,
          }),
          prdFilePath: pathService.join(".lalph", "prd.yml"),
        }),
        ChildProcess.setCwd(worktree.directory),
        options.commandPrefix,
      )

      const exitCode = yield* execWithStallTimeout(cliCommand).pipe(
        Effect.timeout(options.runTimeout),
        Effect.catchTag(
          "TimeoutError",
          Effect.fnUntraced(function* (error) {
            const timeoutCommand = pipe(
              cliAgent.command({
                outputMode: "pipe",
                prompt: promptGen.promptTimeout({
                  taskId,
                }),
                prdFilePath: pathService.join(".lalph", "prd.yml"),
              }),
              ChildProcess.setCwd(worktree.directory),
              options.commandPrefix,
            )
            yield* execWithStallTimeout(timeoutCommand)
            return yield* error
          }),
        ),
      )
      yield* Effect.log(`Agent exited with code: ${exitCode}`)

      const prs = yield* prd.mergableGithubPrs
      const task = yield* prd.findById(taskId)
      if (prs.length === 0) {
        yield* prd.maybeRevertIssue({ issueId: taskId })
      } else if (task?.autoMerge) {
        for (const pr of prs) {
          if (Option.isSome(options.targetBranch)) {
            yield* exec`gh pr edit ${pr.prNumber} --base ${options.targetBranch.value}`
          }

          const exitCode = yield* exec`gh pr merge ${pr.prNumber} -sd`
          if (exitCode !== 0) {
            yield* prd.flagUnmergable({ issueId: pr.issueId })
          }
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const currentBranchName = yield* currentBranch(
            worktree.directory,
          ).pipe(Effect.option, Effect.map(Option.getOrUndefined))
          if (!currentBranchName) return

          // enter detached state
          yield* exec`git checkout --detach ${currentBranchName}`
          // delete the branch
          yield* exec`git branch -D ${currentBranchName}`
        }).pipe(Effect.ignore),
      ),
    )
  },
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer]),
)

class RunnerStalled extends Data.TaggedError("RunnerStalled") {
  readonly message = "The runner has stalled due to inactivity."
}

const ChosenTask = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    githubPrNumber: Schema.NullOr(Schema.Finite),
  }),
)
