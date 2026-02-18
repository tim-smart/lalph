import { Effect, flow, Schema, Stream } from "effect"

export const streamFilterJson = <S extends Schema.Top>(schema: S) => {
  const fromString = Schema.fromJsonString(schema)
  const decode = Schema.decodeEffect(fromString)
  return flow(
    Stream.splitLines,
    Stream.filterEffect((line) => decode(line).pipe(Effect.result)),
  )
}
