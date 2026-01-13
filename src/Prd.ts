import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  ServiceMap,
  Stream,
} from "effect"
import { CurrentProject, Linear } from "./Linear.ts"
import { selectedLabelId, selectedTeamId } from "./Settings.ts"
import type { Issue } from "@linear/sdk"
import { Worktree } from "./Worktree.ts"
import { PrdIssue, PrdList } from "./domain/PrdIssue.ts"
import type { Mutable } from "effect/Types"

export class Prd extends ServiceMap.Service<Prd>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const linear = yield* Linear
    const project = yield* CurrentProject
    const teamId = Option.getOrThrow(yield* selectedTeamId.get)
    const labelId = yield* selectedLabelId.get

    const getIssues = (states: Array<string>) =>
      linear
        .stream(() =>
          project.issues({
            filter: {
              assignee: { isMe: { eq: true } },
              labels: {
                id: labelId.pipe(
                  Option.map((eq) => ({ eq })),
                  Option.getOrNull,
                ),
              },
              state: {
                type: { in: states },
              },
            },
          }),
        )
        .pipe(Stream.runCollect)

    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.json`)

    const initial = listFromLinear(yield* getIssues(["unstarted"]))
    yield* fs.writeFileString(prdFile, initial.toJson())

    const checkForWork = Effect.suspend(() => {
      if (initial.issues.size > 0) {
        return new NoMoreWork({}).asEffect()
      }
      return Effect.void
    })

    const updatedIssues = new Map<
      string,
      {
        readonly issue: Issue
        readonly originalStateId: string
        count: number
      }
    >()

    const sync = Effect.gen(function* () {
      const json = yield* fs.readFileString(prdFile)
      const updated = PrdList.fromJson(json)
      const current = listFromLinear(yield* getIssues(["unstarted", "started"]))
      let createdIssues = 0

      for (const issue of updated) {
        if (issue.id === null) {
          // create new issue
          const created = yield* linear.use((c) =>
            c.createIssue({
              teamId,
              projectId: project.id,
              assigneeId: linear.viewer.id,
              labelIds: Option.toArray(labelId),
              title: issue.title,
              description: issue.description,
              priority: issue.priority,
              estimate: issue.estimate,
              stateId: issue.stateId,
            }),
          )
          const mutable = issue as Mutable<PrdIssue>
          mutable.id = created.issueId ?? null
          createdIssues++
          continue
        }
        const existing = current.issues.get(issue.id)
        if (!existing || !existing.isChangedComparedTo(issue)) continue
        const original = current.cast<Issue>().orignals.get(issue.id)!

        // update existing issue
        yield* linear.use((c) =>
          c.updateIssue(original.id, {
            description: issue.description,
            stateId: issue.stateId,
          }),
        )

        let entry = updatedIssues.get(issue.id)
        if (!entry) {
          entry = {
            issue: original,
            originalStateId: original.stateId!,
            count: 0,
          }
          updatedIssues.set(issue.id, entry)
        }
        entry.count++
      }

      if (createdIssues === 0) return
      yield* fs.writeFileString(prdFile, PrdIssue.arrayToJson(updated))
    }).pipe(Effect.uninterruptible)

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
          return Effect.asVoid(
            linear.use((c) =>
              c.updateIssue(issue.id, {
                stateId: originalStateId,
              }),
            ),
          )
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

    return { path: prdFile, mergableGithubPrs, checkForWork } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide([CurrentProject.layer, Worktree.layer]),
  )
}

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}

const issueFromLinear = (issue: Issue): PrdIssue => {
  return new PrdIssue({
    id: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority,
    estimate: issue.estimate ?? null,
    stateId: issue.stateId!,
    githubPrNumber: null,
  })
}

const listFromLinear = (issues: Array<Issue>): PrdList => {
  const map = new Map<string, PrdIssue>()
  const originalMap = new Map<string, Issue>()
  for (const issue of issues) {
    const prdIssue = issueFromLinear(issue)
    if (!prdIssue.id) continue
    map.set(prdIssue.id, prdIssue)
    originalMap.set(prdIssue.id, issue)
  }
  return new PrdList({ issues: map, orignals: originalMap })
}
