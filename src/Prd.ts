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
import { IssueSource, IssueSourceError } from "./IssueSource.ts"
import { AtomRegistry, Reactivity } from "effect/unstable/reactivity"
import { CurrentIssueSource, currentIssuesAtom } from "./CurrentIssueSource.ts"
import { CurrentProjectId, Settings } from "./Settings.ts"

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
    ) => Effect.Effect<
      PrdIssue | null,
      PlatformError.PlatformError | IssueSourceError
    >
    readonly setChosenIssueId: (issueId: string | null) => Effect.Effect<void>
    readonly setAutoMerge: (enabled: boolean) => Effect.Effect<void>
  }
>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const reactivity = yield* Reactivity.Reactivity
    const source = yield* IssueSource
    const registry = yield* AtomRegistry.AtomRegistry
    const projectId = yield* CurrentProjectId

    let chosenIssueId: string | null = null
    let shouldAddAutoMerge = false

    const lalphDir = pathService.join(worktree.directory, `.lalph`)
    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.yml`)
    const readPrd = Effect.gen(function* () {
      const yaml = yield* fs.readFileString(prdFile)
      return PrdIssue.arrayFromYaml(yaml)
    })
    const getCurrentIssues = AtomRegistry.getResult(
      registry,
      currentIssuesAtom(projectId),
      { suspendOnWaiting: true },
    )

    const syncSemaphore = Effect.makeSemaphoreUnsafe(1)

    const maybeRevertIssue = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const updated = yield* readPrd
      const issue = updated.find((i) => i.id === options.issueId)
      if (!issue || issue.state === "in-review") return
      yield* source.updateIssue({
        projectId,
        issueId: issue.id!,
        state: "todo",
      })
    }, syncSemaphore.withPermit)

    const mergeConflictInstruction =
      "A previous attempt at this task resulted in merge conflicts. Please try implementing the task again."

    const flagUnmergable = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const current = yield* getCurrentIssues
      const issue = current.find((entry) => entry.id === options.issueId)
      if (!issue) return

      const hasInstruction = issue.description.includes(
        mergeConflictInstruction,
      )
      const nextDescription = hasInstruction
        ? issue.description
        : `${mergeConflictInstruction}\n\n---\n\nPrevious description:\n\n${issue.description.trim()}`

      yield* source.updateIssue({
        projectId,
        issueId: issue.id!,
        description: nextDescription,
        state: "todo",
      })
    })

    const setChosenIssueId = (issueId: string | null) =>
      Effect.sync(() => {
        chosenIssueId = issueId
      })

    const setAutoMerge = (enabled: boolean) =>
      Effect.sync(() => {
        shouldAddAutoMerge = enabled
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
              projectId,
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
        setChosenIssueId,
        setAutoMerge,
      }
    }

    yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(prdFile)))

    yield* fs.writeFileString(
      prdFile,
      PrdIssue.arrayToYaml(yield* getCurrentIssues),
    )

    const updatedIssues = new Map<string, PrdIssue>()

    const sync = Effect.gen(function* () {
      const current = yield* getCurrentIssues
      const updated = yield* readPrd
      const anyChanges =
        updated.length !== current.length ||
        updated.some((u, i) => u.isChangedComparedTo(current[i]!))
      if (!anyChanges) return

      const toRemove = new Set(
        current.filter((i) => i.id !== null).map((i) => i.id!),
      )

      yield* Effect.forEach(
        updated,
        Effect.fnUntraced(function* (issue) {
          toRemove.delete(issue.id!)

          if (issue.id === null) {
            yield* source.createIssue(
              projectId,
              shouldAddAutoMerge ? issue.withAutoMerge(true) : issue,
            )
            return
          }

          const existing = current.find((i) => i.id === issue.id)
          if (!existing || !existing.isChangedComparedTo(issue)) return
          if (chosenIssueId && existing.id !== chosenIssueId) return

          yield* source.updateIssue({
            projectId,
            issueId: issue.id,
            title: issue.title,
            description: issue.description,
            state: issue.state,
            blockedBy: issue.blockedBy,
            autoMerge: issue.autoMerge,
          })

          updatedIssues.set(issue.id, issue)
        }),
        { concurrency: "unbounded", discard: true },
      )

      yield* Effect.forEach(
        toRemove,
        (issueId) => source.cancelIssue(projectId, issueId),
        { concurrency: "unbounded" },
      )
    }).pipe(
      reactivity.withBatch,
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
        const currentYaml = (yield* fs.readFileString(prdFile)).trim()
        const nextYaml = PrdIssue.arrayToYaml(sourceIssues).trim()
        if (currentYaml === nextYaml) return
        yield* fs.writeFileString(prdFile, nextYaml)
      },
      Effect.scoped,
      Effect.withSpan("Prd.updateSync"),
      FiberHandle.run(updateSyncHandle, { onlyIfMissing: true }),
      syncSemaphore.withPermitsIfAvailable(1),
    )

    yield* fs.watch(lalphDir).pipe(
      Stream.debounce(50),
      Stream.runForEach((_) =>
        FiberHandle.clear(updateSyncHandle).pipe(
          Effect.andThen(Effect.ignore(sync)),
        ),
      ),
      Effect.retry(Schedule.forever),
      Effect.forkScoped,
    )

    yield* AtomRegistry.toStreamResult(
      registry,
      currentIssuesAtom(projectId),
    ).pipe(Stream.runForEach(updateSync), Effect.forkScoped)

    const findById = Effect.fnUntraced(function* (issueId: string) {
      const current = yield* getCurrentIssues
      return current.find((i) => i.id === issueId) ?? null
    })

    return {
      path: prdFile,
      maybeRevertIssue,
      revertUpdatedIssues: syncSemaphore.withPermit(
        Effect.gen(function* () {
          for (const issue of updatedIssues.values()) {
            if (issue.state === "done") continue
            yield* source.updateIssue({
              projectId,
              issueId: issue.id!,
              state: "todo",
            })
          }
        }),
      ),
      flagUnmergable,
      findById,
      setChosenIssueId,
      setAutoMerge,
    }
  }).pipe(Effect.withSpan("Prd.build")),
}) {
  static layerNoWorktree = Layer.effect(this, this.make)
  static layer = this.layerNoWorktree.pipe(Layer.provideMerge(Worktree.layer))
  static layerProvided = this.layer.pipe(
    Layer.provide([
      AtomRegistry.layer,
      Reactivity.layer,
      CurrentIssueSource.layer,
      Settings.layer,
    ]),
  )
  static layerLocal = this.layerNoWorktree.pipe(
    Layer.provideMerge(Worktree.layerLocal),
  )
  static layerLocalProvided = this.layerLocal.pipe(
    Layer.provide([
      AtomRegistry.layer,
      Reactivity.layer,
      CurrentIssueSource.layer,
    ]),
  )
}
