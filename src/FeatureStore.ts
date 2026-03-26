import {
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  ServiceMap,
} from "effect"
import { Feature, type FeatureName } from "./domain/Feature.ts"
import { resolveLalphDirectory } from "./shared/lalphDirectory.ts"
import { PlatformServices } from "./shared/platform.ts"

export class FeatureStorageRoot extends ServiceMap.Service<
  FeatureStorageRoot,
  string
>()("lalph/FeatureStorageRoot") {
  static readonly layer = Layer.effect(this, resolveLalphDirectory)

  static layerAt(directory: string) {
    return Layer.succeed(this, directory)
  }
}

export class FeatureAlreadyExists extends Data.TaggedError(
  "FeatureAlreadyExists",
)<{
  readonly name: FeatureName
}> {
  readonly message = `Feature "${this.name}" already exists.`
}

export class FeatureNotFound extends Data.TaggedError("FeatureNotFound")<{
  readonly name: FeatureName
}> {
  readonly message = `Feature "${this.name}" was not found.`
}

export class InvalidFeatureFile extends Data.TaggedError("InvalidFeatureFile")<{
  readonly path: string
}> {
  readonly message = `Feature file "${this.path}" is invalid.`
}

export class FeatureStore extends ServiceMap.Service<FeatureStore>()(
  "lalph/FeatureStore",
  {
    make: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const root = yield* FeatureStorageRoot
      const directory = pathService.join(root, ".lalph", "features")

      const ensureDirectory = Effect.fn("FeatureStore.ensureDirectory")(
        function* () {
          yield* fs.makeDirectory(directory, { recursive: true })
        },
      )

      const filePathFor = (name: FeatureName) =>
        pathService.join(directory, `${encodeURIComponent(name)}.json`)

      const decodeFile = Effect.fn("FeatureStore.decodeFile")(function* (
        path: string,
      ) {
        const json = yield* fs
          .readFileString(path)
          .pipe(Effect.mapError(() => new InvalidFeatureFile({ path })))
        return yield* Effect.try({
          try: () => Feature.decodeSync(json),
          catch: () => new InvalidFeatureFile({ path }),
        })
      })

      const write = Effect.fn("FeatureStore.write")(function* (
        feature: Feature,
      ) {
        yield* ensureDirectory()
        yield* fs.writeFileString(
          filePathFor(feature.name),
          Feature.encodeSync(feature),
        )
      })

      const create = Effect.fn("FeatureStore.create")(function* (
        feature: Feature,
      ) {
        yield* ensureDirectory()
        const path = filePathFor(feature.name)
        if (yield* fs.exists(path)) {
          return yield* new FeatureAlreadyExists({ name: feature.name })
        }
        yield* write(feature)
        return feature
      })

      const load = Effect.fn("FeatureStore.load")(function* (
        name: FeatureName,
      ) {
        const path = filePathFor(name)
        if (!(yield* fs.exists(path))) {
          return Option.none<Feature>()
        }
        return Option.some(yield* decodeFile(path))
      })

      const list = Effect.fn("FeatureStore.list")(function* () {
        if (!(yield* fs.exists(directory))) {
          return [] as ReadonlyArray<Feature>
        }

        const entries = yield* fs.readDirectory(directory)
        const featurePaths = entries
          .filter((entry) => entry.endsWith(".json"))
          .toSorted()
          .map((entry) => pathService.join(directory, entry))

        return yield* Effect.forEach(featurePaths, decodeFile)
      })

      const update = Effect.fn("FeatureStore.update")(function* (
        feature: Feature,
      ) {
        const path = filePathFor(feature.name)
        if (!(yield* fs.exists(path))) {
          return yield* new FeatureNotFound({ name: feature.name })
        }
        yield* decodeFile(path)
        yield* write(feature)
        return feature
      })

      return { create, load, list, update } as const
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide([FeatureStorageRoot.layer, PlatformServices]),
  )

  static layerAt(directory: string) {
    return Layer.effect(this, this.make).pipe(
      Layer.provide([FeatureStorageRoot.layerAt(directory), PlatformServices]),
    )
  }

  static create(feature: Feature) {
    return this.use((store) => store.create(feature))
  }

  static load(name: FeatureName) {
    return this.use((store) => store.load(name))
  }

  static list() {
    return this.use((store) => store.list())
  }

  static update(feature: Feature) {
    return this.use((store) => store.update(feature))
  }
}
