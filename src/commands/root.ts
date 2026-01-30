import {
  Cause,
  Config,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  FileSystem,
  Filter,
  Iterable,
  Option,
  Path,
} from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { getCommandPrefix, getOrSelectCliAgent } from "./agent.ts"
import { Flag, CliError, Command } from "effect/unstable/cli"
import { IssueSource } from "../IssueSource.ts"
import {
  checkForWork,
  CurrentIssueSource,
  resetInProgress,
} from "../IssueSources.ts"
import { GithubCli } from "../Github/Cli.ts"
import { agentWorker } from "../Agents/worker.ts"
import { agentChooser } from "../Agents/chooser.ts"
import { RunnerStalled } from "../domain/Errors.ts"
import { agentReviewer } from "../Agents/reviewer.ts"
import { agentTimeout } from "../Agents/timeout.ts"
import { Settings } from "../Settings.ts"
import { Atom, AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import {
  activeWorkerLoggingAtom,
  CurrentWorkerState,
  withWorkerState,
} from "../Workers.ts"
import { WorkerStatus } from "../domain/WorkerState.ts"
import { GitFlow, GitFlowCommit, GitFlowPR } from "../GitFlow.ts"
import { parseBranch } from "../shared/git.ts"

// Main iteration run logic

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
    readonly review: boolean
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const gh = yield* GithubCli
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd
    const source = yield* IssueSource
    const gitFlow = yield* GitFlow
    const currentWorker = yield* CurrentWorkerState
    const registry = yield* AtomRegistry.AtomRegistry

    if (Option.isSome(options.targetBranch)) {
      const parsed = parseBranch(options.targetBranch.value)
      const code = yield* worktree.exec`git checkout ${parsed.branchWithRemote}`
      if (code !== 0) {
        yield* worktree.exec`git checkout -b ${parsed.branch}`
        yield* worktree.exec`git push -u ${parsed.remote} ${parsed.branch}`
      }
    }
    if (gitFlow.branch) {
      yield* worktree.exec`git checkout -b ${gitFlow.branch}`
    }

    // ensure cleanup of branch after run
    yield* Effect.addFinalizer(
      Effect.fnUntraced(function* () {
        const currentBranchName = yield* worktree
          .currentBranch(worktree.directory)
          .pipe(Effect.option, Effect.map(Option.getOrUndefined))
        if (!currentBranchName) return

        // enter detached state
        yield* worktree.exec`git checkout --detach ${currentBranchName}`
        // delete the branch
        yield* worktree.exec`git branch -D ${currentBranchName}`
      }, Effect.ignore()),
    )

    let taskId: string | undefined = undefined

    // setup finalizer to revert issue if we fail
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
      }, Effect.ignore()),
    )

    // 1. Choose task
    // --------------

    registry.update(currentWorker.state, (s) =>
      s.transitionTo(WorkerStatus.ChoosingTask()),
    )

    const chosenTask = yield* agentChooser({
      stallTimeout: options.stallTimeout,
      commandPrefix: options.commandPrefix,
      cliAgent,
    }).pipe(Effect.withSpan("Main.agentChooser"))
    taskId = chosenTask.id
    yield* prd.setChosenIssueId(taskId)

    yield* source.ensureInProgress(taskId).pipe(
      Effect.timeoutOrElse({
        duration: "1 minute",
        onTimeout: () => Effect.fail(new RunnerStalled()),
      }),
    )

    yield* Deferred.completeWith(options.startedDeferred, Effect.void)

    if (gitFlow.requiresGithubPr && chosenTask.githubPrNumber) {
      yield* worktree.exec`gh pr checkout ${chosenTask.githubPrNumber}`
      const feedback = yield* gh.prFeedbackMd(chosenTask.githubPrNumber)
      yield* fs.writeFileString(
        pathService.join(worktree.directory, ".lalph", "feedback.md"),
        feedback,
      )
    }

    yield* Effect.gen(function* () {
      //
      // 2. Work on task
      // -----------------------

      registry.update(currentWorker.state, (s) =>
        s.transitionTo(WorkerStatus.Working({ issueId: taskId })),
      )

      const promptGen = yield* PromptGen
      const instructions = promptGen.prompt({
        specsDirectory: options.specsDirectory,
        targetBranch: Option.getOrUndefined(options.targetBranch),
        task: chosenTask.prd,
        githubPrNumber: chosenTask.githubPrNumber ?? undefined,
        gitFlow,
      })

      const exitCode = yield* agentWorker({
        stallTimeout: options.stallTimeout,
        cliAgent,
        commandPrefix: options.commandPrefix,
        prompt: instructions,
      }).pipe(Effect.withSpan("Main.agentWorker"))
      yield* Effect.log(`Agent exited with code: ${exitCode}`)

      // 3. Review task
      // -----------------------

      if (options.review) {
        registry.update(currentWorker.state, (s) =>
          s.transitionTo(WorkerStatus.Reviewing({ issueId: taskId })),
        )

        yield* agentReviewer({
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          cliAgent,
          commandPrefix: options.commandPrefix,
          instructions,
        }).pipe(Effect.withSpan("Main.agentReviewer"))
      }
    }).pipe(
      Effect.timeout(options.runTimeout),
      Effect.tapErrorTag("TimeoutError", () =>
        agentTimeout({
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          cliAgent,
          commandPrefix: options.commandPrefix,
          task: chosenTask.prd,
        }),
      ),
    )

    yield* gitFlow.postWork({
      worktree,
      targetBranch: Option.getOrUndefined(options.targetBranch),
      issueId: taskId,
    })

    const task = yield* prd.findById(taskId)
    if (task?.autoMerge) {
      yield* gitFlow.autoMerge({
        targetBranch: Option.getOrUndefined(options.targetBranch),
        issueId: taskId,
        worktree,
      })
    } else {
      yield* prd.maybeRevertIssue({ issueId: taskId })
    }
  },
  Effect.scoped,
  Effect.provide(Prd.layer, { local: true }),
)

