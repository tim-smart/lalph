import {
  Config,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  FileSystem,
  identity,
  Iterable,
  Option,
  Path,
  PlatformError,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { Worktree } from "../Worktree.ts"
import { Flag, Command, Prompt } from "effect/unstable/cli"
import { IssueSource, IssueSourceError } from "../IssueSource.ts"
import {
  checkForWork,
  CurrentIssueSource,
  currentIssuesAtom,
  resetInProgress,
} from "../CurrentIssueSource.ts"
import { GithubCli } from "../Github/Cli.ts"
import { agentWorker } from "../Agents/worker.ts"
import { agentChooser, ChosenTaskNotFound } from "../Agents/chooser.ts"
import { RunnerStalled, TaskStateChanged } from "../domain/Errors.ts"
import { agentReviewer } from "../Agents/reviewer.ts"
import { agentTimeout } from "../Agents/timeout.ts"
import { CurrentProjectId, Settings } from "../Settings.ts"
import { Atom, AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import {
  activeWorkerLoggingAtom,
  CurrentWorkerState,
  withWorkerState,
} from "../Workers.ts"
import { WorkerStatus } from "../domain/WorkerState.ts"
import { GitFlow, GitFlowCommit, GitFlowError, GitFlowPR } from "../GitFlow.ts"
import { getAllProjects, welcomeWizard } from "../Projects.ts"
import type { Project } from "../domain/Project.ts"
import { getDefaultCliAgentPreset } from "../Presets.ts"
import { ChosenTaskDeferred } from "../TaskTools.ts"
import { ClankaModels, type ClankaModel } from "../ClankaModels.ts"
import { runClanka } from "../Clanka.ts"
import type { QuitError } from "effect/Terminal"
import type { TimeoutError } from "effect/Cause"
import type { ChildProcessSpawner } from "effect/unstable/process"
import type { AiError } from "effect/unstable/ai"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import type { PrdIssue } from "../domain/PrdIssue.ts"

const runChosenTask = Effect.fnUntraced(function* (options: {
  readonly taskId: string
  readonly task: PrdIssue
  readonly githubPrNumber: number | undefined
  readonly targetBranch: Option.Option<string>
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly runTimeout: Duration.Duration
  readonly review: boolean
  readonly revertIssueOnSuccess: boolean
  readonly taskPreset: CliAgentPreset
  readonly getTask: (
    taskId: string,
  ) => Effect.Effect<
    PrdIssue | null,
    PlatformError.PlatformError | IssueSourceError
  >
}) {
  const worktree = yield* Worktree
  const gitFlow = yield* GitFlow
  const currentWorker = yield* CurrentWorkerState
  const registry = yield* AtomRegistry.AtomRegistry
  const promptGen = yield* PromptGen
  const prd = yield* Prd
  const models = yield* ClankaModels

  yield* prd.setChosenIssueId(options.taskId)
  yield* prd.setAutoMerge(options.task.autoMerge)

  const catchStallInReview = <A, E, R>(
    effect: Effect.Effect<A, E | RunnerStalled, R>,
  ) =>
    Effect.catchIf(
      effect,
      (u): u is RunnerStalled => u instanceof RunnerStalled,
      Effect.fnUntraced(function* (e) {
        const task = yield* options.getTask(options.taskId)
        const inReview = task?.state === "in-review"
        if (inReview) return
        return yield* e
      }),
    )

  const clankaModel = options.taskPreset.clankaModel
    ? models.get(options.taskPreset.clankaModel)
    : undefined

  const timeoutEffect = identity<
    Effect.Effect<
      void,
      | AiError.AiError
      | PlatformError.PlatformError
      | RunnerStalled
      | IssueSourceError,
      | AtomRegistry.AtomRegistry
      | CurrentWorkerState
      | Path.Path
      | PromptGen
      | Worktree
      | ChildProcessSpawner.ChildProcessSpawner
      | CurrentProjectId
      | FileSystem.FileSystem
      | IssueSource
    >
  >(
    clankaModel
      ? runClanka({
          directory: worktree.directory,
          system: promptGen.systemClanka(options),
          prompt: promptGen.promptTimeoutClanka({
            taskId: options.taskId,
            specsDirectory: options.specsDirectory,
          }),
          stallTimeout: options.stallTimeout,
        }).pipe(Effect.provide(clankaModel), Effect.withSpan("Main.timeout"))
      : agentTimeout({
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          preset: options.taskPreset,
          task: options.task,
        }).pipe(Effect.asVoid),
  )

  const cancelled = yield* Effect.gen(function* () {
    registry.update(currentWorker.state, (s) =>
      s.transitionTo(WorkerStatus.Working({ issueId: options.taskId })),
    )

    if (clankaModel) {
      const instructions = promptGen.promptClanka({
        specsDirectory: options.specsDirectory,
        targetBranch: Option.getOrUndefined(options.targetBranch),
        task: options.task,
        githubPrNumber: options.githubPrNumber,
        gitFlow,
      })

      yield* runClanka({
        directory: worktree.directory,
        system: promptGen.systemClanka(options),
        prompt: instructions,
        stallTimeout: options.stallTimeout,
      }).pipe(Effect.provide(clankaModel), Effect.withSpan("Main.worker"))

      if (options.review) {
        registry.update(currentWorker.state, (s) =>
          s.transitionTo(WorkerStatus.Reviewing({ issueId: options.taskId })),
        )

        yield* runClanka({
          directory: worktree.directory,
          system: promptGen.systemClanka(options),
          prompt: promptGen.promptReview({
            prompt: instructions,
            gitFlow,
          }),
        }).pipe(
          Effect.provide(clankaModel),
          catchStallInReview,
          Effect.withSpan("Main.review"),
        )
      }

      return
    }

    const instructions = promptGen.prompt({
      specsDirectory: options.specsDirectory,
      targetBranch: Option.getOrUndefined(options.targetBranch),
      task: options.task,
      githubPrNumber: options.githubPrNumber,
      gitFlow,
    })

    const exitCode = yield* agentWorker({
      stallTimeout: options.stallTimeout,
      preset: options.taskPreset,
      prompt: instructions,
    }).pipe(catchStallInReview, Effect.withSpan("Main.agentWorker"))
    yield* Effect.log(`Agent exited with code: ${exitCode}`)

    if (options.review) {
      registry.update(currentWorker.state, (s) =>
        s.transitionTo(WorkerStatus.Reviewing({ issueId: options.taskId })),
      )

      yield* agentReviewer({
        specsDirectory: options.specsDirectory,
        stallTimeout: options.stallTimeout,
        preset: options.taskPreset,
        instructions,
      }).pipe(catchStallInReview, Effect.withSpan("Main.agentReviewer"))
    }
  }).pipe(
    Effect.timeout(options.runTimeout),
    Effect.tapErrorTag("TimeoutError", () => timeoutEffect),
    Effect.raceFirst(watchTaskState({ issueId: options.taskId })),
    Effect.as(false),
    Effect.catchTag("TaskStateChanged", (error) =>
      Effect.log(
        `Task ${error.issueId} moved to ${error.state}; cancelling run.`,
      ).pipe(Effect.as(true)),
    ),
  )

  if (cancelled) return

  yield* gitFlow.postWork({
    worktree,
    targetBranch: Option.getOrUndefined(options.targetBranch),
    issueId: options.taskId,
  })

  const task = yield* options.getTask(options.taskId)
  if (task?.autoMerge) {
    yield* gitFlow.autoMerge({
      targetBranch: Option.getOrUndefined(options.targetBranch),
      issueId: options.taskId,
      worktree,
    })
  } else if (options.revertIssueOnSuccess) {
    yield* prd.maybeRevertIssue({ issueId: options.taskId })
  }
})

// Main iteration run logic

const run = Effect.fnUntraced(
  function* (options: {
    readonly defaultPreset: CliAgentPreset
    readonly startedDeferred: Deferred.Deferred<void>
    readonly targetBranch: Option.Option<string>
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly review: boolean
  }): Effect.fn.Return<
    void,
    | PlatformError.PlatformError
    | Schema.SchemaError
    | IssueSourceError
    | QuitError
    | GitFlowError
    | ChosenTaskNotFound
    | RunnerStalled
    | TimeoutError
    | AiError.AiError,
    | CurrentProjectId
    | ChildProcessSpawner.ChildProcessSpawner
    | Settings
    | Reactivity.Reactivity
    | GithubCli
    | IssueSource
    | Prompt.Environment
    | AtomRegistry.AtomRegistry
    | GitFlow
    | CurrentWorkerState
    | PromptGen
    | Prd
    | Worktree
    | ClankaModels
    | Scope.Scope
  > {
    const projectId = yield* CurrentProjectId
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const gh = yield* GithubCli
    const prd = yield* Prd
    const source = yield* IssueSource
    const gitFlow = yield* GitFlow
    const currentWorker = yield* CurrentWorkerState
    const registry = yield* AtomRegistry.AtomRegistry

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
        if (taskId) {
          yield* source.updateIssue({
            projectId,
            issueId: taskId,
            state: "todo",
          })
        } else {
          const prd = yield* Prd
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
      preset: options.defaultPreset,
    }).pipe(Effect.withSpan("Main.agentChooser"))

    taskId = chosenTask.id
    yield* source.updateIssue({
      projectId,
      issueId: taskId,
      state: "in-progress",
    })

    yield* source.ensureInProgress(projectId, taskId).pipe(
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

    const taskPreset = Option.getOrElse(
      yield* source.issueCliAgentPreset(chosenTask.prd),
      () => options.defaultPreset,
    )

    yield* runChosenTask({
      taskId,
      task: chosenTask.prd,
      githubPrNumber: chosenTask.githubPrNumber ?? undefined,
      targetBranch: options.targetBranch,
      specsDirectory: options.specsDirectory,
      stallTimeout: options.stallTimeout,
      runTimeout: options.runTimeout,
      review: options.review,
      revertIssueOnSuccess: true,
      taskPreset,
      getTask: (taskId) => prd.findById(taskId),
    })
  },
  Effect.scoped,
  Effect.provide(Prd.layer, { local: true }),
)

const runWithClanka = Effect.fnUntraced(
  function* (options: {
    readonly defaultPreset: CliAgentPreset & {
      readonly clankaModel: ClankaModel
    }
    readonly startedDeferred: Deferred.Deferred<void>
    readonly targetBranch: Option.Option<string>
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly review: boolean
  }): Effect.fn.Return<
    void,
    | PlatformError.PlatformError
    | Schema.SchemaError
    | IssueSourceError
    | GitFlowError
    | ChosenTaskNotFound
    | RunnerStalled
    | TimeoutError
    | AiError.AiError
    | QuitError,
    | CurrentProjectId
    | FileSystem.FileSystem
    | Path.Path
    | Worktree
    | ChildProcessSpawner.ChildProcessSpawner
    | GithubCli
    | IssueSource
    | AtomRegistry.AtomRegistry
    | GitFlow
    | CurrentWorkerState
    | PromptGen
    | ClankaModels
    | Scope.Scope
    | Prd
  > {
    const projectId = yield* CurrentProjectId
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const gh = yield* GithubCli
    const source = yield* IssueSource
    const gitFlow = yield* GitFlow
    const currentWorker = yield* CurrentWorkerState
    const registry = yield* AtomRegistry.AtomRegistry
    const promptGen = yield* PromptGen
    const models = yield* ClankaModels
    const model = models.get(options.defaultPreset.clankaModel)

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
        if (taskId) {
          yield* source.updateIssue({
            projectId,
            issueId: taskId,
            state: "todo",
          })
        }
      }, Effect.ignore()),
    )

    const taskById = (taskId: string) =>
      AtomRegistry.getResult(registry, currentIssuesAtom(projectId)).pipe(
        Effect.map(
          (issues) => issues.find((entry) => entry.id === taskId) ?? null,
        ),
      )

    // 1. Choose task
    // --------------

    registry.update(currentWorker.state, (s) =>
      s.transitionTo(WorkerStatus.ChoosingTask()),
    )

    const deferred = ChosenTaskDeferred.of(Deferred.makeUnsafe())
    const chooseResult = yield* runClanka({
      directory: worktree.directory,
      prompt: promptGen.promptChooseClanka({ gitFlow }),
      stallTimeout: options.stallTimeout,
      withChoose: true,
    }).pipe(
      Effect.andThen(Effect.fail(new ChosenTaskNotFound())),
      Effect.provideService(ChosenTaskDeferred, deferred),
      Effect.provide(model),
      Effect.raceFirst(Deferred.await(deferred)),
      Effect.withSpan("Main.choose"),
    )

    const chosenTask = yield* taskById(chooseResult.taskId)
    if (!chosenTask) {
      return yield* new ChosenTaskNotFound()
    }
    taskId = chooseResult.taskId
    yield* source.updateIssue({
      projectId,
      issueId: taskId,
      state: "in-progress",
    })

    yield* source.ensureInProgress(projectId, taskId).pipe(
      Effect.timeoutOrElse({
        duration: "1 minute",
        onTimeout: () => Effect.fail(new RunnerStalled()),
      }),
    )

    yield* Deferred.completeWith(options.startedDeferred, Effect.void)

    if (gitFlow.requiresGithubPr && chooseResult.githubPrNumber) {
      yield* worktree.exec`gh pr checkout ${chooseResult.githubPrNumber}`
      const feedback = yield* gh.prFeedbackMd(chooseResult.githubPrNumber)
      yield* fs.writeFileString(
        pathService.join(worktree.directory, ".lalph", "feedback.md"),
        feedback,
      )
    }

    const taskPreset = Option.getOrElse(
      yield* source.issueCliAgentPreset(chosenTask),
      () => options.defaultPreset,
    )

    yield* runChosenTask({
      taskId,
      task: chosenTask,
      githubPrNumber: chooseResult.githubPrNumber ?? undefined,
      targetBranch: options.targetBranch,
      specsDirectory: options.specsDirectory,
      stallTimeout: options.stallTimeout,
      runTimeout: options.runTimeout,
      review: options.review,
      revertIssueOnSuccess: false,
      taskPreset,
      getTask: taskById,
    })
  },
  Effect.scoped,
  Effect.provide(Prd.layer, { local: true }),
)

