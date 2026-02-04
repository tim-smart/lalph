import { Command } from "effect/unstable/cli"
import { commandAgentsLs } from "./agents/ls.ts"
import { commandAgentsAdd } from "./agents/add.ts"
import { commandAgentsRm } from "./agents/rm.ts"
import { commandAgentsEdit } from "./agents/edit.ts"

const subcommands = Command.withSubcommands([
  commandAgentsLs,
  commandAgentsAdd,
  commandAgentsEdit,
  commandAgentsRm,
])

export const commandAgents = Command.make("agents").pipe(
  Command.withDescription("Manage CLI agent presets"),
  subcommands,
)

export const commandAgentsAlias = Command.make("a").pipe(
  Command.withDescription("Alias for 'agents' command"),
  subcommands,
)
