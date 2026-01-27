import { Effect, Layer, Schedule, Schema, ServiceMap, Stream } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"

export class IssueSource extends ServiceMap.Service<
  IssueSource,
  {
    readonly issues: Effect.Effect<ReadonlyArray<PrdIssue>, IssueSourceError>

    readonly createIssue: (
      issue: PrdIssue,
    ) => Effect.Effect<{ id: string; url: string }, IssueSourceError>

    readonly updateIssue: (options: {
      readonly issueId: string
      readonly title?: string
      readonly description?: string
      readonly state?: PrdIssue["state"]
      readonly blockedBy?: ReadonlyArray<string>
    }) => Effect.Effect<void, IssueSourceError>

    readonly cancelIssue: (
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>

    readonly ensureInProgress: (
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>
  }
>()("lalph/IssueSource") {}

export class IssueSourceUpdates extends ServiceMap.Service<IssueSourceUpdates>()(
  "lalph/IssueSourceUpdates",
  {
    make: Effect.gen(function* () {
      const source = yield* IssueSource
      const updates = yield* Stream.fromEffectSchedule(
        source.issues,
        Schedule.spaced("1 minute"),
      ).pipe(
        Stream.retry(Schedule.spaced("10 seconds")),
        Stream.orDie,
        Stream.share({
          capacity: 1,
          strategy: "dropping",
        }),
      )
      return updates
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}

export class IssueSourceError extends Schema.ErrorClass<IssueSourceError>(
  "lalph/IssueSourceError",
)({
  _tag: Schema.tag("IssueSourceError"),
  cause: Schema.Defect,
}) {}

export const checkForWork = Effect.gen(function* () {
  const source = yield* IssueSource
  const issues = yield* source.issues
  const hasIncomplete = issues.some(
    (issue) => issue.state === "todo" && issue.blockedBy.length === 0,
  )
  if (!hasIncomplete) {
    return yield* new NoMoreWork({})
  }
})

export const resetInProgress = Effect.gen(function* () {
  const source = yield* IssueSource
  const issues = yield* source.issues
  const inProgress = issues.filter(
    (issue): issue is PrdIssue & { id: string } =>
      issue.state === "in-progress" && issue.id !== null,
  )
  if (inProgress.length === 0) return
  yield* Effect.forEach(
    inProgress,
    (issue) =>
      source.updateIssue({
        issueId: issue.id,
        state: "todo",
      }),
    { concurrency: 5, discard: true },
  )
})

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}
