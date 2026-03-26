import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { FeatureStore } from "../../FeatureStore.ts"

export const commandFeaturesLs = Command.make("ls").pipe(
  Command.withDescription(
    "List persisted features and their stored metadata (project, execution mode, branches, spec file, lifecycle status).",
  ),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const features = yield* FeatureStore.list()

      if (features.length === 0) {
        console.log(
          "No features configured yet. Run 'lalph features create' to get started.",
        )
        return
      }

      for (const feature of features) {
        console.log(`Feature: ${feature.name}`)
        console.log(`  Project: ${feature.projectId}`)
        console.log(`  Execution mode: ${feature.executionMode}`)
        console.log(`  Base branch: ${feature.baseBranch}`)
        console.log(`  Feature branch: ${feature.featureBranch}`)
        console.log(`  Spec file: ${feature.specFilePath}`)
        console.log(`  Lifecycle status: ${feature.lifecycleStatus}`)
        console.log("")
      }
    }),
  ),
)
