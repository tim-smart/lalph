import {
  Cause,
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
import {
  IssueSource,
  IssueSourceError,
  IssueSourceUpdates,
} from "./IssueSource.ts"

export class Prd extends ServiceMap.Service<
  Prd,
  {
    readonly path: string
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

    readonly setChosenIssueId: (issueId: string | null) => Effect.Effect<void>
  }
>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const source = yield* IssueSource
    const sourceUpdates = yield* IssueSourceUpdates
    let chosenIssueId: string | null = null

    const lalphDir = pathService.join(worktree.directory, `.lalph`)
    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.yml`)
    const readPrd = Effect.gen(function* () {
      const yaml = yield* fs.readFileString(prdFile)
      return PrdIssue.arrayFromYaml(yaml)
    })

    const syncSemaphore = Effect.makeSemaphoreUnsafe(1)

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
    }, syncSemaphore.withPermit)

    const mergeConflictInstruction =
      "**Your only remaining task**: rebase the PR against the target branch, and resolve any merge conflicts. Once done, you can remove this instruction from the issue description."

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
        : `${mergeConflictInstruction}\n\n---\n\nPrevious description:\n\n${issue.description.trim()}`

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
        maybeRevertIssue,
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
        setChosenIssueId: (issueId: string | null) =>
          Effect.sync(() => {
            chosenIssueId = issueId
          }),
      }
    }

    yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(prdFile)))

    let current = yield* source.issues
    yield* fs.writeFileString(prdFile, PrdIssue.arrayToYaml(current))

    const updatedIssues = new Map<string, PrdIssue>()

    const sync = Effect.gen(function* () {
      const updated = yield* readPrd
      const anyChanges =
        updated.length !== current.length ||
        updated.some((u, i) => u.isChangedComparedTo(current[i]!))
      if (!anyChanges) return

      const toRemove = new Set(
        current.filter((i) => i.id !== null).map((i) => i.id!),
      )

      for (const issue of updated) {
        toRemove.delete(issue.id!)

        if (issue.id === null) {
          yield* source.createIssue(issue)
          continue
        }

        const existing = current.find((i) => i.id === issue.id)
        if (!existing || !existing.isChangedComparedTo(issue)) continue
        if (chosenIssueId && existing.id !== chosenIssueId) continue

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
      yield* fs.writeFileString(prdFile, PrdIssue.arrayToYaml(current))
    }).pipe(
      Effect.uninterruptible,
      syncSemaphore.withPermit,
      Effect.withSpan("Prd.sync"),
      Effect.catchTag("IssueSourceError", (e) =>
        Effect.logWarning(Cause.fail(e)),
      ),
      Effect.annotateLogs({
        module: "Prd",
        method: "sync",
      }),
    )

    const updateSyncHandle = yield* FiberHandle.make()
    const updateSync = Effect.fnUntraced(
      function* (sourceIssues: ReadonlyArray<PrdIssue>) {
        const tempFile = yield* fs.makeTempFileScoped()
        const anyChanges =
          sourceIssues.length !== current.length ||
          sourceIssues.some((u, i) => u.isChangedComparedTo(current[i]!))
        if (!anyChanges) return

        yield* fs.writeFileString(tempFile, PrdIssue.arrayToYaml(sourceIssues))
        yield* fs.rename(tempFile, prdFile)
        current = sourceIssues
      },
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

    yield* sourceUpdates.pipe(Stream.runForEach(updateSync), Effect.forkScoped)

    const findById = (issueId: string) =>
      Effect.sync(() => current.find((i) => i.id === issueId) ?? null)

    return {
      path: prdFile,
      maybeRevertIssue,
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
      setChosenIssueId: (issueId: string | null) =>
        Effect.sync(() => {
          chosenIssueId = issueId
        }),
    }
  }).pipe(Effect.withSpan("Prd.build")),
}) {
  static layerNoWorktree = Layer.effect(this, this.make)
  static layer = this.layerNoWorktree.pipe(Layer.provideMerge(Worktree.layer))
  static layerLocal = this.layerNoWorktree.pipe(
    Layer.provideMerge(Worktree.layerLocal),
  )
}
