import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { selectIssueSource, statusCurrentIssueSource } from "../IssueSources.ts"
import { Settings } from "../Settings.ts"

export const commandSource = Command.make("source").pipe(
  Command.withDescription("Select the issue source to use"),
  Command.withHandler(() => selectIssueSource),
  Command.provide(Settings.layer),
)

export const commandSourceStatus = Command.make("status").pipe(
  Command.withDescription("Show the selected issue source options"),
  Command.withHandler(() => statusCurrentIssueSource),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
