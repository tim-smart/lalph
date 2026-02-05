import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import { Settings } from "../../Settings.ts"
import { addOrUpdatePreset } from "../../Presets.ts"

export const commandAgentsAdd = Command.make("add").pipe(
  Command.withDescription(
    "Add a new agent preset (interactive prompt for CLI agent, arguments, and any issue-source options).",
  ),
  Command.withHandler(() => addOrUpdatePreset()),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
