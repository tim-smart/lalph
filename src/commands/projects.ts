import { Command } from "effect/unstable/cli"
import { commandProjectsLs } from "./projects/ls.ts"
import { commandProjectsAdd } from "./projects/add.ts"
import { commandProjectsRm } from "./projects/rm.ts"
import { commandProjectsEdit } from "./projects/edit.ts"
import { commandProjectsToggle } from "./projects/toggle.ts"

export const commandProjects = Command.make("projects").pipe(
  Command.withDescription("Manage projects"),
  Command.withSubcommands([
    commandProjectsLs,
    commandProjectsAdd,
    commandProjectsEdit,
    commandProjectsToggle,
    commandProjectsRm,
  ]),
)
