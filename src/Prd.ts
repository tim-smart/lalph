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

    const initial = yield* source.issues
    yield* fs.writeFileString(prdFile, PrdIssue.arrayToJson(initial))

    const updatedIssues = new Map<
      string,
      {
        readonly issue: PrdIssue
        readonly originalStateId: string
        count: number
      }
    >()

    const sync = Effect.gen(function* () {
      const json = yield* fs.readFileString(prdFile)
      const updated = PrdList.fromJson(json)
      const current = yield* source.issues
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

        let entry = updatedIssues.get(issue.id)
        if (!entry) {
          entry = {
            issue,
            originalStateId: existing.stateId,
            count: 0,
          }
          updatedIssues.set(issue.id, entry)
        }
        entry.count++
      }

      yield* Effect.forEach(
        toRemove,
        (issueId) => source.cancelIssue(issueId),
        { concurrency: "unbounded" },
      )

      if (createdIssues === 0 || toRemove.size === 0) return

      const refreshed = yield* source.issues
      yield* fs.writeFileString(prdFile, PrdIssue.arrayToJson(refreshed))
    }).pipe(Console.withTime("Prd.sync"), Effect.uninterruptible)

    const mergableGithubPrs = Effect.gen(function* () {
      const json = yield* fs.readFileString(prdFile)
      const updated = PrdList.fromJson(json)
      const prs: Array<number> = []
      for (const issue of updated) {
        const count = updatedIssues.get(issue.id ?? "")?.count ?? 0
        if (count <= 1 || !issue.githubPrNumber) continue
        prs.push(issue.githubPrNumber)
      }
      return prs
    })

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        updatedIssues.values(),
        ({ issue, count, originalStateId }) => {
          if (count > 1) return Effect.void
          return source.updateIssue({
            issueId: issue.id!,
            stateId: originalStateId,
          })
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.ignore),
    )

    yield* fs.watch(prdFile).pipe(
      Stream.buffer({
        capacity: 1,
        strategy: "dropping",
      }),
      Stream.runForEach((_) => Effect.ignore(sync)),
      Effect.forkScoped,
    )

    return { path: prdFile, mergableGithubPrs } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Worktree.layer),
  )
}
