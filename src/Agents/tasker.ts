import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"

export const agentTasker = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly specificationPath: string
  readonly preset: CliAgentPreset
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  return yield* pipe(
    options.preset.cliAgent.command({
      prompt: promptGen.promptPlanTasks({
        specsDirectory: options.specsDirectory,
        specificationPath: options.specificationPath,
      }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
    worktree.execWithOutput({ cliAgent: options.preset.cliAgent }),
  )
})