// Command

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
    "Target branch for PRs. Defaults to current branch. Env variable: LALPH_TARGET_BRANCH",
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

const commitMode = Flag.boolean("commit").pipe(
  Flag.withDescription("Commit to the target branch instead of creating PRs"),
)

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription("Enable verbose logging"),
  Flag.withAlias("v"),
)

const review = Flag.boolean("review").pipe(
  Flag.withDescription(
    "Enabled the AI peer-review step. Will use LALPH_REVIEW.md if present.",
  ),
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
  commitMode,
  reset,
  review,
  specsDirectory,
  verbose,
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(
      function* ({
        iterations,
        concurrency,
        targetBranch,
        maxIterationMinutes,
        stallMinutes,
        specsDirectory,
        review,
        commitMode,
      }) {
        const commandPrefix = yield* getCommandPrefix
        yield* getOrSelectCliAgent

        const isFinite = Number.isFinite(iterations)
        const iterationsDisplay = isFinite ? iterations : "unlimited"
        const runConcurrency = Math.max(1, concurrency)
        const semaphore = Effect.makeSemaphoreUnsafe(runConcurrency)
        const fibers = yield* FiberSet.make()

        yield* resetInProgress.pipe(Effect.withSpan("Main.resetInProgress"))

        yield* Effect.log(
          `Executing ${iterationsDisplay} iteration(s) with concurrency ${runConcurrency}`,
        )
        if (Option.isSome(targetBranch)) {
          yield* Effect.log(`Using target branch: ${targetBranch.value}`)
        }

        let iteration = 0
        let quit = false

        yield* Atom.mount(activeWorkerLoggingAtom)

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
                review,
              }).pipe(
                Effect.provide(commitMode ? GitFlowCommit : GitFlowPR, {
                  local: true,
                }),
                withWorkerState(currentIteration),
              ),
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
                    ? Effect.log(
                        "No more work to process, waiting 30 seconds...",
                      )
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
            Effect.ensuring(
              Deferred.completeWith(startedDeferred, Effect.void),
            ),
            FiberSet.run(fibers),
          )

          yield* Deferred.await(startedDeferred)

          iteration++
        }

        yield* FiberSet.awaitEmpty(fibers)
      },
      Effect.scoped,
      Effect.provide([
        PromptGen.layer,
        GithubCli.layer,
        Settings.layer,
        CurrentIssueSource.layer,
        AtomRegistry.layer,
        Reactivity.layer,
      ]),
    ),
  ),
)
