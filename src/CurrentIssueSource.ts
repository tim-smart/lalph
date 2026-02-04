import {
  Cause,
  Effect,
  Layer,
  Option,
  pipe,
  Schedule,
  Schema,
  ScopedRef,
  ServiceMap,
} from "effect"
import { CurrentProjectId, Setting, Settings } from "./Settings.ts"
import { LinearIssueSource } from "./Linear.ts"
import { Prompt } from "effect/unstable/cli"
import { GithubIssueSource } from "./Github.ts"
import { IssueSource } from "./IssueSource.ts"
import { PlatformServices } from "./shared/platform.ts"
import { atomRuntime } from "./shared/runtime.ts"
import { Atom, Reactivity } from "effect/unstable/reactivity"
import type { PrdIssue } from "./domain/PrdIssue.ts"
import type { ProjectId } from "./domain/Project.ts"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

const issueSources: ReadonlyArray<typeof CurrentIssueSource.Service> = [
  {
    id: "linear",
    name: "Linear",
    layer: LinearIssueSource,
    githubPrInstructions: `The title of the PR should include the task id.`,
  },
  {
    id: "github",
    name: "GitHub Issues",
    layer: GithubIssueSource,
    githubPrInstructions: `At the start of your PR description, include a line that closes the issue: Closes {task id}`,
  },
]

const selectedIssueSource = new Setting(
  "issueSource",
  Schema.Literals(issueSources.map((s) => s.id)),
)

export const selectIssueSource = Effect.gen(function* () {
  const source = yield* Prompt.select({
    message: "Select issue source:",
    choices: issueSources.map((s) => ({
      title: s.name,
      value: s,
    })),
  })
  yield* Settings.set(selectedIssueSource, Option.some(source.id))
  return source
})

const getOrSelectIssueSource = Effect.gen(function* () {
  const issueSource = yield* Settings.get(selectedIssueSource)
  if (Option.isSome(issueSource)) {
    return issueSources.find((s) => s.id === issueSource.value)!
  }
  return yield* selectIssueSource
})

export class CurrentIssueSource extends ServiceMap.Service<
  CurrentIssueSource,
  {
    readonly id: string
    readonly name: string
    readonly layer: Layer.Layer<
      IssueSource,
      Layer.Error<typeof LinearIssueSource | typeof GithubIssueSource>,
      Layer.Services<typeof LinearIssueSource | typeof GithubIssueSource>
    >
    readonly githubPrInstructions: string
  }
>()("lalph/CurrentIssueSource") {
  static layer = Layer.effectServices(
    Effect.gen(function* () {
      const source = yield* getOrSelectIssueSource
      const build = Layer.build(source.layer).pipe(
        Effect.map(ServiceMap.get(IssueSource)),
        Effect.withSpan("CurrentIssueSource.build"),
      )
      const ref = yield* ScopedRef.fromAcquire(build)
      const services = yield* Effect.services<
        Settings | ChildProcessSpawner | Prompt.Environment
      >()
      const refresh = ScopedRef.set(ref, build).pipe(
        Effect.provideServices(services),
      )

      const proxy = IssueSource.of({
        issues: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.issues(projectId)),
            Effect.tapErrorTag("IssueSourceError", (e) =>
              Effect.logWarning(
                "Rebuilding issue source due to error",
                Cause.fail(e),
              ).pipe(Effect.andThen(Effect.ignore(refresh))),
            ),
            Effect.retry(refreshSchedule),
          ),
        createIssue: (projectId, options) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.createIssue(projectId, options)),
          ),
        updateIssue: (options) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.updateIssue(options)),
          ),
        cancelIssue: (projectId, issueId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.cancelIssue(projectId, issueId)),
          ),
        reset: ScopedRef.get(ref).pipe(
          Effect.flatMap((source) => source.reset),
        ),
        settings: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.settings(projectId)),
          ),
        info: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.info(projectId)),
          ),
        issueCliAgentPreset: (issue) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.issueCliAgentPreset(issue)),
          ),
        updateCliAgentPreset: (preset) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.updateCliAgentPreset(preset)),
          ),
        cliAgentPresetInfo: (preset) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.cliAgentPresetInfo(preset)),
          ),
        ensureInProgress: (projectId, issueId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) =>
              source.ensureInProgress(projectId, issueId),
            ),
          ),
      })

      return IssueSource.serviceMap(proxy).pipe(
        ServiceMap.add(CurrentIssueSource, source),
      )
    }),
  ).pipe(Layer.provide([Settings.layer, PlatformServices]))
}

const refreshSchedule = Schedule.exponential(100, 1.5).pipe(
  Schedule.either(Schedule.spaced("30 seconds")),
)

// Atoms

export const issueSourceRuntime = atomRuntime(
  CurrentIssueSource.layer.pipe(Layer.orDie),
)

export const currentIssuesAtom = Atom.family((projectId: ProjectId) =>
  pipe(
    issueSourceRuntime.atom(
      Effect.fnUntraced(function* (get) {
        const source = yield* IssueSource
        const issues = yield* pipe(
          source.issues(projectId),
          Effect.withSpan("currentIssuesAtom.refresh"),
        )
        const handle = setTimeout(() => {
          get.refreshSelf()
        }, 30_000)
        get.addFinalizer(() => clearTimeout(handle))
        return issues
      }),
    ),
    atomRuntime.withReactivity([`issues:${projectId}`]),
    Atom.keepAlive,
  ),
)

// Helpers

const getCurrentIssues = (projectId: ProjectId) =>
  Atom.getResult(currentIssuesAtom(projectId), {
    suspendOnWaiting: true,
  })

export const checkForWork = Effect.gen(function* () {
  const projectId = yield* CurrentProjectId
  const issues = yield* getCurrentIssues(projectId)
  const hasIncomplete = issues.some(
    (issue) => issue.state === "todo" && issue.blockedBy.length === 0,
  )
  if (!hasIncomplete) {
    return yield* new NoMoreWork({})
  }
})

export const resetInProgress = Effect.gen(function* () {
  const source = yield* IssueSource
  const reactivity = yield* Reactivity.Reactivity
  const projectId = yield* CurrentProjectId
  const issues = yield* getCurrentIssues(projectId)
  const inProgress = issues.filter(
    (issue): issue is PrdIssue & { id: string } =>
      issue.state === "in-progress" && issue.id !== null,
  )
  if (inProgress.length === 0) return
  yield* Effect.forEach(
    inProgress,
    (issue) =>
      source.updateIssue({
        projectId,
        issueId: issue.id,
        state: "todo",
      }),
    { concurrency: 5, discard: true },
  ).pipe(reactivity.withBatch)
})

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}
