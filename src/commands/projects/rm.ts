import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"
import { allProjects, getAllProjects, selectProject } from "../../Projects.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsRm = Command.make("rm").pipe(
  Command.withDescription("Remove a project"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllProjects
      if (projects.length === 0) {
        return yield* Effect.log("There are no projects to remove.")
      }
      const project = yield* selectProject
      const newProjects = projects.filter((p) => p.id !== project.id)
      yield* Settings.set(allProjects, Option.some(newProjects))
    }),
  ),
  Command.provide(Settings.layer),
)
