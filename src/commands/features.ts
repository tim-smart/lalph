import { Command } from "effect/unstable/cli"
import { commandFeaturesCreate } from "./features/create.ts"
import { commandFeaturesLs } from "./features/ls.ts"
import { commandFeaturesShow } from "./features/show.ts"

const subcommands = Command.withSubcommands([
  commandFeaturesCreate,
  commandFeaturesLs,
  commandFeaturesShow,
])

export const commandFeatures = Command.make("features").pipe(
  Command.withDescription(
    "Manage stored feature metadata. Use 'create' to add a feature, 'ls' for a summary, and 'show <name>' to inspect one feature in full.",
  ),
  Command.withAlias("f"),
  subcommands,
)
