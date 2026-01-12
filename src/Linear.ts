import { Effect, Stream, Layer, Schema, ServiceMap, Option } from "effect"
import { Connection, LinearClient } from "@linear/sdk"
import { TokenManager } from "./Linear/TokenManager.ts"

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

    return { use, stream, projects } as const
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
