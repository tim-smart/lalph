import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClankaPlan } from "../Clanka.ts"

export const agentPlanner = Effect.fnUntraced(function* (options: {
  readonly plan: string
  readonly specsDirectory: string
  readonly dangerous: boolean
  readonly preset: CliAgentPreset
  readonly ralph: boolean
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  if (options.preset.cliAgent.id === "clanka") {
    yield* runClankaPlan({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      prompt: promptGen.planPrompt(options),
    })
    return
  }

  yield* pipe(
    options.preset.cliAgent.commandPlan({
      prompt: promptGen.planPrompt(options),
      prdFilePath: options.ralph
        ? undefined
        : pathService.join(".lalph", "prd.yml"),
      dangerous: options.dangerous,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
    spawner.exitCode,
  )
})
