import { Array, Effect, Option } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import { allProjects, getAllProjects } from "../../Projects.ts"
import { Settings } from "../../Settings.ts"
import { Project } from "../../domain/Project.ts"

export const commandProjectsToggle = Command.make("toggle").pipe(
  Command.withDescription("Enable or disable projects"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllProjects
      if (projects.length === 0) {
        return yield* Effect.log("No projects available to toggle.")
      }
      const enabled = yield* Prompt.multiSelect({
        message: "Select projects to enable",
        choices: projects.map((project) => ({
          title: project.id,
          value: project.id,
          selected: project.enabled,
        })),
      })

      yield* Settings.set(
        allProjects,
        Option.some(
          Array.map(
            projects,
            (p) =>
              new Project({
                ...p,
                enabled: enabled.includes(p.id),
              }),
          ),
        ),
      )
    }),
  ),
  Command.provide(Settings.layer),
)
