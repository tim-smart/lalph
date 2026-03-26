import { Command } from "effect/unstable/cli"
import { commandFeaturesLs } from "./features/ls.ts"
import { commandFeaturesShow } from "./features/show.ts"

const subcommands = Command.withSubcommands([
  commandFeaturesLs,
  commandFeaturesShow,
])

export const commandFeatures = Command.make("features").pipe(
  Command.withDescription(
    "Inspect stored feature metadata. Use 'ls' for a summary of all features and 'show <name>' to inspect one feature in full.",
  ),
  Command.withAlias("f"),
  subcommands,
)
