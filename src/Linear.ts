import {
  DateTime,
  Duration,
  Effect,
  Stream,
  Layer,
  Schema,
  ServiceMap,
  Option,
  RcMap,
} from "effect"
import {
  Connection,
  Issue,
  IssueRelationType,
  LinearClient,
  Project,
  WorkflowState,
} from "@linear/sdk"
import { TokenManager } from "./Linear/TokenManager.ts"
import { Prompt } from "effect/unstable/cli"
import { Setting } from "./Settings.ts"
import { IssueSource, IssueSourceError } from "./IssueSource.ts"
import { PrdIssue } from "./domain/PrdIssue.ts"

class Linear extends ServiceMap.Service<Linear>()("lalph/Linear", {
  make: Effect.gen(function* () {
    const tokens = yield* TokenManager
    const clients = yield* RcMap.make({
      lookup: (token: string) =>
        Effect.succeed(new LinearClient({ accessToken: token })),
      idleTimeToLive: "1 minute",
    })
    const getClient = tokens.get.pipe(
      Effect.flatMap(({ token }) => RcMap.get(clients, token)),
      Effect.mapError((cause) => new LinearError({ cause })),
    )

    const use = <A>(
      f: (client: LinearClient) => Promise<A>,
    ): Effect.Effect<A, LinearError> =>
      getClient.pipe(
        Effect.flatMap((client) =>
          Effect.tryPromise({
            try: () => f(client),
            catch: (cause) => new LinearError({ cause }),
          }),
        ),
        Effect.scoped,
      )

    const stream = <A>(f: (client: LinearClient) => Promise<Connection<A>>) =>
      Stream.paginate(
        null as null | Connection<A>,
        Effect.fnUntraced(function* (prev) {
          const connection = yield* prev
            ? Effect.tryPromise({
                try: () => prev.fetchNext(),
                catch: (cause) => new LinearError({ cause }),
              })
            : use(f)

          return [
            connection.nodes,
            Option.some(connection).pipe(
              Option.filter((c) => c.pageInfo.hasNextPage),
            ),
          ]
        }),
      )

    const projects = stream((client) =>
      client.projects({
        filter: {
          status: {
            type: { nin: ["canceled", "completed"] },
          },
        },
      }),
    )
    const labels = stream((client) => client.issueLabels())
    const states = yield* Stream.runCollect(
      stream((client) => client.workflowStates()),
    )
    const viewer = yield* use((client) => client.viewer)

    const blockedByRelations = (issue: Issue) =>
      stream(() => issue.relations()).pipe(
        Stream.merge(stream(() => issue.inverseRelations())),
        Stream.filter(
          (relation) =>
            relation.type === "blocks" && relation.relatedIssueId === issue.id,
        ),
      )

    const blockedBy = (issue: Issue) =>
      blockedByRelations(issue).pipe(
        Stream.mapEffect((relation) => use(() => relation.issue!), {
          concurrency: "unbounded",
        }),
        Stream.filter((issue) => {
          const state = states.find((s) => s.id === issue.stateId)!
          return state.type !== "completed"
        }),
      )

    return {
      use,
      stream,
      projects,
      labels,
      states,
      viewer,
      blockedBy,
      blockedByRelations,
    } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(TokenManager.layer),
  )
}

export const LinearIssueSource = Layer.effect(
  IssueSource,
  Effect.gen(function* () {
    const linear = yield* Linear

    const project = yield* getOrSelectProject
    const teamId = yield* getOrSelectTeamId(project)
    const labelId = yield* getOrSelectLabel
    const autoMergeLabelId = yield* getOrSelectAutoMergeLabel

    // Map of linear identifier to issue id
    const identifierMap = new Map<string, string>()

    const backlogState =
      linear.states.find(
        (s) => s.type === "backlog" && s.name.toLowerCase().includes("backlog"),
      ) || linear.states.find((s) => s.type === "backlog")!
    const todoState =
      linear.states.find(
        (s) =>
          s.type === "unstarted" &&
          (s.name.toLowerCase().includes("todo") ||
            s.name.toLowerCase().includes("unstarted")),
      ) || linear.states.find((s) => s.type === "unstarted")!
    const inProgressState =
      linear.states.find(
        (s) =>
          s.type === "started" &&
          (s.name.toLowerCase().includes("progress") ||
            s.name.toLowerCase().includes("started")),
      ) || linear.states.find((s) => s.type === "started")!
    const inReviewState =
      linear.states.find(
        (s) => s.type === "started" && s.name.toLowerCase().includes("review"),
      ) || linear.states.find((s) => s.type === "completed")!
    const doneState = linear.states.find((s) => s.type === "completed")!

    const canceledState = linear.states.find(
      (state) => state.type === "canceled",
    )!

    const linearStateToPrdState = (state: WorkflowState): PrdIssue["state"] => {
      switch (state.id) {
        case backlogState.id:
          return "backlog"
        case todoState.id:
          return "todo"
        case inProgressState.id:
          return "in-progress"
        case inReviewState.id:
          return "in-review"
        case doneState.id:
          return "done"
        default:
          if (state.type === "backlog") return "backlog"
          if (state.type === "unstarted") return "todo"
          if (state.type === "started") return "in-progress"
          if (state.type === "completed") return "done"
          return "backlog"
      }
    }
    const prdStateToLinearStateId = (state: PrdIssue["state"]): string => {
      switch (state) {
        case "backlog":
          return backlogState.id
        case "todo":
          return todoState.id
        case "in-progress":
          return inProgressState.id
        case "in-review":
          return inReviewState.id
        case "done":
          return doneState.id
      }
    }

    const issues = Effect.gen(function* () {
      const startTime = yield* DateTime.now
      yield* Effect.logDebug("Linear.issues: fetching from Linear API...")

      const result = yield* linear
        .stream((c) =>
          c.issues({
            filter: {
              project: { id: { eq: project.id } },
              assignee: { isMe: { eq: true } },
              labels: {
                id: labelId.pipe(
                  Option.map((eq) => ({ eq })),
                  Option.getOrNull,
                ),
              },
              state: {
                type: { in: ["unstarted", "started", "completed"] },
              },
            },
          }),
        )
        .pipe(
          Stream.filter((issue) => {
            const completedAt = issue.completedAt
            if (!completedAt) return true
            const completed = DateTime.makeUnsafe(completedAt)
            const threeDaysAgo = DateTime.nowUnsafe().pipe(
              DateTime.subtract({ days: 3 }),
            )
            return DateTime.isGreaterThanOrEqualTo(completed, threeDaysAgo)
          }),
          Stream.mapEffect(
            Effect.fnUntraced(function* (issue) {
              identifierMap.set(issue.identifier, issue.id)
              const linearState = linear.states.find(
                (s) => s.id === issue.stateId,
              )!
              const blockedBy = yield* Stream.runCollect(
                linear.blockedBy(issue),
              )
              const state = linearStateToPrdState(linearState)
              return new PrdIssue({
                id: issue.identifier,
                title: issue.title,
                description: issue.description ?? "",
                priority: issue.priority,
                estimate: issue.estimate ?? null,
                state,
                blockedBy: blockedBy.map((i) => i.identifier),
                autoMerge: autoMergeLabelId.pipe(
                  Option.map((labelId) => issue.labelIds.includes(labelId)),
                  Option.getOrElse(() => false),
                ),
                githubPrNumber: null,
              })
            }),
            { concurrency: 10 },
          ),
          Stream.runCollect,
        )

      const elapsed = yield* DateTime.now.pipe(
        Effect.map((now) => DateTime.distanceDuration(startTime, now)),
      )
      yield* Effect.logDebug(
        `Linear.issues: fetched ${result.length} issues (with dependencies) in ${Duration.format(elapsed)}`,
      )

      return result
    }).pipe(Effect.mapError((cause) => new IssueSourceError({ cause })))

    return IssueSource.of({
      issues,
      createIssue: Effect.fnUntraced(
        function* (issue: PrdIssue) {
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
              stateId: prdStateToLinearStateId(issue.state),
            }),
          )
          const linearIssue = yield* linear.use(() => created.issue!)
          identifierMap.set(linearIssue.identifier, linearIssue.id)
          if (issue.blockedBy.length > 0) {
            yield* Effect.forEach(
              issue.blockedBy,
              (identifier) => {
                const blockerIssueId = identifierMap.get(identifier)
                if (!blockerIssueId) return Effect.void
                return linear
                  .use((c) =>
                    c.createIssueRelation({
                      issueId: blockerIssueId,
                      relatedIssueId: linearIssue.id,
                      type: IssueRelationType.Blocks,
                    }),
                  )
                  .pipe(Effect.ignore)
              },
              { concurrency: 5, discard: true },
            )
          }
          return linearIssue.identifier
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      updateIssue: Effect.fnUntraced(
        function* (options) {
          const issueId = identifierMap.get(options.issueId)!
          const update: {
            title?: string
            description?: string
            stateId?: string
          } = {}
          if (options.title) {
            update.title = options.title
          }
          if (options.description) {
            update.description = options.description
          }
          if (options.state) {
            update.stateId = prdStateToLinearStateId(options.state)
          }
          yield* linear.use((c) => c.updateIssue(issueId, update))
          if (!options.blockedBy) return

          const blockedBy = options.blockedBy.flatMap((identifier) => {
            const blockerIssueId = identifierMap.get(identifier)
            return blockerIssueId ? [blockerIssueId] : []
          })

          const linearIssue = yield* linear.use((c) => c.issue(issueId))
          const existingRelations = yield* Stream.runCollect(
            linear.blockedByRelations(linearIssue),
          )
          const existingBlockers = new Map(
            existingRelations.map((relation) => [
              relation.issueId!,
              relation.id,
            ]),
          )

          const toAdd = blockedBy.filter(
            (blockerIssueId) => !existingBlockers.has(blockerIssueId),
          )
          const toRemove = existingRelations.filter(
            (relation) => !blockedBy.includes(relation.issueId!),
          )

          if (toAdd.length === 0 && toRemove.length === 0) return

          yield* Effect.forEach(
            toAdd,
            (blockerIssueId) =>
              linear
                .use((c) =>
                  c.createIssueRelation({
                    issueId: blockerIssueId,
                    relatedIssueId: issueId,
                    type: IssueRelationType.Blocks,
                  }),
                )
                .pipe(Effect.ignore),
            { concurrency: 5 },
          )

          yield* Effect.forEach(
            toRemove,
            (relation) =>
              linear
                .use((c) => c.deleteIssueRelation(relation.id))
                .pipe(Effect.ignore),
            { concurrency: 5 },
          )
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      cancelIssue: Effect.fnUntraced(
        function* (issueId: string) {
          const linearIssueId = identifierMap.get(issueId)!
          yield* linear.use((c) =>
            c.updateIssue(linearIssueId, {
              stateId: canceledState.id,
            }),
          )
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
    })
  }),
).pipe(Layer.provide(Linear.layer))

export const resetLinear = Effect.gen(function* () {
  yield* selectedProjectId.set(Option.none())
  yield* selectedTeamId.set(Option.none())
  yield* selectedLabelId.set(Option.none())
  yield* selectedAutoMergeLabelId.set(Option.none())
})

export class LinearError extends Schema.ErrorClass("lalph/LinearError")({
  _tag: Schema.tag("LinearError"),
  cause: Schema.Defect,
}) {}

// Project selection

const selectedProjectId = new Setting("linear.selectedProjectId", Schema.String)
const selectProject = Effect.gen(function* () {
  const linear = yield* Linear

  const projects = yield* Stream.runCollect(linear.projects)

  const project = yield* Prompt.autoComplete({
    message: "Select a Linear project",
    choices: projects.map((project) => ({
      title: project.name,
      value: project,
    })),
  })

  yield* selectedProjectId.set(Option.some(project.id))

  return project
})
const getOrSelectProject = Effect.gen(function* () {
  const linear = yield* Linear
  return yield* selectedProjectId.get.pipe(
    Effect.flatMap((o) => o.asEffect()),
    Effect.flatMap((projectId) => linear.use((c) => c.project(projectId))),
    Effect.catch(() => selectProject),
  )
})

// Team selection

const selectedTeamId = new Setting("linear.selectedTeamId", Schema.String)
const teamSelect = Effect.fnUntraced(function* (project: Project) {
  const linear = yield* Linear
  const teams = yield* Stream.runCollect(linear.stream(() => project.teams()))
  const teamId = yield* Prompt.autoComplete({
    message: "Select a team for new issues",
    choices: teams.map((team) => ({
      title: team.name,
      value: team.id,
    })),
  })
  yield* selectedTeamId.set(Option.some(teamId))
  return teamId
})
const getOrSelectTeamId = Effect.fnUntraced(function* (project: Project) {
  const teamIdOption = yield* selectedTeamId.get
  if (Option.isSome(teamIdOption)) {
    return teamIdOption.value
  }
  return yield* teamSelect(project)
})

// Label filter selection

const selectedLabelId = new Setting(
  "linear.selectedLabelId",
  Schema.Option(Schema.String),
)
const labelIdSelect = Effect.gen(function* () {
  const linear = yield* Linear
  const labels = yield* Stream.runCollect(linear.labels)
  const labelId = yield* Prompt.autoComplete({
    message: "Select a label to filter issues by",
    choices: [
      {
        title: "No Label",
        value: Option.none<string>(),
      },
    ].concat(
      labels.map((label) => ({
        title: label.name,
        value: Option.some(label.id),
      })),
    ),
  })
  yield* selectedLabelId.set(Option.some(labelId))
  return labelId
})
const getOrSelectLabel = Effect.gen(function* () {
  const labelId = yield* selectedLabelId.get
  if (Option.isSome(labelId)) {
    return labelId.value
  }
  return yield* labelIdSelect
})

// Auto merge label selection

const selectedAutoMergeLabelId = new Setting(
  "linear.selectedAutoMergeLabelId",
  Schema.Option(Schema.String),
)
const autoMergeLabelIdSelect = Effect.gen(function* () {
  const linear = yield* Linear
  const labels = yield* Stream.runCollect(linear.labels)
  const labelId = yield* Prompt.autoComplete({
    message: "Select a label to mark issues for auto merge",
    choices: [
      {
        title: "Disabled",
        value: Option.none<string>(),
      },
    ].concat(
      labels.map((label) => ({
        title: label.name,
        value: Option.some(label.id),
      })),
    ),
  })
  yield* selectedAutoMergeLabelId.set(Option.some(labelId))
  return labelId
})
const getOrSelectAutoMergeLabel = Effect.gen(function* () {
  const labelId = yield* selectedAutoMergeLabelId.get
  if (Option.isSome(labelId)) {
    return labelId.value
  }
  return yield* autoMergeLabelIdSelect
})
