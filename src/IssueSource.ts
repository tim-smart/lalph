import { Effect, Schema, ServiceMap } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"

/**
 * Current unused, but eventually will represent a source of issues so we can
 * support more than just Linear
 */
export class IssueSource extends ServiceMap.Service<
  IssueSource,
  {
    readonly states: Effect.Effect<
      ReadonlyMap<
        string,
        {
          readonly id: string
          readonly name: string
          readonly kind: "unstarted" | "started" | "completed"
        }
      >
    >
    readonly issues: Effect.Effect<ReadonlyArray<PrdIssue>, IssueSourceError>
    readonly createIssue: (
      issue: PrdIssue,
    ) => Effect.Effect<void, IssueSourceError>
    readonly updateIssue: (options: {
      readonly issueId: string
    }) => Effect.Effect<void, IssueSourceError>
  }
>()("lalph/IssueSource") {}

export class IssueSourceError extends Schema.ErrorClass<IssueSourceError>(
  "lalph/IssueSourceError",
)({
  _tag: Schema.tag("IssueSourceError"),
  cause: Schema.Defect,
}) {}
