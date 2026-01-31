// oxlint-disable typescript/no-explicit-any
import {
  Cache,
  Effect,
  Layer,
  Option,
  PlatformError,
  Schema,
  ServiceMap,
} from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { layerKvs, ProjectsKvs } from "./Kvs.ts"
import { allCliAgents } from "./domain/CliAgent.ts"
import { Project, ProjectId } from "./domain/Project.ts"
import { atomRuntime } from "./shared/runtime.ts"
import { CurrentProjectId } from "./Projects.ts"
import { AsyncResult, Atom } from "effect/unstable/reactivity"

export class Settings extends ServiceMap.Service<Settings>()("lalph/Settings", {
  make: Effect.gen(function* () {
    const kvs = yield* KeyValueStore.KeyValueStore
    const projectKvs = yield* ProjectsKvs
    const store = KeyValueStore.prefix(kvs, "settings.")

    const cache = yield* Cache.make({
      lookup(setting: Setting<string, Schema.Codec<any, any>>) {
        const s = KeyValueStore.toSchemaStore(store, setting.schema)
        return Effect.orDie(s.get(setting.name))
      },
      capacity: Number.MAX_SAFE_INTEGER,
    })

    const projectCache = yield* Cache.make({
      lookup: Effect.fnUntraced(function* (
        setting: ProjectSetting<string, Schema.Codec<any, any>>,
      ) {
        const projectId = yield* CurrentProjectId
        const services = yield* projectKvs.services(projectId)
        const store = KeyValueStore.toSchemaStore(
          ServiceMap.get(services, KeyValueStore.KeyValueStore),
          setting.schema,
        )
        return yield* Effect.orDie(store.get(setting.name))
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
      return Effect.andThen(update, setCache)
    }

    const getProject = <S extends Schema.Codec<any, any>>(
      setting: ProjectSetting<string, S>,
    ): Effect.Effect<
      Option.Option<S["Type"]>,
      never,
      S["DecodingServices"] | CurrentProjectId
    > => Cache.get(projectCache, setting)

    const setProject: <S extends Schema.Codec<any, any>>(
      setting: ProjectSetting<string, S>,
      value: Option.Option<S["Type"]>,
    ) => Effect.Effect<void, never, CurrentProjectId> = Effect.fnUntraced(
      function* <S extends Schema.Codec<any, any>>(
        setting: ProjectSetting<string, S>,
        value: Option.Option<S["Type"]>,
      ) {
        const projectId = yield* CurrentProjectId
        const services = yield* projectKvs.services(projectId)
        const s = KeyValueStore.toSchemaStore(
          ServiceMap.get(services, KeyValueStore.KeyValueStore),
          setting.schema,
        )
        const setCache = Cache.set(projectCache, setting, value)
        const update = Option.match(value, {
          onNone: () => Effect.ignore(s.remove(setting.name)),
          onSome: (v) => Effect.orDie(s.set(setting.name, v)),
        })
        yield* update
        yield* setCache
      },
      Effect.scoped,
    )

    return { get, set, getProject, setProject } as const
  }).pipe(Effect.withSpan("Settings.build")),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide([layerKvs, ProjectsKvs.layer]),
  )
  static runtime = atomRuntime(this.layer)

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

  static atom<Name extends string, S extends Schema.Codec<any, any>>(
    setting: Setting<Name, S>,
  ): Atom.Writable<
    AsyncResult.AsyncResult<
      Option.Option<S["Type"]>,
      PlatformError.PlatformError
    >,
    Option.Option<S["Type"]>
  > {
    const read = Settings.runtime.atom(Settings.get(setting))
    const set = Settings.runtime.fn<Option.Option<S["Type"]>>()(
      Effect.fnUntraced(function* (value, get) {
        yield* Settings.set(setting, value)
        get.refresh(read)
      }),
    )
    return Atom.writable(
      (get) => {
        get.mount(set)
        return get(read)
      },
      (ctx, value: Option.Option<S["Type"]>) => {
        ctx.set(set, value)
      },
    )
  }

  static projectAtom = Atom.family(function <
    Name extends string,
    S extends Schema.Codec<any, any>,
  >(options: {
    readonly projectId: ProjectId
    readonly setting: ProjectSetting<Name, S>
  }): Atom.Writable<
    AsyncResult.AsyncResult<
      Option.Option<S["Type"]>,
      PlatformError.PlatformError
    >,
    Option.Option<S["Type"]>
  > {
    const read = Settings.runtime.atom(
      Settings.getProject(options.setting).pipe(
        Effect.provideService(CurrentProjectId, options.projectId),
      ),
    )
    const set = Settings.runtime.fn<Option.Option<S["Type"]>>()(
      Effect.fnUntraced(
        function* (value, get) {
          yield* Settings.set(options.setting, value)
          get.refresh(read)
        },
        Effect.provideService(CurrentProjectId, options.projectId),
      ),
    )
    return Atom.writable(
      (get) => {
        get.mount(set)
        return get(read)
      },
      (ctx, value: Option.Option<S["Type"]>) => {
        ctx.set(set, value)
      },
    )
  })
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
}
export class ProjectSetting<
  const Name extends string,
  S extends Schema.Codec<any, any>,
> {
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

export const allProjects = new Setting(
  "projects",
  Schema.NonEmptyArray(Project),
)
export const getAllProjects = Settings.get(allProjects).pipe(
  Effect.map(Option.getOrElse(() => [Project.defaultProject])),
)
