import { Effect, Layer, LayerMap, Path } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { PlatformServices } from "./shared/platform.ts"
import { ProjectId } from "./domain/Project.ts"
import { resolveLalphDirectory } from "./shared/lalphDirectory.ts"

export const layerKvs = Layer.unwrap(
  Effect.gen(function* () {
    const pathService = yield* Path.Path
    const directory = yield* resolveLalphDirectory()
    return KeyValueStore.layerFileSystem(
      pathService.join(directory, ".lalph", "config"),
    )
  }),
).pipe(Layer.provide(PlatformServices))

export class ProjectsKvs extends LayerMap.Service<ProjectsKvs>()(
  "lalph/ProjectsKvs",
  {
    lookup: (projectId: ProjectId) =>
      Layer.unwrap(
        Effect.gen(function* () {
          const pathService = yield* Path.Path
          const directory = yield* resolveLalphDirectory()
          return KeyValueStore.layerFileSystem(
            pathService.join(
              directory,
              ".lalph",
              "projects",
              encodeURIComponent(projectId),
            ),
          )
        }),
      ).pipe(Layer.orDie),
    dependencies: [PlatformServices],
  },
) {}
