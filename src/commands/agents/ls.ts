import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { IssueSource } from "../../IssueSource.ts"
import { CurrentIssueSource } from "../../CurrentIssueSource.ts"
import { Settings } from "../../Settings.ts"
import { getAllCliAgentPresets } from "../../Presets.ts"

export const commandAgentsLs = Command.make("ls").pipe(
  Command.withDescription("List all configured CLI agent presets"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const meta = yield* CurrentIssueSource
      const source = yield* IssueSource

      console.log("Issue source:", meta.name)
      console.log("")

      const presets = yield* getAllCliAgentPresets

      if (presets.length === 0) {
        console.log(
          "No presets configured yet. Run 'lalph agents add' to get started.",
        )
        return
      }

      for (const preset of presets) {
        console.log(`Preset: ${preset.id}`)
        yield* source.cliAgentPresetInfo(preset)
        console.log(`  CLI agent: ${preset.cliAgent.name}`)
        if (preset.extraArgs.length > 0) {
          console.log(`  Extra args: ${preset.extraArgs.join(" ")}`)
        }
        if (preset.commandPrefix.length > 0) {
          console.log(`  Command prefix: ${preset.commandPrefix.join(" ")}`)
        }
        console.log("")
      }
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
