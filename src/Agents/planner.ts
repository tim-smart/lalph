import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"

export const agentPlanner = Effect.fnUntraced(function* (options: {
  readonly plan: string
  readonly specsDirectory: string
  readonly dangerous: boolean
  readonly preset: CliAgentPreset
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  yield* pipe(
    options.preset.cliAgent.commandPlan({
      prompt: promptGen.planPrompt(options),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
      dangerous: options.dangerous,
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
    ChildProcess.exitCode,
  )
})