type RunEffects = ReturnType<typeof run> | ReturnType<typeof runWithClanka>
type RunEffect = Effect.Effect<
  void,
  Effect.Error<RunEffects>,
  Effect.Services<RunEffects>
>

const runProject = Effect.fnUntraced(
  function* (options: {
    readonly iterations: number
    readonly project: Project
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly defaultPreset: CliAgentPreset
  }) {
    const isFinite = Number.isFinite(options.iterations)
    const iterationsDisplay = isFinite ? options.iterations : "unlimited"
    const semaphore = Semaphore.makeUnsafe(options.project.concurrency)
    const fibers = yield* FiberSet.make()

    yield* resetInProgress.pipe(Effect.withSpan("Main.resetInProgress"))

    yield* Effect.log(
      `Executing ${iterationsDisplay} iteration(s) with concurrency ${options.project.concurrency}`,
    )

    let iterations = options.iterations
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
          identity<RunEffect>(
            options.defaultPreset.clankaModel
              ? runWithClanka({
                  defaultPreset: options.defaultPreset as CliAgentPreset & {
                    readonly clankaModel: ClankaModel
                  },
                  startedDeferred,
                  targetBranch: options.project.targetBranch,
                  specsDirectory: options.specsDirectory,
                  stallTimeout: options.stallTimeout,
                  runTimeout: options.runTimeout,
                  review: options.project.reviewAgent,
                })
              : run({
                  defaultPreset: options.defaultPreset,
                  startedDeferred,
                  targetBranch: options.project.targetBranch,
                  specsDirectory: options.specsDirectory,
                  stallTimeout: options.stallTimeout,
                  runTimeout: options.runTimeout,
                  review: options.project.reviewAgent,
                }),
          ).pipe(
            Effect.provide(
              options.project.gitFlow === "commit" ? GitFlowCommit : GitFlowPR,
              { local: true },
            ),
            withWorkerState(options.project.id),
          ),
        ),
        (_) => _,
        Effect.catchTags({
          NoMoreWork(_error) {
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
          QuitError(_error) {
            quit = true
            return Effect.void
          },
        }),
        Effect.catchCause((cause) =>
          Effect.logWarning(cause).pipe(
            Effect.andThen(Effect.sleep(Duration.seconds(10))),
          ),
        ),
        Effect.ensuring(semaphore.release(1)),
        Effect.ensuring(Deferred.completeWith(startedDeferred, Effect.void)),
        FiberSet.run(fibers),
      )

      yield* Deferred.await(startedDeferred)

      iteration++
    }

    yield* FiberSet.awaitEmpty(fibers)
  },
  (effect, options) =>
    Effect.annotateLogs(effect, {
      project: options.project.id,
    }),
)

