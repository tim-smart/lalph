import { Command } from "effect/unstable/cli"
import { addOrUpdateProject } from "../../Projects.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsAdd = Command.make("add").pipe(
  Command.withDescription(
    "Add a project and configure its execution settings (concurrency, target branch, git flow, review agent) and issue source settings.",
  ),
  Command.withHandler(() => addOrUpdateProject()),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
