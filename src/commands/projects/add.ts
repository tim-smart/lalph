import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { addProject } from "../../Projects.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"
import { IssueSource } from "../../IssueSource.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsAdd = Command.make("add").pipe(
  Command.withDescription("Add a new project"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const project = yield* addProject
      const source = yield* IssueSource
      yield* source.settings(project.id)
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
