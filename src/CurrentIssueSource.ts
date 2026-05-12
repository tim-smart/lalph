import {
  Cause,
  Effect,
  Layer,
  Option,
  pipe,
  Schedule,
  Schema,
  ScopedRef,
  Context,
  SubscriptionRef,
} from "effect"
import { allProjects, CurrentProjectId, Setting, Settings } from "./Settings.ts"
import { LinearIssueSource } from "./Linear.ts"
import { Prompt } from "effect/unstable/cli"
import { GithubIssueSource } from "./Github.ts"
import { IssuesChange, IssueSource } from "./IssueSource.ts"
import { PlatformServices } from "./shared/platform.ts"
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

export class CurrentIssueSource extends Context.Service<
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
  static layer = Layer.effectContext(
    Effect.gen(function* () {
      const settings = yield* Settings
      const source = yield* getOrSelectIssueSource
      const build = Layer.build(source.layer).pipe(
        Effect.map(Context.get(IssueSource)),
        Effect.withSpan("CurrentIssueSource.build"),
      )
      const ref = yield* ScopedRef.fromAcquire(build)
      const services = yield* Effect.context<
        Settings | ChildProcessSpawner | Prompt.Environment
      >()
      const refresh = ScopedRef.set(ref, build).pipe(
        Effect.provideContext(services),
      )
      const unlessRalph =
        <B>(projectId: ProjectId, orElse: Effect.Effect<B>) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | B, E, R> =>
          settings.get(allProjects).pipe(
            Effect.map(
              Option.filter((projects) =>
                projects.some(
                  (p) => p.id === projectId && p.gitFlow === "ralph",
                ),
              ),
            ),
            Effect.flatMap(
              Option.match({
                onNone: (): Effect.Effect<A | B, E, R> => effect,
                onSome: () => orElse,
              }),
            ),
          )

      const proxy = IssueSource.of({
        ref: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.ref(projectId)),
            unlessRalph(
              projectId,
              SubscriptionRef.make<IssuesChange>(
                IssuesChange.Internal({ issues: [] }),
              ),
            ),
          ),
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
            unlessRalph(projectId, Effect.succeed([])),
          ),
        findById: (projectId, issueId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.findById(projectId, issueId)),
            unlessRalph(projectId, Effect.succeed(null)),
          ),
        createIssue: (projectId, options) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.createIssue(projectId, options)),
            unlessRalph(projectId, Effect.interrupt),
          ),
        updateIssue: (options) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.updateIssue(options)),
            unlessRalph(options.projectId, Effect.void),
          ),
        cancelIssue: (projectId, issueId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.cancelIssue(projectId, issueId)),
            unlessRalph(projectId, Effect.void),
          ),
        reset: ScopedRef.get(ref).pipe(
          Effect.flatMap((source) => source.reset),
        ),
        settings: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.settings(projectId)),
            unlessRalph(projectId, Effect.void),
          ),
        info: (projectId) =>
          ScopedRef.get(ref).pipe(
            Effect.flatMap((source) => source.info(projectId)),
            unlessRalph(projectId, Effect.void),
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
            unlessRalph(projectId, Effect.void),
          ),
      })

      return IssueSource.context(proxy).pipe(
        Context.add(CurrentIssueSource, source),
      )
    }),
  ).pipe(Layer.provide([Settings.layer, PlatformServices]))
}

const refreshSchedule = Schedule.exponential(100, 1.5).pipe(
  Schedule.either(Schedule.spaced("30 seconds")),
)

// Helpers

const getCurrentIssues = (projectId: ProjectId) =>
  IssueSource.use((s) =>
    pipe(s.ref(projectId), Effect.flatMap(SubscriptionRef.get)),
  )

export const resetInProgress = Effect.gen(function* () {
  const source = yield* IssueSource
  const projectId = yield* CurrentProjectId
  const { issues } = yield* getCurrentIssues(projectId)
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
  )
})
