import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  ServiceMap,
  Stream,
} from "effect"
import { Worktree } from "./Worktree.ts"
import { PrdIssue, PrdList } from "./domain/PrdIssue.ts"
import { IssueSource } from "./IssueSource.ts"

export class Prd extends ServiceMap.Service<Prd>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const source = yield* IssueSource

    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.json`)

    let current = yield* source.issues
    yield* fs.writeFileString(prdFile, PrdIssue.arrayToJson(current))

    const updatedIssues = new Map<
      string,
      {
        readonly issue: PrdIssue
        readonly originalStateId: string
      }
    >()

    const sync = Effect.gen(function* () {
      const json = yield* fs.readFileString(prdFile)
      const updated = PrdList.fromJson(json)
      const anyChanges =
        updated.length !== current.length ||
        updated.some((u, i) => u.isChangedComparedTo(current[i]!))
      if (!anyChanges) {
        return
      }
      const toRemove = new Set(
        current.filter((i) => i.id !== null).map((i) => i.id!),
      )
      let createdIssues = 0

      for (const issue of updated) {
        toRemove.delete(issue.id!)

        if (issue.id === null) {
          yield* source.createIssue(issue)
          createdIssues++
          continue
        }

        const existing = current.find((i) => i.id === issue.id)
        if (!existing || !existing.isChangedComparedTo(issue)) continue

        yield* source.updateIssue({
          issueId: issue.id,
          title: issue.title,
          description: issue.description,
          stateId: issue.stateId,
          blockedBy: issue.blockedBy,
        })

        if (!updatedIssues.has(issue.id)) {
          updatedIssues.set(issue.id, {
            issue,
            originalStateId: existing.stateId,
          })
        }
      }

      yield* Effect.forEach(
        toRemove,
        (issueId) => source.cancelIssue(issueId),
        { concurrency: "unbounded" },
      )

      current = yield* source.issues
      yield* fs.writeFileString(prdFile, PrdIssue.arrayToJson(current))
    }).pipe(Console.withTime("Prd.sync"), Effect.uninterruptible)

    const hasMergableIssues = Effect.gen(function* () {
      const json = yield* fs.readFileString(prdFile)
      const updated = PrdList.fromJson(json)
      for (const issue of updated) {
        const entry = updatedIssues.get(issue.id ?? "")
        if (!entry || issue.stateId === entry.originalStateId) {
          continue
        }
        return true
      }
      return false
    })

    const revertStateIds = Effect.suspend(() =>
      Effect.forEach(
        updatedIssues.values(),
        ({ issue, originalStateId }) =>
          source.updateIssue({
            issueId: issue.id!,
            stateId: originalStateId,
          }),
        { concurrency: "unbounded", discard: true },
      ),
    )

    yield* fs.watch(prdFile).pipe(
      Stream.buffer({
        capacity: 1,
        strategy: "dropping",
      }),
      Stream.runForEach((_) => Effect.ignore(sync)),
      Effect.forkScoped,
    )

    return { path: prdFile, hasMergableIssues, revertStateIds } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Worktree.layer),
  )
}
