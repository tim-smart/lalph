import { Command } from "effect/unstable/cli"
import {
  CurrentIssueSource,
  statusCurrentIssueSource,
} from "../IssueSources.ts"
import { Settings } from "../Settings.ts"

export const commandSourceStatus = Command.make("status").pipe(
  Command.withDescription("Show the selected issue source options"),
  Command.withHandler(() => statusCurrentIssueSource),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
