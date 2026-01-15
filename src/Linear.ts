import { Effect, Stream, Layer, Schema, ServiceMap, Option } from "effect"
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

    const client = new LinearClient({
      accessToken: (yield* tokens.get).token,
    })

    const use = <A>(f: (client: LinearClient) => Promise<A>) =>
      Effect.tryPromise({
        try: () => f(client),
        catch: (cause) => new LinearError({ cause }),
      })

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

    const projects = stream((client) => client.projects())
    const labels = stream((client) => client.issueLabels())
    const states = yield* Stream.runFold(
      stream((client) => client.workflowStates()),
      () => new Map<string, WorkflowState>(),
      (map, state) => map.set(state.id, state),
    )
    const viewer = yield* use((client) => client.viewer)

    const blockedBy = (issue: Issue) =>
      stream(() => issue.relations()).pipe(
        Stream.filter(
          (relation) =>
            relation.type === "blocks" && relation.relatedIssueId === issue.id,
        ),
        Stream.mapEffect((relation) => use(() => relation.issue!), {
          concurrency: "unbounded",
        }),
        Stream.merge(
          stream(() => issue.inverseRelations()).pipe(
            Stream.filter(
              (relation) =>
                relation.type === "blocks" &&
                relation.relatedIssueId === issue.id,
            ),
            Stream.mapEffect((relation) => use(() => relation.issue!), {
              concurrency: "unbounded",
            }),
          ),
        ),
        Stream.filter((issue) => {
          const state = states.get(issue.stateId!)!
          return state.type !== "completed"
        }),
        Stream.runCollect,
      )

    return { use, stream, projects, labels, states, viewer, blockedBy } as const
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

    // Map of linear identifier to issue id
    const identifierMap = new Map<string, string>()

    const statesMap = new Map<
      string,
      {
        readonly id: string
        readonly name: string
        readonly kind: "unstarted" | "started" | "completed"
      }
    >()
    linear.states.forEach((state) => {
      statesMap.set(state.id, {
        id: state.id,
        name: state.name,
        kind:
          state.type === "started"
            ? "started"
            : state.type === "unstarted"
              ? "unstarted"
              : "completed",
      })
    })

    const canceledState = Array.from(linear.states.values()).find(
      (state) => state.type === "canceled",
    )!

    const issues = linear
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
              type: { in: ["unstarted", "started", "completed"] },
            },
          },
        }),
      )
      .pipe(
        Stream.mapEffect(
          Effect.fnUntraced(function* (issue) {
            identifierMap.set(issue.identifier, issue.id)
            const state = linear.states.get(issue.stateId!)!
            const blockedBy = yield* linear.blockedBy(issue)
            return new PrdIssue({
              id: issue.identifier,
              title: issue.title,
              description: issue.description ?? "",
              priority: issue.priority,
              estimate: issue.estimate ?? null,
              stateId: issue.stateId!,
              complete: state.type !== "unstarted",
              blockedBy: blockedBy.map((i) => i.identifier),
            })
          }),
          { concurrency: 10 },
        ),
        Stream.runCollect,
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      )

    return IssueSource.of({
      states: Effect.succeed(statesMap),
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
              stateId: issue.stateId,
            }),
          )
          const linearIssue = yield* linear.use(() => created.issue!)
          identifierMap.set(linearIssue.identifier, linearIssue.id)
          return linearIssue.identifier
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      updateIssue: Effect.fnUntraced(
        function* (options) {
          const issueId = identifierMap.get(options.issueId)!
          const update = { ...options } as any
          delete update.issueId
          delete update.blockedBy
          yield* linear.use((c) => c.updateIssue(issueId, update))
          if (!options.blockedBy || options.blockedBy.length === 0) return
          yield* Effect.forEach(
            options.blockedBy,
            (identifier) => {
              const blockerIssueId = identifierMap.get(identifier)!
              return linear
                .use((c) =>
                  c.createIssueRelation({
                    issueId: blockerIssueId,
                    relatedIssueId: issueId,
                    type: IssueRelationType.Blocks,
                  }),
                )
                .pipe(Effect.ignore)
            },
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

  const project = yield* Prompt.select({
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
  const teamId = yield* Prompt.select({
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
  const labelId = yield* Prompt.select({
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
  const labedId = yield* selectedLabelId.get
  if (Option.isSome(labedId)) {
    return labedId.value
  }
  return yield* labelIdSelect
})
