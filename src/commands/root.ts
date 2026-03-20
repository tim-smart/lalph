import {
  Config,
  Data,
  Deferred,
  Duration,
  Effect,
  Fiber,
  FiberSet,
  FileSystem,
  Iterable,
  Layer,
  MutableRef,
  Option,
  Path,
  PlatformError,
  Result,
  Schedule,
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
import { allProjects, CurrentProjectId, Settings } from "../Settings.ts"
import { Atom, AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import {
  activeWorkerLoggingAtom,
  CurrentWorkerState,
  withWorkerState,
} from "../Workers.ts"
import { WorkerStatus } from "../domain/WorkerState.ts"
import {
  GitFlow,
  GitFlowCommit,
  GitFlowError,
  GitFlowPR,
  GitFlowRalph,
} from "../GitFlow.ts"
import { getAllProjects, welcomeWizard } from "../Projects.ts"
import type { Project } from "../domain/Project.ts"
import { getDefaultCliAgentPreset } from "../Presets.ts"
import type { QuitError } from "effect/Terminal"
import type { TimeoutError } from "effect/Cause"
import type { ChildProcessSpawner } from "effect/unstable/process"
import type { AiError } from "effect/unstable/ai/AiError"
import type { PrdIssue } from "../domain/PrdIssue.ts"
import { CurrentTaskRef } from "../TaskTools.ts"
import type { OutputFormatter } from "clanka"
import { ClankaMuxerLayer, SemanticSearchLayer } from "../Clanka.ts"
import { agentResearcher } from "../Agents/researcher.ts"
import { agentChooserRalph } from "../Agents/chooserRalph.ts"
import { CurrentTask } from "../domain/CurrentTask.ts"

// Main iteration run logic

const run = Effect.fnUntraced(
  function* (options: {
    readonly startedDeferred: Deferred.Deferred<void>
    readonly targetBranch: Option.Option<string>
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly research: boolean
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
    | AiError,
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
    | OutputFormatter.Muxer
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

    const preset = yield* getDefaultCliAgentPreset

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
      preset,
    }).pipe(Effect.withSpan("Main.agentChooser"))

    taskId = chosenTask.id
    yield* source.updateIssue({
      projectId,
      issueId: taskId,
      state: "in-progress",
    })
    yield* prd.setChosenIssueId(taskId)
    yield* prd.setAutoMerge(chosenTask.prd.autoMerge)

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
    } else if (gitFlow.requiresGithubPr) {
      const branchName = `lalph/${taskId.replace(/#/g, "").replace(/[^a-zA-Z0-9-_]/g, "-")}`
      yield* worktree.exec`git branch -D ${branchName}`
      yield* worktree.exec`git checkout -b ${branchName}`
    }

    const taskPreset = Option.getOrElse(
      yield* source.issueCliAgentPreset(chosenTask.prd),
      () => preset,
    )

    const catchStallInReview = <A, E, R>(
      effect: Effect.Effect<A, E | RunnerStalled, R>,
    ) =>
      Effect.catchIf(
        effect,
        (u): u is RunnerStalled => u instanceof RunnerStalled,
        Effect.fnUntraced(function* (e) {
          const task = yield* prd.findById(taskId!)
          const inReview = task?.state === "in-review"
          if (inReview) return
          return yield* e
        }),
      )

    const cancelled = yield* Effect.gen(function* () {
      //
      // 2. Work on task
      // -----------------------

      registry.update(currentWorker.state, (s) =>
        s.transitionTo(WorkerStatus.Working({ issueId: taskId })),
      )

      let researchResult = Option.none<string>()
      if (options.research) {
        researchResult = yield* agentResearcher({
          task: chosenTask.prd,
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          preset: taskPreset,
        })
      }

      const promptGen = yield* PromptGen
      const instructions = taskPreset.cliAgent.command
        ? promptGen.prompt({
            specsDirectory: options.specsDirectory,
            targetBranch: Option.getOrUndefined(options.targetBranch),
            task: chosenTask.prd,
            githubPrNumber: chosenTask.githubPrNumber ?? undefined,
            gitFlow,
          })
        : promptGen.promptClanka({
            specsDirectory: options.specsDirectory,
            targetBranch: Option.getOrUndefined(options.targetBranch),
            task: chosenTask.prd,
            githubPrNumber: chosenTask.githubPrNumber ?? undefined,
            gitFlow,
          })

      const issueRef = MutableRef.make(
        chosenTask.prd.update({
          state: "in-progress",
        }),
      )
      const steer = yield* taskUpdateSteer({
        issueId: taskId,
        current: issueRef,
      })

      const exitCode = yield* agentWorker({
        stallTimeout: options.stallTimeout,
        system: promptGen.systemClanka(options),
        preset: taskPreset,
        prompt: instructions,
        research: researchResult,
        steer,
        currentTask: CurrentTask.task({ task: chosenTask.prd }),
      }).pipe(
        Effect.provideService(CurrentTaskRef, issueRef),
        catchStallInReview,
        Effect.withSpan("Main.agentWorker"),
      )
      yield* Effect.log(`Agent exited with code: ${exitCode}`)

      // 3. Review task
      // -----------------------

      if (options.review) {
        yield* source.updateIssue({
          projectId,
          issueId: taskId,
          state: "in-progress",
        })

        registry.update(currentWorker.state, (s) =>
          s.transitionTo(WorkerStatus.Reviewing({ issueId: taskId })),
        )

        yield* agentReviewer({
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          preset: taskPreset,
          instructions,
          currentTask: CurrentTask.task({ task: chosenTask.prd }),
        }).pipe(catchStallInReview, Effect.withSpan("Main.agentReviewer"))

        yield* source.updateIssue({
          projectId,
          issueId: taskId,
          state: "in-review",
        })
      }
    }).pipe(
      Effect.timeout(options.runTimeout),
      Effect.tapErrorTag("TimeoutError", () =>
        agentTimeout({
          specsDirectory: options.specsDirectory,
          stallTimeout: options.stallTimeout,
          preset: taskPreset,
          currentTask: CurrentTask.task({ task: chosenTask.prd }),
        }),
      ),
      Effect.raceFirst(watchTaskState({ issueId: taskId })),
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
  Effect.provide(SemanticSearchLayer.pipe(Layer.provideMerge(Prd.layer)), {
    local: true,
  }),
)

const runRalph = Effect.fnUntraced(
  function* (options: {
    readonly targetBranch: Option.Option<string>
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly research: boolean
    readonly review: boolean
    readonly specFile: string
    readonly maxContext: number | undefined
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
    | AiError,
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
    | OutputFormatter.Muxer
    | Scope.Scope
  > {
    const worktree = yield* Worktree
    const gitFlow = yield* GitFlow
    const currentWorker = yield* CurrentWorkerState
    const registry = yield* AtomRegistry.AtomRegistry
    const projectId = yield* CurrentProjectId

    const preset = yield* getDefaultCliAgentPreset

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

    // 1. Choose task
    // --------------

    registry.update(currentWorker.state, (s) =>
      s.transitionTo(WorkerStatus.ChoosingTask()),
    )

    const chosenTask = yield* agentChooserRalph({
      stallTimeout: options.stallTimeout,
      preset,
      specFile: options.specFile,
    }).pipe(
      Effect.tapErrorTag(
        "ChosenTaskNotFound",
        Effect.fnUntraced(function* () {
          // Disable project when all tasks are done
          yield* Settings.update(
            allProjects,
            Option.map((projects) =>
              projects.map((p) =>
                p.id === projectId ? p.update({ enabled: false }) : p,
              ),
            ),
          )
        }),
      ),
      Effect.withSpan("Main.chooser"),
    )

    yield* Effect.gen(function* () {
      //
      // 2. Work on task
      // -----------------------

      registry.update(currentWorker.state, (s) =>
        s.transitionTo(WorkerStatus.Working({ issueId: "ralph" })),
      )

      let researchResult = Option.none<string>()
      // if (options.research) {
      //   researchResult = yield* agentResearcher({
      //     task: chosenTask.prd,
      //     specsDirectory: options.specsDirectory,
      //     stallTimeout: options.stallTimeout,
      //     preset: taskPreset,
      //   })
      // }

      const promptGen = yield* PromptGen
      const instructions = promptGen.promptRalph({
        task: chosenTask,
        specFile: options.specFile,
        targetBranch: Option.getOrUndefined(options.targetBranch),
        gitFlow,
      })

      const exitCode = yield* agentWorker({
        stallTimeout: options.stallTimeout,
        preset,
        prompt: instructions,
        research: researchResult,
        maxContext: options.maxContext,
        currentTask: CurrentTask.ralph({
          task: chosenTask,
          specFile: options.specFile,
        }),
      }).pipe(Effect.withSpan("Main.worker"))
      yield* Effect.log(`Agent exited with code: ${exitCode}`)

      // 3. Review task
      // -----------------------

      if (options.review) {
        registry.update(currentWorker.state, (s) =>
          s.transitionTo(WorkerStatus.Reviewing({ issueId: "ralph" })),
        )

        yield* agentReviewer({
          specsDirectory: "",
          stallTimeout: options.stallTimeout,
          preset,
          instructions,
          currentTask: CurrentTask.ralph({
            task: chosenTask,
            specFile: options.specFile,
          }),
        }).pipe(Effect.withSpan("Main.review"))
      }
    }).pipe(
      Effect.timeout(options.runTimeout),
      Effect.tapErrorTag("TimeoutError", () =>
        agentTimeout({
          specsDirectory: "",
          stallTimeout: options.stallTimeout,
          preset,
          currentTask: CurrentTask.ralph({
            task: chosenTask,
            specFile: options.specFile,
          }),
        }),
      ),
    )

    yield* gitFlow.postWork({
      worktree,
      targetBranch: Option.getOrUndefined(options.targetBranch),
      issueId: "",
    })
  },
  Effect.scoped,
  Effect.provide(
    SemanticSearchLayer.pipe(
      Layer.provideMerge([Prd.layerNoop, Worktree.layer]),
    ),
    { local: true },
  ),
)

class RalphSpecMissing extends Data.TaggedError("RalphSpecMissing")<{
  readonly projectId: Project["id"]
}> {
  readonly message = `Project "${this.projectId}" is configured with gitFlow="ralph" but is missing "ralphSpec". Run 'lalph projects edit' and set "Path to Ralph spec file".`
}

type ProjectExecutionMode =
  | {
      readonly _tag: "standard"
      readonly gitFlow: "pr" | "commit"
    }
  | {
      readonly _tag: "ralph"
      readonly specFile: string
    }

const runProject = Effect.fnUntraced(
  function* (options: {
    readonly iterations: number
    readonly project: Project
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
    readonly maxContext: number | undefined
  }) {
    const isFinite = Number.isFinite(options.iterations)
    const iterationsDisplay = isFinite ? options.iterations : "unlimited"
    const semaphore = Semaphore.makeUnsafe(options.project.concurrency)
    const fibers = yield* FiberSet.make()

    let executionMode: ProjectExecutionMode
    if (options.project.gitFlow === "ralph") {
      if (!options.project.ralphSpec) {
        return yield* new RalphSpecMissing({
          projectId: options.project.id,
        })
      }
      executionMode = {
        _tag: "ralph",
        specFile: options.project.ralphSpec,
      }
    } else {
      executionMode = {
        _tag: "standard",
        gitFlow: options.project.gitFlow,
      }
    }

    const resolveGitFlowLayer = () => {
      if (executionMode._tag === "ralph") {
        return GitFlowRalph
      }
      if (executionMode.gitFlow === "commit") {
        return GitFlowCommit
      }
      return GitFlowPR
    }

    const resolveRunEffect = (startedDeferred: Deferred.Deferred<void>) => {
      if (executionMode._tag === "ralph") {
        return runRalph({
          targetBranch: options.project.targetBranch,
          stallTimeout: options.stallTimeout,
          runTimeout: options.runTimeout,
          review: options.project.reviewAgent,
          research: options.project.researchAgent,
          specFile: executionMode.specFile,
          maxContext: options.maxContext,
        })
      }
      return run({
        startedDeferred,
        targetBranch: options.project.targetBranch,
        specsDirectory: options.specsDirectory,
        stallTimeout: options.stallTimeout,
        runTimeout: options.runTimeout,
        review: options.project.reviewAgent,
        research: options.project.researchAgent,
      })
    }

    const handleNoMoreWork = (
      currentIteration: number,
      setIterations: (iterations: number) => void,
    ) => {
      if (executionMode._tag === "ralph") {
        return Effect.void
      }
      if (isFinite) {
        // If we have a finite number of iterations, we exit when no more
        // work is found
        setIterations(currentIteration)
        return Effect.log(
          `No more work to process, ending after ${currentIteration} iteration(s).`,
        )
      }
      const log =
        Iterable.size(fibers) <= 1
          ? Effect.log("No more work to process, waiting 30 seconds...")
          : Effect.void
      return Effect.andThen(log, Effect.sleep(Duration.seconds(30)))
    }

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
      let ralphDone = false

      const gitFlowLayer = resolveGitFlowLayer()
      const fiber = yield* checkForWork(options.project).pipe(
        Effect.andThen(
          resolveRunEffect(startedDeferred).pipe(
            Effect.provide(gitFlowLayer, { local: true }),
            withWorkerState(options.project.id),
          ),
        ),
        Effect.catchTags({
          ChosenTaskNotFound(_error) {
            if (executionMode._tag !== "ralph") {
              return Effect.void
            }
            ralphDone = true
            return Effect.log(
              `No more work to process for Ralph, ending after ${currentIteration + 1} iteration(s).`,
            )
          },
          NoMoreWork(_error) {
            return handleNoMoreWork(currentIteration, (newIterations) => {
              iterations = newIterations
            })
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

      if (executionMode._tag === "ralph") {
        yield* Fiber.await(fiber)
        if (ralphDone) break
      } else {
        yield* Deferred.await(startedDeferred)
      }

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

const maxContext = Flag.integer("max-context").pipe(
  Flag.withDescription(
    "If the context window reaches this number of tokens, try again (default: LALPH_MAX_CONTEXT or 250,000).",
  ),
  Flag.withFallbackConfig(Config.int("LALPH_MAX_TOKENS")),
  Flag.withDefault(250000),
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
  maxContext,
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
        maxContext,
        stallMinutes,
        specsDirectory,
      }) {
        yield* getDefaultCliAgentPreset

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
              maxContext,
            }).pipe(Effect.provideService(CurrentProjectId, project.id)),
          { concurrency: "unbounded", discard: true },
        )
      },
      Effect.scoped,
      Effect.provide([
        ClankaMuxerLayer,
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

  return yield* AtomRegistry.toStreamResult(
    registry,
    currentIssuesAtom(projectId),
  ).pipe(
    Stream.retry(Schedule.forever),
    Stream.orDie,
    Stream.debounce(Duration.seconds(10)),
    Stream.runForEach((issues) => {
      const issue = issues.find((entry) => entry.id === options.issueId)
      if (issue?.state === "in-progress" || issue?.state === "in-review") {
        return Effect.void
      }
      return Effect.fail(
        new TaskStateChanged({
          issueId: options.issueId,
          state: issue?.state ?? "missing",
        }),
      )
    }),
    Effect.withSpan("Main.watchTaskState"),
  )
})

const taskUpdateSteer = Effect.fnUntraced(function* (options: {
  readonly issueId: string
  readonly current: MutableRef.MutableRef<PrdIssue>
}) {
  const registry = yield* AtomRegistry.AtomRegistry
  const projectId = yield* CurrentProjectId

  return AtomRegistry.toStreamResult(
    registry,
    currentIssuesAtom(projectId),
  ).pipe(
    Stream.drop(1),
    Stream.retry(Schedule.forever),
    Stream.orDie,
    Stream.debounce(Duration.seconds(10)),
    Stream.filterMap((issues) => {
      const issue = issues.find((entry) => entry.id === options.issueId)
      if (!issue) return Result.failVoid
      if (!issue.isChangedComparedTo(options.current.current)) {
        return Result.failVoid
      }
      MutableRef.set(options.current, issue)
      return Result.succeed(`The task has been updated by the user. Here is the latest information:

# ${issue.title}

${issue.description}`)
    }),
  )
})
