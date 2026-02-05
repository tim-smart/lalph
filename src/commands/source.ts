import { Command } from "effect/unstable/cli"
import { selectIssueSource } from "../CurrentIssueSource.ts"
import { Settings } from "../Settings.ts"

export const commandSource = Command.make("source").pipe(
  Command.withDescription(
    "Select the issue source to use (e.g. GitHub Issues or Linear). This applies to all projects.",
  ),
  Command.withHandler(() => selectIssueSource),
  Command.provide(Settings.layer),
)
