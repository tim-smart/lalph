// oxlint-disable typescript/no-explicit-any
import { Cache, Effect, Layer, Option, Schema, Context } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { layerKvs, ProjectsKvs } from "./Kvs.ts"
import { allCliAgents } from "./domain/CliAgent.ts"
import { Project, ProjectId } from "./domain/Project.ts"
import { Reactivity } from "effect/unstable/reactivity"

export class Settings extends Context.Service<Settings>()("lalph/Settings", {
  make: Effect.gen(function* () {
    const kvs = yield* KeyValueStore.KeyValueStore
    const projectKvs = yield* ProjectsKvs
    const reactivity = yield* Reactivity.Reactivity

    const store = KeyValueStore.prefix(kvs, "settings.")

    const cache = yield* Cache.make({
      lookup(setting: Setting<string, Schema.Codec<any, any>>) {
        const s = KeyValueStore.toSchemaStore(store, setting.schema)
        return Effect.orDie(s.get(setting.name))
      },
      capacity: Number.MAX_SAFE_INTEGER,
    })

    const projectCache = yield* Cache.make({
      lookup: Effect.fnUntraced(function* (options: {
        readonly projectId: ProjectId
        readonly setting: ProjectSetting<string, Schema.Codec<any, any>>
      }) {
        const services = yield* projectKvs.contextEffect(options.projectId)
        const store = KeyValueStore.toSchemaStore(
          Context.get(services, KeyValueStore.KeyValueStore),
          options.setting.schema,
        )
        return yield* Effect.orDie(store.get(options.setting.name))
      }, Effect.scoped),
      capacity: Number.MAX_SAFE_INTEGER,
      requireServicesAt: "lookup",
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
      return reactivity.mutation(
        [`settings:${setting.name}`],
        Effect.andThen(update, setCache),
      )
    }

    const getProject = <S extends Schema.Codec<any, any>>(
      setting: ProjectSetting<string, S>,
    ): Effect.Effect<
      Option.Option<S["Type"]>,
      never,
      S["DecodingServices"] | CurrentProjectId
    > =>
      CurrentProjectId.use((projectId) =>
        Cache.get(projectCache, {
          projectId,
          setting,
        }),
      )

    const setProject: <S extends Schema.Codec<any, any>>(
      setting: ProjectSetting<string, S>,
      value: Option.Option<S["Type"]>,
    ) => Effect.Effect<void, never, CurrentProjectId> = Effect.fnUntraced(
      function* <S extends Schema.Codec<any, any>>(
        setting: ProjectSetting<string, S>,
        value: Option.Option<S["Type"]>,
      ) {
        const projectId = yield* CurrentProjectId
        const services = yield* projectKvs.contextEffect(projectId)
        const s = KeyValueStore.toSchemaStore(
          Context.get(services, KeyValueStore.KeyValueStore),
          setting.schema,
        )
        const setCache = Cache.set(
          projectCache,
          {
            projectId,
            setting,
          },
          value,
        )
        const update = Option.match(value, {
          onNone: () => Effect.ignore(s.remove(setting.name)),
          onSome: (v) => Effect.orDie(s.set(setting.name, v)),
        })
        yield* reactivity.mutation(
          [`settings.${projectId}:${setting.name}`],
          Effect.andThen(update, setCache),
        )
      },
      Effect.scoped,
    )

    return { get, set, getProject, setProject } as const
  }).pipe(Effect.withSpan("Settings.build")),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide([layerKvs, ProjectsKvs.layer, Reactivity.layer]),
  )

  static get<Name extends string, S extends Schema.Codec<any, any>>(
    setting: Setting<Name, S>,
  ) {
    return Settings.use((_) => _.get(setting))
  }
  static set<Name extends string, S extends Schema.Codec<any, any>>(
    setting: Setting<Name, S>,
    value: Option.Option<S["Type"]>,
  ) {
    return Settings.use((_) => _.set(setting, value))
  }
  static update<Name extends string, S extends Schema.Codec<any, any>>(
    setting: Setting<Name, S>,
    f: (current: Option.Option<S["Type"]>) => Option.Option<S["Type"]>,
  ) {
    return Settings.use((_) =>
      _.get(setting).pipe(
        Effect.map(f),
        Effect.flatMap((v) => _.set(setting, v)),
      ),
    )
  }

  static getProject<Name extends string, S extends Schema.Codec<any, any>>(
    setting: ProjectSetting<Name, S>,
  ) {
    return Settings.use((_) => _.getProject(setting))
  }
  static setProject<Name extends string, S extends Schema.Codec<any, any>>(
    setting: ProjectSetting<Name, S>,
    value: Option.Option<S["Type"]>,
  ) {
    return Settings.use((_) => _.setProject(setting, value))
  }
}

export class CurrentProjectId extends Context.Service<
  CurrentProjectId,
  ProjectId
>()("lalph/CurrentProjectId") {}

export class Setting<
  const Name extends string,
  S extends Schema.Codec<any, any>,
> {
  readonly _tag = "Setting"
  readonly name: Name
  readonly schema: S
  constructor(name: Name, schema: S) {
    this.name = name
    this.schema = schema
  }
}
export class ProjectSetting<
  const Name extends string,
  S extends Schema.Codec<any, any>,
> {
  readonly _tag = "ProjectSetting"
  readonly name: Name
  readonly schema: S
  constructor(name: Name, schema: S) {
    this.name = name
    this.schema = schema
  }
}

export const selectedCliAgentId = new Setting(
  "selectedCliAgentId",
  Schema.Literals(allCliAgents.map((a) => a.id)),
)

export const allProjects = new Setting("projects", Schema.Array(Project))
