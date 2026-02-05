import { Command } from "effect/unstable/cli"
import { commandProjectsLs } from "./projects/ls.ts"
import { commandProjectsAdd } from "./projects/add.ts"
import { commandProjectsRm } from "./projects/rm.ts"
import { commandProjectsEdit } from "./projects/edit.ts"
import { commandProjectsToggle } from "./projects/toggle.ts"

const subcommands = Command.withSubcommands([
  commandProjectsLs,
  commandProjectsAdd,
  commandProjectsEdit,
  commandProjectsToggle,
  commandProjectsRm,
])

export const commandProjects = Command.make("projects").pipe(
  Command.withDescription(
    "Manage projects and their execution settings (enabled state, concurrency, target branch, git flow, review agent). Use 'ls' to inspect and 'add', 'edit', or 'toggle' to configure.",
  ),
  subcommands,
)

export const commandProjectsAlias = Command.make("p").pipe(
  Command.withDescription("Alias for 'projects'."),
  subcommands,
)
