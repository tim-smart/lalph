import { Cache, Effect, Layer, Option, Schema, ServiceMap } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { layerKvs } from "./Kvs.ts"
import { allCliAgents } from "./domain/CliAgent.ts"

export class Settings extends ServiceMap.Service<Settings>()("lalph/Settings", {
  make: Effect.gen(function* () {
    const store = KeyValueStore.prefix(
      yield* KeyValueStore.KeyValueStore,
      "settings.",
    )

    const cache = yield* Cache.make({
      lookup(setting: Setting<string, Schema.Codec<any, any>>) {
        const s = KeyValueStore.toSchemaStore(store, setting.schema)
        return Effect.orDie(s.get(setting.name))
      },
      capacity: Number.MAX_SAFE_INTEGER,
    })

    const get = <S extends Schema.Codec<any, any>>(
      setting: Setting<string, S>,
    ): Effect.Effect<Option.Option<S["Type"]>, never, S["DecodingServices"]> =>
      Cache.get(cache, setting)

    const set = <S extends Schema.Codec<any, any>>(
      setting: Setting<string, S>,
      value: Option.Option<S["Type"]>,
    ): Effect.Effect<void, never, S["EncodingServices"]> => {
      const s = KeyValueStore.toSchemaStore(store, setting.schema)
      const setCache = Cache.set(cache, setting, value)
      const update = Option.match(value, {
        onNone: () => Effect.ignore(s.remove(setting.name)),
        onSome: (v) => Effect.orDie(s.set(setting.name, v)),
      })
      return Effect.andThen(update, setCache)
    }

    return { get, set } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(Layer.provide(layerKvs))
}

export class Setting<
  const Name extends string,
  S extends Schema.Codec<any, any>,
> {
  readonly name: Name
  readonly schema: S
  constructor(name: Name, schema: S) {
    this.name = name
    this.schema = schema
  }

  get = Settings.use((s) => s.get(this))

  set(value: Option.Option<S["Type"]>) {
    return Settings.use((s) => s.set(this, value))
  }
}

export const selectedTeamId = new Setting("selectedTeamId", Schema.String)

export const selectedLabelId = new Setting("selectedLabelId", Schema.String)

export const selectedCliAgentId = new Setting(
  "selectedCliAgentId",
  Schema.Literals(allCliAgents.map((a) => a.id)),
)
