import { Effect, Option } from "effect"
import { Argument, Command } from "effect/unstable/cli"
import { FeatureNotFound, FeatureStore } from "../../FeatureStore.ts"
import { FeatureName } from "../../domain/Feature.ts"

export const commandFeaturesShow = Command.make("show", {
  name: Argument.string("name").pipe(
    Argument.withDescription("The feature name to inspect."),
  ),
}).pipe(
  Command.withDescription("Show the full stored metadata for one feature."),
  Command.withHandler(
    Effect.fnUntraced(function* ({ name }) {
      const featureName = FeatureName.makeUnsafe(name)
      const feature = yield* FeatureStore.load(featureName)

      if (Option.isNone(feature)) {
        return yield* new FeatureNotFound({ name: featureName })
      }

      console.log(`Feature: ${feature.value.name}`)
      console.log(`  Project: ${feature.value.projectId}`)
      console.log(`  Execution mode: ${feature.value.executionMode}`)
      console.log(`  Spec file: ${feature.value.specFilePath}`)
      console.log(`  Base branch: ${feature.value.baseBranch}`)
      console.log(`  Feature branch: ${feature.value.featureBranch}`)
      console.log(`  Lifecycle status: ${feature.value.lifecycleStatus}`)
      console.log(
        `  Parent issue source ID: ${feature.value.parentIssueSourceId ?? "None"}`,
      )
      console.log(
        `  Final integration PR ID: ${feature.value.finalIntegrationPrId ?? "None"}`,
      )
    }),
  ),
)
