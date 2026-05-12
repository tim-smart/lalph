import { Effect, Schema, SchemaGetter } from "effect"

export const withEncodeDefault =
  <S extends Schema.Top>(defaultValue: Effect.Effect<S["Type"]>) =>
  (schema: S) =>
    Schema.optionalKey(schema).pipe(
      Schema.decodeTo(Schema.toType(schema), {
        decode: SchemaGetter.withDefault(defaultValue),
        encode: SchemaGetter.required(),
      }),
    )
