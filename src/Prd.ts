import {
  Array,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schedule,
  ServiceMap,
  Stream,
} from "effect"
import { Worktree } from "./Worktree.ts"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { IssueSource } from "./IssueSource.ts"

export class Prd extends ServiceMap.Service<Prd>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const source = yield* IssueSource

    const lalphDir = pathService.join(worktree.directory, `.lalph`)
    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.yml`)

    let current = yield* source.issues
    yield* fs.writeFileString(prdFile, PrdIssue.arrayToYaml(current))

    const updatedIssues = new Map<string, PrdIssue>()

    yield* fs.watch(lalphDir).pipe(
      Stream.buffer({
        capacity: 1,
        strategy: "dropping",
      }),
      Stream.runForEach((_) => Effect.ignore(sync)),
      Effect.retry(Schedule.forever),
      Effect.forkScoped,
    )

    const sync = Effect.gen(function* () {
      const yaml = yield* fs.readFileString(prdFile)
      const updated = PrdIssue.arrayFromYaml(yaml)
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

        if (!updatedIssues.has(issue.id!)) {
          updatedIssues.set(issue.id, issue)
        }
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
    }).pipe(Effect.uninterruptible)

    const mergableGithubPrs = Effect.gen(function* () {
      const yaml = yield* fs.readFileString(prdFile)
      const updated = PrdIssue.arrayFromYaml(yaml)
      const prs = Array.empty<number>()
      for (const issue of updated) {
        const entry = updatedIssues.get(issue.id ?? "")
        if (!entry || !issue.githubPrNumber || issue.state !== "in-review") {
          continue
        }
        prs.push(issue.githubPrNumber)
      }
      return prs
    })

    const revertStateIds = Effect.suspend(() =>
      Effect.forEach(
        updatedIssues.values(),
        (issue) =>
          source.updateIssue({
            issueId: issue.id!,
            state: "todo",
          }),
        { concurrency: "unbounded", discard: true },
      ),
    )
    const maybeRevertIssue = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const yaml = yield* fs.readFileString(prdFile)
      const updated = PrdIssue.arrayFromYaml(yaml)
      const issue = updated.find((i) => i.id === options.issueId)
      if (!issue || issue.state === "in-review") return
      yield* source.updateIssue({
        issueId: issue.id!,
        state: "todo",
      })
    })

    const mergeConflictInstruction =
      "Please rebase and resolve merge conflicts before continuing."

    const flagUnmergable = Effect.fnUntraced(function* (options: {
      readonly issueId: string
    }) {
      const issue = current.find((entry) => entry.id === options.issueId)
      if (!issue) return
      if (issue.description.includes(mergeConflictInstruction)) return

      const nextDescription = `${issue.description.trimEnd()}\n\n${mergeConflictInstruction}`

      yield* source.updateIssue({
        issueId: issue.id!,
        description: nextDescription,
      })
    })

    return {
      path: prdFile,
      mergableGithubPrs,
      revertStateIds,
      maybeRevertIssue,
      flagUnmergable,
    } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Worktree.layer),
  )
}
