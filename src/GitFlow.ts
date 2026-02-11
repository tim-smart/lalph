import { Data, Duration, Effect, Layer, Option, ServiceMap } from "effect"
import { IssueSource, type IssueSourceError } from "./IssueSource.ts"
import type { PlatformError } from "effect/PlatformError"
import type { Worktree } from "./Worktree.ts"
import { Prd } from "./Prd.ts"
import { CurrentWorkerState } from "./Workers.ts"
import { Atom } from "effect/unstable/reactivity"
import { parseBranch } from "./shared/git.ts"
import { AtomRegistry } from "effect/unstable/reactivity"
import { CurrentProjectId } from "./Settings.ts"

// @effect-diagnostics-next-line leakingRequirements:off
export class GitFlow extends ServiceMap.Service<
  GitFlow,
  {
    readonly requiresGithubPr: boolean
    readonly branch: string | undefined
    readonly setupInstructions: (options: {
      readonly githubPrNumber: number | undefined
    }) => string
    readonly commitInstructions: (options: {
      readonly githubPrNumber: number | undefined
      readonly githubPrInstructions: string
      readonly targetBranch: string | undefined
      readonly taskId: string
    }) => string
    readonly reviewInstructions: string
    readonly postWork: (options: {
      readonly worktree: Worktree["Service"]
      readonly targetBranch: string | undefined
      readonly issueId: string
    }) => Effect.Effect<
      void,
      IssueSourceError | PlatformError | GitFlowError,
      Prd | IssueSource | CurrentProjectId
    >
    readonly autoMerge: (options: {
      readonly targetBranch: string | undefined
      readonly issueId: string
      readonly worktree: Worktree["Service"]
    }) => Effect.Effect<
      void,
      IssueSourceError | PlatformError | GitFlowError,
      Prd | IssueSource | CurrentProjectId
    >
  }
>()("lalph/GitFlow") {}

export type GitFlowLayer = Layer.Layer<
  GitFlow,
  never,
  Layer.Services<typeof GitFlowPR | typeof GitFlowCommit>
>

export const GitFlowPR = Layer.succeed(
  GitFlow,
  GitFlow.of({
    requiresGithubPr: true,
    branch: undefined,

    setupInstructions: ({ githubPrNumber }) =>
      githubPrNumber
        ? `The Github PR #${githubPrNumber} has been detected for this task and the branch has been checked out.
   - Review feedback in the .lalph/feedback.md file (same folder as the prd.yml file).`
        : `Create a new branch for the task using the format \`{task id}/description\`, using the current HEAD as the base (don't checkout any other branches first).`,

    commitInstructions: (
      options,
    ) => `${!options.githubPrNumber ? `Create a pull request for this task. If the target branch does not exist, create it first.` : "Commit and push your changes to the pull request."}
   ${options.githubPrInstructions}
   The PR description should include a summary of the changes made.${options.targetBranch ? `\n   - The target branch for the PR should be \`${options.targetBranch}\`.` : ""}
   - **DO NOT** commit any of the files in the \`.lalph\` directory.
   - You have full permission to push branches, create PRs or create git commits.`,

    reviewInstructions: `You are already on the PR branch with their changes.
After making any changes, commit and push them to the same pull request.

- **DO NOT** commit any of the files in the \`.lalph\` directory.
- You have full permission to push branches, create PRs or create git commits.`,

    postWork: () => Effect.void,
    autoMerge: Effect.fnUntraced(function* (options) {
      const prd = yield* Prd
      const worktree = options.worktree

      let prState = (yield* worktree.viewPrState()).pipe(
        Option.filter((pr) => pr.state === "OPEN"),
      )

      yield* Effect.log("PR state", prState)
      if (Option.isNone(prState)) {
        return yield* new GitFlowError({
          message: `No open PR found for auto-merge.`,
        })
      }
      if (options.targetBranch) {
        yield* worktree.exec`gh pr edit --base ${options.targetBranch}`
      }
      yield* worktree.exec`gh pr merge -sd`
      yield* Effect.sleep(Duration.seconds(3))
      prState = yield* worktree.viewPrState(prState.value.number)
      yield* Effect.log("PR state after merge", prState)
      if (Option.isSome(prState) && prState.value.state === "MERGED") {
        return
      }
      yield* Effect.log("Flagging unmergable PR")
      yield* prd.flagUnmergable({ issueId: options.issueId })
      yield* worktree.exec`gh pr close -d`
    }),
  }),
)

