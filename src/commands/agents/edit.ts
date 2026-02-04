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
  Command.withDescription("Modify a CLI agent preset"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllCliAgentPresets
      if (projects.length === 0) {
        return yield* Effect.log("No presets available to edit.")
      }
      const preset = yield* selectCliAgentPreset
      yield* addOrUpdatePreset({ existing: preset })
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
