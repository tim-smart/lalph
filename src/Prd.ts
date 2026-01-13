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

export class Prd extends ServiceMap.Service<Prd>()("lalph/Prd", {
  make: Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const linear = yield* Linear
    const project = yield* CurrentProject
    const teamId = Option.getOrThrow(yield* selectedTeamId.get)
    const labelId = yield* selectedLabelId.get

    const getIssues = linear
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
              type: { eq: "unstarted" },
            },
          },
        }),
      )
      .pipe(Stream.runCollect)

    const prdFile = pathService.join(worktree.directory, `.lalph`, `prd.json`)

    const updatePrdFile = Effect.gen(function* () {
      const initial = yield* getIssues.pipe(Effect.map(listFromLinear))
      yield* fs.writeFileString(prdFile, initial.toJson())
      return initial
    })

    const initial = yield* updatePrdFile
    if (initial.issues.size === 0) {
      return yield* new NoMoreWork({})
    }

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
      const current = listFromLinear(yield* getIssues)
      const updated = PrdList.fromJson(json)

      for (const issue of updated) {
        if (issue.id === null) {
          // create new issue
          yield* linear.use((c) =>
            c.createIssue({
              teamId,
              projectId: project.id,
              labelIds: Option.toArray(labelId),
              title: issue.title,
              description: issue.description,
              priority: issue.priority,
              estimate: issue.estimate,
              stateId: issue.stateId,
            }),
          )
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
    }).pipe(Effect.uninterruptible, Effect.makeSemaphoreUnsafe(1).withPermit)

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        updatedIssues.values(),
        ({ issue, count, originalStateId }) => {
          if (count > 1) return Effect.void
          return linear.use((c) =>
            c.updateIssue(issue.id, {
              stateId: originalStateId,
            }),
          )
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.ignore),
    )

    yield* Effect.addFinalizer(() => Effect.ignore(sync))

    yield* fs.watch(prdFile).pipe(
      Stream.buffer({
        capacity: 1,
        strategy: "dropping",
      }),
      Stream.runForEach(() => Effect.ignore(sync)),
      Effect.forkScoped,
    )

    return { path: prdFile } as const
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
