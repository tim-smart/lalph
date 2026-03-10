import { Array, Effect, identity, Option, Schema } from "effect"
import { CliAgentFromId } from "./CliAgent.ts"
import { ChildProcess } from "effect/unstable/process"
import { ClankaProvider, normalizeLegacyClankaConfig } from "../ClankaModels.ts"

export const CliAgentPresetId = Schema.NonEmptyString.pipe(
  Schema.brand("lalph/CliAgentPresetId"),
)
export type CliAgentPresetId = typeof CliAgentPresetId.Type

export class CliAgentPreset extends Schema.Class<CliAgentPreset>(
  "lalph/CliAgentPreset",
)({
  id: CliAgentPresetId,
  cliAgent: CliAgentFromId,
  commandPrefix: Schema.Array(Schema.String),
  extraArgs: Schema.Array(Schema.String),
  sourceMetadata: Schema.Record(Schema.String, Schema.Any),
  clankaProvider: Schema.optionalKey(ClankaProvider),
  clankaModel: Schema.optionalKey(Schema.String),
}) {
  static defaultId = CliAgentPresetId.makeUnsafe("default")

  get clankaConfig():
    | {
        readonly provider: ClankaProvider
        readonly model: string
      }
    | undefined {
    if (
      this.clankaProvider !== undefined &&
      this.clankaModel !== undefined &&
      this.clankaModel.trim() !== ""
    ) {
      return {
        provider: this.clankaProvider,
        model: this.clankaModel.trim(),
      }
    }

    if (this.clankaModel === undefined || this.clankaModel.trim() === "") {
      return undefined
    }

    return (
      normalizeLegacyClankaConfig(this.clankaModel) ?? {
        provider: "codex",
        model: this.clankaModel.trim(),
      }
    )
  }

  decodeMetadata<S extends Schema.Top>(
    source: string,
    schema: S,
  ): Effect.Effect<Option.Option<S["Type"]>, never, S["DecodingServices"]> {
    const data = this.sourceMetadata[source]
    if (data === undefined) {
      return Effect.succeedNone
    }
    return Effect.option(Schema.decodeEffect(schema)(data))
  }

  addMetadata<S extends Schema.Top>(
    source: string,
    schema: S,
    value: S["Type"],
  ): Effect.Effect<CliAgentPreset, never, S["EncodingServices"]> {
    return Schema.encodeEffect(Schema.toCodecJson(schema))(value).pipe(
      Effect.orDie,
      Effect.map(
        (encoded) =>
          new CliAgentPreset({
            ...this,
            sourceMetadata: {
              ...this.sourceMetadata,
              [source]: encoded,
            },
          }),
      ),
    )
  }

  readonly withCommandPrefix = Array.isReadonlyArrayNonEmpty(this.commandPrefix)
    ? ChildProcess.prefix(this.commandPrefix[0], this.commandPrefix)
    : identity
}
