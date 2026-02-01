import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import {
  addOrUpdateProject,
  getAllProjects,
  selectProject,
} from "../../Projects.ts"
import { Settings } from "../../Settings.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"

export const commandProjectsEdit = Command.make("edit").pipe(
  Command.withDescription("Modify a project"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllProjects
      if (projects.length === 0) {
        return yield* Effect.log("No projects available to edit.")
      }
      const project = yield* selectProject
      yield* addOrUpdateProject(project)
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