export const GitFlowCommit = Layer.effect(
  GitFlow,
  Effect.gen(function* () {
    const currentWorker = yield* CurrentWorkerState
    const workerState = yield* Atom.get(currentWorker.state)

    return GitFlow.of({
      requiresGithubPr: false,
      branch: `lalph/worker-${workerState.id}`,

      setupInstructions: () =>
        `You are already on a new branch for this task. You do not need to checkout any other branches.`,

      commitInstructions: (
        options,
      ) => `When you have completed your changes, **you must** commit them to the current local branch. Do not git push your changes or switch branches.
   - Include \`References ${options.taskId}\` in each commit message.
   - **DO NOT** commit any of the files in the \`.lalph\` directory.`,

      reviewInstructions: `You are already on the branch with their changes.
After making any changes, **you have to commit them** to the same branch.
But you **do not** need to git push your changes or switch branches.

 - Include \`References {task id}\` in each commit message.
 - **DO NOT** commit any of the files in the \`.lalph\` directory.
 - You have full permission to create git commits.`,

      postWork: Effect.fnUntraced(function* ({
        worktree,
        targetBranch,
        issueId,
      }) {
        if (!targetBranch) {
          return yield* Effect.logWarning(
            "GitFlowCommit: No target branch specified, skipping postWork.",
          )
        }
        const prd = yield* Prd
        const unstagedChangesResult = yield* worktree.exec`git diff --quiet`
        const hasUnstagedChanges = unstagedChangesResult !== 0

        if (hasUnstagedChanges) {
          const stashResult =
            yield* worktree.exec`git stash push --keep-index --message ${`lalph/${issueId}: clear unstaged changes before rebase`}`

          if (stashResult !== 0) {
            yield* prd.flagUnmergable({ issueId })
            return yield* new GitFlowError({
              message:
                "Failed to clear unstaged changes before rebasing. Aborting task.",
            })
          }
        }

        const parsed = parseBranch(targetBranch)
        yield* worktree.exec`git fetch ${parsed.remote}`
        const rebaseResult =
          yield* worktree.exec`git rebase ${parsed.branchWithRemote}`
        if (rebaseResult !== 0) {
          yield* prd.flagUnmergable({ issueId })
          return yield* new GitFlowError({
            message: `Failed to rebase onto ${parsed.branchWithRemote}. Aborting task.`,
          })
        }

        const pushResult =
          yield* worktree.exec`git push ${parsed.remote} ${`HEAD:${parsed.branch}`}`
        if (pushResult !== 0) {
          yield* prd.flagUnmergable({ issueId })
          return yield* new GitFlowError({
            message: `Failed to push changes to ${parsed.branchWithRemote}. Aborting task.`,
          })
        }

        if (hasUnstagedChanges) {
          const unstashResult = yield* worktree.exec`git stash pop`
          if (unstashResult !== 0) {
            yield* Effect.logWarning(
              "Unable to re-apply unstaged changes after rebase. The stash entry was left in place.",
            )
          }
        }
      }),
      autoMerge: Effect.fnUntraced(function* (options) {
        const prd = yield* Prd
        const projectId = yield* CurrentProjectId
        const issue = yield* prd.findById(options.issueId)
        if (!issue || issue.state !== "in-review") {
          return
        }
        const source = yield* IssueSource
        yield* source.updateIssue({
          projectId,
          issueId: options.issueId,
          state: "done",
        })
      }),
    })
  }),
).pipe(Layer.provide(AtomRegistry.layer))

// Errors

export class GitFlowError extends Data.TaggedError("GitFlowError")<{
  message: string
}> {}
