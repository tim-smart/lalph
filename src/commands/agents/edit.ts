import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { Settings } from "../../Settings.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import {
  addOrUpdatePreset,
  getAllCliAgentPresets,
  selectCliAgentPreset,
} from "../../Presets.ts"

export const commandAgentsEdit = Command.make("edit").pipe(
  Command.withDescription(
    "Edit an existing agent preset (interactive prompt to update agent, arguments, and any issue-source options).",
  ),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const presets = yield* getAllCliAgentPresets
      if (presets.length === 0) {
        return yield* Effect.log("No presets available to edit.")
      }
      const preset = yield* selectCliAgentPreset
      yield* addOrUpdatePreset({ existing: preset })
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
