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
  Command.withDescription(
    "Manage agent presets used to run tasks. Use 'ls' to inspect presets and 'add'/'edit' to configure agents, arguments, and any issue-source options.",
  ),
  subcommands,
)

export const commandAgentsAlias = Command.make("a").pipe(
  Command.withDescription(
    "Alias for 'agents' (manage agent presets used to run tasks).",
  ),
  subcommands,
)
