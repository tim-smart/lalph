import { Duration, Effect, Option } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClanka } from "../Clanka.ts"
import type { PrdIssue } from "../domain/PrdIssue.ts"

export const agentResearcher = Effect.fnUntraced(function* (options: {
  readonly task: PrdIssue
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
}) {
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  // use clanka
  if (options.preset.cliAgent.command) {
    return Option.none<string>()
  }

  return yield* runClanka({
    directory: worktree.directory,
    model: options.preset.extraArgs.join(" "),
    system: promptGen.systemClanka(options),
    prompt: promptGen.promptResearch({
      task: options.task,
    }),
    stallTimeout: options.stallTimeout,
  }).pipe(Effect.asSome)
})
