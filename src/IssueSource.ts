import {
  Array,
  Data,
  Duration,
  Effect,
  FiberHandle,
  Option,
  Schedule,
  Schema,
  ScopedCache,
  ServiceMap,
  Stream,
  SubscriptionRef,
  pipe,
} from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import type { ProjectId } from "./domain/Project.ts"
import type { CurrentProjectId, Settings } from "./Settings.ts"
import type { CliAgentPreset } from "./domain/CliAgentPreset.ts"
import type { Environment } from "effect/unstable/cli/Prompt"
import type { QuitError } from "effect/Terminal"

export type IssuesChange = Data.TaggedEnum<{
  Internal: { issues: ReadonlyArray<PrdIssue> }
  External: { issues: ReadonlyArray<PrdIssue> }
}>
export const IssuesChange = Data.taggedEnum<IssuesChange>()

export class IssueSource extends ServiceMap.Service<
  IssueSource,
  {
    readonly ref: (
      projectId: ProjectId,
    ) => Effect.Effect<SubscriptionRef.SubscriptionRef<IssuesChange>>

    readonly issues: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<PrdIssue>, IssueSourceError>

    readonly findById: (
      projectId: ProjectId,
      issueId: string,
    ) => Effect.Effect<PrdIssue | null, IssueSourceError>

    readonly createIssue: (
      projectId: ProjectId,
      issue: PrdIssue,
    ) => Effect.Effect<{ id: string; url: string }, IssueSourceError>

    readonly updateIssue: (options: {
      readonly projectId: ProjectId
      readonly issueId: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly state?: PrdIssue["state"] | undefined
      readonly blockedBy?: ReadonlyArray<string> | undefined
      readonly autoMerge?: boolean | undefined
    }) => Effect.Effect<void, IssueSourceError>

    readonly cancelIssue: (
      projectId: ProjectId,
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>

    readonly reset: Effect.Effect<
      void,
      IssueSourceError,
      CurrentProjectId | Settings
    >
    readonly settings: (
      projectId: ProjectId,
    ) => Effect.Effect<void, IssueSourceError>
    readonly info: (
      projectId: ProjectId,
    ) => Effect.Effect<void, IssueSourceError>

    readonly issueCliAgentPreset: (
      issue: PrdIssue,
    ) => Effect.Effect<Option.Option<CliAgentPreset>, IssueSourceError>
    readonly updateCliAgentPreset: (
      preset: CliAgentPreset,
    ) => Effect.Effect<
      CliAgentPreset,
      IssueSourceError | QuitError,
      Environment
    >
    readonly cliAgentPresetInfo: (
      preset: CliAgentPreset,
    ) => Effect.Effect<void, IssueSourceError>

    readonly ensureInProgress: (
      projectId: ProjectId,
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>
  }
>()("lalph/IssueSource") {
  static make(impl: Omit<IssueSource["Service"], "ref" | "findById">) {
    return Effect.gen(function* () {
      const handle = yield* FiberHandle.make()

      const refs = yield* ScopedCache.make({
        lookup: Effect.fnUntraced(function* (projectId: ProjectId) {
          const ref = yield* SubscriptionRef.make<IssuesChange>(
            IssuesChange.Internal({
              issues: yield* pipe(
                impl.issues(projectId),
                Effect.orElseSucceed(Array.empty),
              ),
            }),
          )

          yield* SubscriptionRef.changes(ref).pipe(
            Stream.switchMap((_) =>
              impl.issues(projectId).pipe(
                Effect.tap((issues) =>
                  SubscriptionRef.set(ref, IssuesChange.External({ issues })),
                ),
                Effect.delay(Duration.seconds(30)),
                Effect.sandbox,
                Effect.retry(Schedule.forever),
                Stream.fromEffectDrain,
              ),
            ),
            Stream.runDrain,
            Effect.forkScoped,
          )

          return ref
        }),
        capacity: Number.MAX_SAFE_INTEGER,
      })

      const updateIssues = Effect.fnUntraced(function* (projectId: ProjectId) {
        const issues = yield* impl.issues(projectId)
        const ref = yield* ScopedCache.get(refs, projectId)
        yield* SubscriptionRef.set(ref, IssuesChange.Internal({ issues }))
        return issues
      })

      const update = Effect.fnUntraced(function* (
        projectId: ProjectId,
        f: (_: ReadonlyArray<PrdIssue>) => ReadonlyArray<PrdIssue>,
      ) {
        const ref = yield* ScopedCache.get(refs, projectId)
        yield* SubscriptionRef.update(ref, (change) =>
          IssuesChange.Internal({
            issues: f(change.issues),
          }),
        )
        yield* FiberHandle.run(
          handle,
          Effect.delay(updateIssues(projectId), "5 seconds"),
        )
      })

      return IssueSource.of({
        ...impl,
        ref: (projectId) => ScopedCache.get(refs, projectId),
        issues: updateIssues,
        findById: Effect.fnUntraced(function* (projectId, issueId) {
          const ref = yield* ScopedCache.get(refs, projectId)
          const { issues } = yield* SubscriptionRef.get(ref)
          return issues.find((issue) => issue.id === issueId) ?? null
        }),
        createIssue: (projectId, issue) =>
          pipe(
            impl.createIssue(projectId, issue),
            Effect.tap((createdIssue) =>
              update(projectId, (issues) => {
                const nextIssue = issue.update({ id: createdIssue.id })
                const index = issues.findIndex(
                  (current) => current.id === createdIssue.id,
                )
                if (index === -1) {
                  return [...issues, nextIssue]
                }
                return issues.map((current, i) =>
                  i === index ? nextIssue : current,
                )
              }),
            ),
          ),
        updateIssue: (options) =>
          pipe(
            impl.updateIssue(options),
            Effect.tap(() =>
              update(options.projectId, (issues) =>
                issues.map((issue) =>
                  issue.id === options.issueId
                    ? new PrdIssue({
                        ...issue,
                        title: options.title ?? issue.title,
                        description: options.description ?? issue.description,
                        state: options.state ?? issue.state,
                        blockedBy: options.blockedBy ?? issue.blockedBy,
                        autoMerge: options.autoMerge ?? issue.autoMerge,
                      })
                    : issue,
                ),
              ),
            ),
          ),
        cancelIssue: (projectId, issueId) =>
          pipe(
            impl.cancelIssue(projectId, issueId),
            Effect.tap(() =>
              update(projectId, (issues) =>
                issues.filter((issue) => issue.id !== issueId),
              ),
            ),
          ),
      })
    })
  }
}

export class IssueSourceError extends Schema.ErrorClass<IssueSourceError>(
  "lalph/IssueSourceError",
)({
  _tag: Schema.tag("IssueSourceError"),
  cause: Schema.Defect,
}) {
  readonly message = "An error occurred in the IssueSource"
}
