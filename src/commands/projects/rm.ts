import { Effect, FileSystem, Option, Path } from "effect"
import { Command } from "effect/unstable/cli"
import { allProjects, getAllProjects, selectProject } from "../../Projects.ts"
import { Settings } from "../../Settings.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"

export const commandProjectsRm = Command.make("rm").pipe(
  Command.withDescription("Remove a project"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const projects = yield* getAllProjects
      if (projects.length === 0) {
        return yield* Effect.log("There are no projects to remove.")
      }
      const project = yield* selectProject
      const newProjects = projects.filter((p) => p.id !== project.id)
      yield* Settings.set(allProjects, Option.some(newProjects))
      const kvsPath = pathService.join(
        ".lalph",
        "projects",
        encodeURIComponent(project.id),
      )
      if (yield* fs.exists(kvsPath)) {
        yield* fs.remove(kvsPath)
      }
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
