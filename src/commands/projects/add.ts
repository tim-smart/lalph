import { Command } from "effect/unstable/cli"
import { addOrUpdateProject } from "../../Projects.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsAdd = Command.make("add").pipe(
  Command.withDescription("Add a new project"),
  Command.withHandler(() => addOrUpdateProject()),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
