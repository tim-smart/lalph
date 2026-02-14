import { Effect, Layer, Path } from "effect"
import { KeyValueStore, Persistence } from "effect/unstable/persistence"
import { PlatformServices } from "./shared/platform.ts"
import { resolveLalphDirectory } from "./shared/lalphDirectory.ts"

export const layerPersistence = Layer.unwrap(
  Effect.gen(function* () {
    const pathService = yield* Path.Path
    const directory = yield* resolveLalphDirectory
    return Persistence.layerKvs.pipe(
      Layer.provide(
        KeyValueStore.layerFileSystem(
          pathService.join(directory, ".lalph", "cache"),
        ),
      ),
    )
  }),
).pipe(Layer.provide(PlatformServices))
