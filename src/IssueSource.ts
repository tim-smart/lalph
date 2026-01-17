import { Effect, Schema, ServiceMap } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"

/**
 * Current unused, but eventually will represent a source of issues so we can
 * support more than just Linear
 */
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
  const source = yield* IssueSource
  const issues = yield* source.issues
  const hasIncomplete = issues.some(
    (issue) => issue.complete === false && issue.blockedBy.length === 0,
  )
  if (!hasIncomplete) {
    return yield* new NoMoreWork({})
  }
})

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}
