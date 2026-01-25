import {
  Array,
  Effect,
  FiberHandle,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Schedule,
  ServiceMap,
  Stream,
} from "effect"
import { Worktree } from "./Worktree.ts"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { IssueSource, IssueSourceError } from "./IssueSource.ts"

export class Prd extends ServiceMap.Service<
  Prd,
  {
    readonly path: string
    readonly mergableGithubPrs: Effect.Effect<
      {
        issueId: string
        prNumber: number
      }[],
      PlatformError.PlatformError
    >
    readonly maybeRevertIssue: (options: {
      readonly issueId: string
    }) => Effect.Effect<void, PlatformError.PlatformError | IssueSourceError>
    readonly revertUpdatedIssues: Effect.Effect<
      void,
      PlatformError.PlatformError | IssueSourceError
    >
    readonly flagUnmergable: (options: {
      readonly issueId: string
    }) => Effect.Effect<void, IssueSourceError>
    readonly findById: (
      issueId: string,
    ) => Effect.Effect<PrdIssue | null, PlatformError.PlatformError>
  }
>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const source = yield* IssueSource

    const lalphDir = pathService.join(worktree.directory, `.lalph`)
    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.yml`)
    const readPrd = Effect.gen(function* () {
      const yaml = yield* fs.readFileString(prdFile)
      return PrdIssue.arrayFromYaml(yaml)
    })

    const syncSemaphore = Effect.makeSemaphoreUnsafe(1)

    const mergableGithubPrs = Effect.gen(function* () {
      const updated = yield* readPrd
      const prs = Array.empty<{ issueId: string; prNumber: number }>()
      for (const issue of updated) {
        const entry = updatedIssues.get(issue.id ?? "")
        if (!entry || !issue.githubPrNumber || issue.state !== "in-review") {
          continue
        }
        prs.push({ issueId: issue.id!, prNumber: issue.githubPrNumber })
      }
      return prs
    })

    const maybeRevertIssue = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const updated = yield* readPrd
      const issue = updated.find((i) => i.id === options.issueId)
      if (!issue || issue.state === "in-review") return
      yield* source.updateIssue({
        issueId: issue.id!,
        state: "todo",
      })
    })
    const guardedMaybeRevertIssue = (options: { readonly issueId: string }) =>
      syncSemaphore.withPermit(maybeRevertIssue(options))

    const mergeConflictInstruction =
      "Next step: Rebase PR and resolve merge conflicts."

    const flagUnmergable = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const issue = current.find((entry) => entry.id === options.issueId)
      if (!issue) return

      const hasInstruction = issue.description.includes(
        mergeConflictInstruction,
      )
      const nextDescription = hasInstruction
        ? issue.description
        : `${mergeConflictInstruction}\n\n${issue.description.trim()}`

      yield* source.updateIssue({
        issueId: issue.id!,
        description: nextDescription,
        state: "todo",
      })
    })

    if (worktree.inExisting) {
      const initialPrdIssues = yield* readPrd
      return {
        path: prdFile,
        mergableGithubPrs,
        maybeRevertIssue: guardedMaybeRevertIssue,
        revertUpdatedIssues: Effect.gen(function* () {
          const updated = yield* readPrd
          for (const issue of updated) {
            if (issue.state !== "in-progress") continue
            const prevIssue = initialPrdIssues.find((i) => i.id === issue.id)
            if (!prevIssue || prevIssue.state === "in-progress") continue
            yield* source.updateIssue({
              issueId: issue.id!,
              state: prevIssue.state,
            })
          }
        }),
        flagUnmergable,
        findById: Effect.fnUntraced(function* (issueId: string) {
          const prdIssues = yield* readPrd
          return prdIssues.find((i) => i.id === issueId) ?? null
        }),
      }
    }

    yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(prdFile)))

    let current = yield* source.issues
    yield* fs.writeFileString(prdFile, PrdIssue.arrayToYaml(current))

    const updatedIssues = new Map<string, PrdIssue>()

    const sync = syncSemaphore.withPermit(
      Effect.gen(function* () {
        const updated = yield* readPrd
        const anyChanges =
          updated.length !== current.length ||
          updated.some((u, i) => u.isChangedComparedTo(current[i]!))
        if (!anyChanges) {
          return
        }

        const githubPrs = new Map<string, number>()
        const toRemove = new Set(
          current.filter((i) => i.id !== null).map((i) => i.id!),
        )

        for (const issue of updated) {
          toRemove.delete(issue.id!)

          if (issue.id === null) {
            yield* source.createIssue(issue)
            continue
          }

          if (issue.githubPrNumber) {
            githubPrs.set(issue.id, issue.githubPrNumber)
          }

          const existing = current.find((i) => i.id === issue.id)
          if (!existing || !existing.isChangedComparedTo(issue)) continue

          yield* source.updateIssue({
            issueId: issue.id,
            title: issue.title,
            description: issue.description,
            state: issue.state,
            blockedBy: issue.blockedBy,
          })

          updatedIssues.set(issue.id, issue)
        }

        yield* Effect.forEach(
          toRemove,
          (issueId) => source.cancelIssue(issueId),
          { concurrency: "unbounded" },
        )

        current = yield* source.issues
        yield* fs.writeFileString(
          prdFile,
          PrdIssue.arrayToYaml(
            current.map((issue) => {
              const prNumber = githubPrs.get(issue.id!)
              if (!prNumber) return issue
              return new PrdIssue({ ...issue, githubPrNumber: prNumber })
            }),
          ),
        )
      }).pipe(Effect.uninterruptible),
    )

    const updateSyncHandle = yield* FiberHandle.make()
    const updateSync = Effect.gen(function* () {
      const tempFile = yield* fs.makeTempFileScoped()
      const sourceIssues = yield* source.issues
      const anyChanges =
        sourceIssues.length !== current.length ||
        sourceIssues.some((u, i) => u.isChangedComparedTo(current[i]!))
      if (!anyChanges) return

      yield* fs.writeFileString(tempFile, PrdIssue.arrayToYaml(sourceIssues))
      yield* fs.rename(tempFile, prdFile)
      current = sourceIssues
    }).pipe(
      Effect.scoped,
      FiberHandle.run(updateSyncHandle, { onlyIfMissing: true }),
    )

    yield* fs.watch(lalphDir).pipe(
      Stream.buffer({
        capacity: 1,
        strategy: "dropping",
      }),
      Stream.runForEach((_) =>
        FiberHandle.clear(updateSyncHandle).pipe(
          Effect.andThen(Effect.ignore(sync)),
        ),
      ),
      Effect.retry(Schedule.forever),
      Effect.forkScoped,
    )

    yield* updateSync.pipe(
      Effect.delay("1 minute"),
      Effect.forever,
      Effect.forkScoped,
    )

    const findById = (issueId: string) =>
      Effect.sync(() => current.find((i) => i.id === issueId) ?? null)

    return {
      path: prdFile,
      mergableGithubPrs,
      maybeRevertIssue: guardedMaybeRevertIssue,
      revertUpdatedIssues: syncSemaphore.withPermit(
        Effect.gen(function* () {
          for (const issue of updatedIssues.values()) {
            if (issue.state === "done") continue
            yield* source.updateIssue({
              issueId: issue.id!,
              state: "todo",
            })
          }
        }),
      ),
      flagUnmergable,
      findById,
    }
  }),
}) {
  static layerNoWorktree = Layer.effect(this, this.make)
  static layer = this.layerNoWorktree.pipe(Layer.provideMerge(Worktree.layer))
  static layerLocal = this.layerNoWorktree.pipe(
    Layer.provideMerge(Worktree.layerLocal),
  )
}