// Command

const iterations = Flag.integer("iterations").pipe(
  Flag.withDescription(
    "Limit how many task iterations run per enabled project (default: unlimited). Use -i 1 to run a single iteration and exit.",
  ),
  Flag.withAlias("i"),
  Flag.withDefault(Number.POSITIVE_INFINITY),
)

const maxIterationMinutes = Flag.integer("max-minutes").pipe(
  Flag.withDescription(
    "Timeout an iteration if execution (and review, if enabled) exceeds this many minutes (default: LALPH_MAX_MINUTES or 90).",
  ),
  Flag.withFallbackConfig(Config.int("LALPH_MAX_MINUTES")),
  Flag.withDefault(90),
)

const stallMinutes = Flag.integer("stall-minutes").pipe(
  Flag.withDescription(
    "Fail an iteration if the agent stops responding for this many minutes (default: LALPH_STALL_MINUTES or 5).",
  ),
  Flag.withFallbackConfig(Config.int("LALPH_STALL_MINUTES")),
  Flag.withDefault(5),
)

const specsDirectory = Flag.directory("specs").pipe(
  Flag.withDescription(
    "Directory where plan specs are written and read (default: LALPH_SPECS or .specs).",
  ),
  Flag.withAlias("s"),
  Flag.withFallbackConfig(Config.string("LALPH_SPECS")),
  Flag.withDefault(".specs"),
)

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription(
    "Increase log output for debugging. Use -v when you need detailed logs.",
  ),
  Flag.withAlias("v"),
)

