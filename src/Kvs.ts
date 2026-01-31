import { Layer, LayerMap } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { PlatformServices } from "./shared/platform.ts"
import { ProjectId } from "./domain/Project.ts"

export const layerKvs = KeyValueStore.layerFileSystem(".lalph/config").pipe(
  Layer.provide(PlatformServices),
)

export class ProjectsKvs extends LayerMap.Service<ProjectsKvs>()(
  "lalph/ProjectsKvs",
  {
    lookup: (projectId: ProjectId) =>
      KeyValueStore.layerFileSystem(
        `.lalph/projects/${encodeURIComponent(projectId)}`,
      ).pipe(Layer.orDie),
    dependencies: [PlatformServices],
  },
) {}
