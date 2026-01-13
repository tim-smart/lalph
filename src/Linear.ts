import { Effect, Stream, Layer, Schema, ServiceMap, Option } from "effect"
import {
  Connection,
  IssueLabel,
  LinearClient,
  Project,
  WorkflowState,
} from "@linear/sdk"
import { TokenManager } from "./Linear/TokenManager.ts"
import { KeyValueStore } from "effect/unstable/persistence"
import { Prompt } from "effect/unstable/cli"
import { layerKvs } from "./Kvs.ts"
import { selectedLabelId, selectedTeamId, Settings } from "./Settings.ts"

export class Linear extends ServiceMap.Service<Linear>()("lalph/Linear", {
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

    return { use, stream, projects, labels, states, viewer } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(TokenManager.layer),
  )
}

export class LinearError extends Schema.ErrorClass("lalph/LinearError")({
  _tag: Schema.tag("LinearError"),
  cause: Schema.Defect,
}) {}

export class CurrentProject extends ServiceMap.Service<
  CurrentProject,
  Project
>()("lalph/Linear/CurrentProject") {
  static store = KeyValueStore.KeyValueStore.use((_) =>
    Effect.succeed(KeyValueStore.prefix(_, "linear.currentProjectId")),
  )

  static select = Effect.gen(function* () {
    const kvs = yield* CurrentProject.store
    const linear = yield* Linear

    const projects = yield* Stream.runCollect(linear.projects)

    const project = yield* Prompt.select({
      message: "Select a Linear project",
      choices: projects.map((project) => ({
        title: project.name,
        value: project,
      })),
    })

    yield* kvs.set("", project.id)

    yield* teamSelect(project)
    yield* labelSelect

    return project
  })

  static get = Effect.gen(function* () {
    const linear = yield* Linear
    const kvs = yield* CurrentProject.store
    const projectId = yield* kvs.get("")

    return projectId
      ? yield* linear
          .use((c) => c.project(projectId))
          .pipe(Effect.catch(() => CurrentProject.select))
      : yield* CurrentProject.select
  })

  static layer = Layer.effect(this, this.get).pipe(
    Layer.provide([Linear.layer, layerKvs, Settings.layer]),
  )
}

export const labelSelect = Effect.gen(function* () {
  const linear = yield* Linear
  const labels = yield* Stream.runCollect(linear.labels)
  const label = yield* Prompt.select({
    message: "Select a label to filter issues by",
    choices: [
      {
        title: "No Label",
        value: Option.none<IssueLabel>(),
      },
    ].concat(
      labels.map((label) => ({
        title: label.name,
        value: Option.some(label),
      })),
    ),
  })
  yield* selectedLabelId.set(Option.map(label, (l) => l.id))
  return label
})

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
})