export const commandRoot = Command.make("lalph", {
  iterations,
  maxIterationMinutes,
  stallMinutes,
}).pipe(
  Command.withSharedFlags({
    specsDirectory,
    verbose,
  }),
  Command.withDescription(
    "Run the task loop across all enabled projects in parallel: pull issues from the current issue source and execute them with your configured agent preset(s). Use --iterations for a bounded run, and configure per-project concurrency via lalph projects edit.",
  ),
  Command.withHandler(
    Effect.fnUntraced(
      function* ({
        iterations,
        maxIterationMinutes,
        stallMinutes,
        specsDirectory,
      }) {
        const preset = yield* getDefaultCliAgentPreset

        let allProjects = yield* getAllProjects
        if (allProjects.length === 0) {
          yield* welcomeWizard
          allProjects = yield* getAllProjects
        }

        const projects = allProjects.filter((p) => p.enabled)
        if (projects.length === 0) {
          return yield* Effect.log(
            "No enabled projects found. Run 'lalph projects toggle' to enable one.",
          )
        }
        yield* Effect.forEach(
          projects,
          (project) =>
            runProject({
              iterations,
              project,
              specsDirectory,
              stallTimeout: Duration.minutes(stallMinutes),
              runTimeout: Duration.minutes(maxIterationMinutes),
              defaultPreset: preset,
            }).pipe(Effect.provideService(CurrentProjectId, project.id)),
          { concurrency: "unbounded", discard: true },
        )
      },
      Effect.scoped,
      Effect.provide([
        ClankaModels.layer,
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

const watchTaskState = Effect.fnUntraced(function* (options: {
  readonly issueId: string
}) {
  const registry = yield* AtomRegistry.AtomRegistry
  const projectId = yield* CurrentProjectId

  yield* Effect.sleep(Duration.seconds(10))

  return yield* AtomRegistry.toStreamResult(
    registry,
    currentIssuesAtom(projectId),
  ).pipe(
    Stream.runForEach((issues) => {
      const issue = issues.find((entry) => entry.id === options.issueId)
      if (!issue) {
        return Effect.fail(
          new TaskStateChanged({
            issueId: options.issueId,
            state: "missing",
          }),
        )
      }
      if (issue.state === "in-progress" || issue.state === "in-review") {
        return Effect.void
      }
      return Effect.fail(
        new TaskStateChanged({
          issueId: options.issueId,
          state: issue.state,
        }),
      )
    }),
    Effect.withSpan("Main.watchTaskState"),
  )
})
