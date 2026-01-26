import { DateTime, Duration, Effect, Schema, ServiceMap } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"

export class IssueSource extends ServiceMap.Service<
  IssueSource,
  {
    readonly issues: Effect.Effect<ReadonlyArray<PrdIssue>, IssueSourceError>

    readonly createIssue: (
      issue: PrdIssue,
    ) => Effect.Effect<string, IssueSourceError>

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
  }
>()("lalph/IssueSource") {}

export class IssueSourceError extends Schema.ErrorClass<IssueSourceError>(
  "lalph/IssueSourceError",
)({
  _tag: Schema.tag("IssueSourceError"),
  cause: Schema.Defect,
}) {}

export const checkForWork = Effect.gen(function* () {
  const startTime = yield* DateTime.now
  yield* Effect.logDebug("checkForWork: starting...")

  const source = yield* IssueSource
  const issues = yield* source.issues.pipe(
    Effect.withSpan("IssueSource.fetchIssues"),
  )

  const fetchElapsed = yield* DateTime.now.pipe(
    Effect.map((now) => DateTime.distanceDuration(startTime, now)),
  )
  yield* Effect.logDebug(
    `checkForWork: fetched ${issues.length} issues in ${Duration.format(fetchElapsed)}`,
  )

  const todoIssues = issues.filter((issue) => issue.state === "todo")
  const unblockedTodoIssues = todoIssues.filter(
    (issue) => issue.blockedBy.length === 0,
  )

  yield* Effect.logDebug(
    `checkForWork: ${todoIssues.length} todo, ${unblockedTodoIssues.length} unblocked`,
  )

  const hasIncomplete = unblockedTodoIssues.length > 0
  if (!hasIncomplete) {
    return yield* new NoMoreWork({})
  }
}).pipe(Effect.withSpan("checkForWork"))

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}
