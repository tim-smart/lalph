import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"
import { Settings } from "../../Settings.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import {
  allCliAgentPresets,
  getAllCliAgentPresets,
  selectCliAgentPreset,
} from "../../Presets.ts"

export const commandAgentsRm = Command.make("rm").pipe(
  Command.withDescription(
    "Remove an agent preset (select a preset to delete from your configuration).",
  ),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const presets = yield* getAllCliAgentPresets
      if (presets.length === 0) {
        return yield* Effect.log("There are no presets to remove.")
      }
      const preset = yield* selectCliAgentPreset
      const newPresets = presets.filter((p) => p.id !== preset.id)
      yield* Settings.set(allCliAgentPresets, Option.some(newPresets))
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
