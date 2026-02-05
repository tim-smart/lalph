import { Command } from "effect/unstable/cli"
import { addOrUpdateProject } from "../../Projects.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsAdd = Command.make("add").pipe(
  Command.withDescription(
    "Create a new project configuration (repo/worktree + execution settings like concurrency and target branch). Run this when you want lalph to manage another project.",
  ),
  Command.withHandler(() => addOrUpdateProject()),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
