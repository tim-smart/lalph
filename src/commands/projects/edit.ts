import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import {
  addOrUpdateProject,
  getAllProjects,
  selectProject,
} from "../../Projects.ts"
import { Settings } from "../../Settings.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"

export const commandProjectsEdit = Command.make("edit").pipe(
  Command.withDescription(
    "Edit a project's execution settings (concurrency, target branch, git flow, review agent). Use this to change how lalph runs for that project.",
  ),
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
