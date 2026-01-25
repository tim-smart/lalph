import { Effect, Filter, flow, Schema, Stream } from "effect"

export const streamFilterJson = <S extends Schema.Top>(schema: S) => {
  const fromString = Schema.fromJsonString(schema)
  const decode = Schema.decodeEffect(fromString)
  return flow(
    Stream.splitLines,
    Stream.filterMapEffect((line) =>
      decode(line).pipe(Effect.catch(() => Effect.succeed(Filter.failVoid))),
    ),
  )
}
