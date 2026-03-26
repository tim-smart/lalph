import { Duration, Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { runClanka } from "../Clanka.ts"
import { CurrentTask } from "../domain/CurrentTask.ts"

export const agentTimeout = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly currentTask: CurrentTask
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  const timeoutMode = CurrentTask.$match(options.currentTask, {
    task: ({ task }) => ({
      mode: "default" as const,
      system: promptGen.systemClanka(options),
      clankaPrompt: promptGen.promptTimeoutClanka({
        taskId: task.id!,
        specsDirectory: options.specsDirectory,
      }),
      cliPrompt: promptGen.promptTimeout({
        taskId: task.id!,
        specsDirectory: options.specsDirectory,
      }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
    }),
    ralph: ({ task, specFile }) => ({
      mode: "ralph" as const,
      system: undefined,
      clankaPrompt: promptGen.promptTimeoutRalph({ task, specFile }),
      cliPrompt: promptGen.promptTimeoutRalph({ task, specFile }),
      prdFilePath: undefined,
    }),
  })

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      system: timeoutMode.system,
      prompt: timeoutMode.clankaPrompt,
      stallTimeout: options.stallTimeout,
      mode: timeoutMode.mode,
    })
    return ExitCode(0)
  }

  const timeoutCommand = pipe(
    options.preset.cliAgent.command({
      prompt: timeoutMode.cliPrompt,
      prdFilePath: timeoutMode.prdFilePath,
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
  )
  return yield* timeoutCommand.pipe(
    worktree.execWithStallTimeout({
      cliAgent: options.preset.cliAgent,
      stallTimeout: options.stallTimeout,
    }),
  )
})
