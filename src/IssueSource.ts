import { Effect, Option, Schema, ServiceMap } from "effect"
import type { PrdIssue } from "./domain/PrdIssue.ts"
import { Reactivity } from "effect/unstable/reactivity"
import type { ProjectId } from "./domain/Project.ts"
import type { CurrentProjectId, Settings } from "./Settings.ts"
import type { CliAgentPreset } from "./domain/CliAgentPreset.ts"
import type { Environment } from "effect/unstable/cli/Prompt"
import type { QuitError } from "effect/Terminal"

export class IssueSource extends ServiceMap.Service<
  IssueSource,
  {
    readonly issues: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<PrdIssue>, IssueSourceError>

    readonly createIssue: (
      projectId: ProjectId,
      issue: PrdIssue,
    ) => Effect.Effect<{ id: string; url: string }, IssueSourceError>

    readonly updateIssue: (options: {
      readonly projectId: ProjectId
      readonly issueId: string
      readonly title?: string
      readonly description?: string
      readonly state?: PrdIssue["state"]
      readonly blockedBy?: ReadonlyArray<string>
      readonly autoMerge?: boolean
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

    readonly ensureInProgress: (
      projectId: ProjectId,
      issueId: string,
    ) => Effect.Effect<void, IssueSourceError>
  }
>()("lalph/IssueSource") {
  static make(impl: IssueSource["Service"]) {
    return Effect.gen(function* () {
      const reactivity = yield* Reactivity.Reactivity
      return IssueSource.of({
        ...impl,
        createIssue: (projectId, issue) =>
          reactivity.mutation(
            {
              issues: [projectId],
            },
            impl.createIssue(projectId, issue),
          ),
        updateIssue: (options) =>
          reactivity.mutation(
            {
              issues: [options.projectId],
            },
            impl.updateIssue(options),
          ),
        cancelIssue: (projectId, issueId) =>
          reactivity.mutation(
            {
              issues: [projectId],
            },
            impl.cancelIssue(projectId, issueId),
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
