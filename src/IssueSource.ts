import { Effect, Schema, ServiceMap } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"
import { Reactivity } from "effect/unstable/reactivity"

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
      readonly autoMerge?: boolean
    }) => Effect.Effect<void, IssueSourceError>

    readonly cancelIssue: (
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>

    readonly status: Effect.Effect<void, IssueSourceError>

    readonly ensureInProgress: (
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>
  }
>()("lalph/IssueSource") {
  static make(impl: IssueSource["Service"]) {
    return Effect.gen(function* () {
      const reactivity = yield* Reactivity.Reactivity
      return IssueSource.of({
        ...impl,
        createIssue: (issue) =>
          reactivity.mutation(["issues"], impl.createIssue(issue)),
        updateIssue: (options) =>
          reactivity.mutation(["issues"], impl.updateIssue(options)),
        cancelIssue: (issueId) =>
          reactivity.mutation(["issues"], impl.cancelIssue(issueId)),
      })
    })
  }
}

export class IssueSourceError extends Schema.ErrorClass<IssueSourceError>(
  "lalph/IssueSourceError",
)({
  _tag: Schema.tag("IssueSourceError"),
  cause: Schema.Defect,
}) {}
