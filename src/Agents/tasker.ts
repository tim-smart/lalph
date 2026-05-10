import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { runClanka } from "../Clanka.ts"

export const agentTasker = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly specificationPath: string
  readonly preset: CliAgentPreset
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      system: promptGen.systemClanka(options),
      prompt: promptGen.promptPlanTasksClanka({
        specsDirectory: options.specsDirectory,
        specificationPath: options.specificationPath,
      }),
    })
    return ExitCode(0)
  }

  return yield* pipe(
    options.preset.cliAgent.command({
      prompt: promptGen.promptPlanTasks({
        specsDirectory: options.specsDirectory,
        specificationPath: options.specificationPath,
      }),
      prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
    worktree.execWithOutput({ cliAgent: options.preset.cliAgent }),
  )
})
