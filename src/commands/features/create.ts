import { Command } from "effect/unstable/cli"
import { createFeature } from "../../FeatureCreation.ts"

export const commandFeaturesCreate = Command.make("create").pipe(
  Command.withDescription(
    "Create a feature through a guided wizard and persist it under .lalph/features/.",
  ),
  Command.withHandler(() => createFeature()),
)
