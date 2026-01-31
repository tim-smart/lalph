import { Command } from "effect/unstable/cli"
import { commandProjectsLs } from "./projects/ls.ts"
import { commandProjectsAdd } from "./projects/add.ts"
import { commandProjectsRm } from "./projects/rm.ts"

export const commandProjects = Command.make("projects").pipe(
  Command.withDescription("Manage projects"),
  Command.withSubcommands([
    commandProjectsAdd,
    commandProjectsRm,
    commandProjectsLs,
  ]),
)
