import { Duration, Effect, identity, Path, pipe, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClanka } from "../Clanka.ts"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { CurrentTaskRef } from "../TaskTools.ts"

export const agentWorker = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly system?: string
  readonly prompt: string
  readonly steer?: Stream.Stream<string>
  readonly taskRef?: CurrentTaskRef["Service"]
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      system: options.system,
      prompt: options.prompt,
      stallTimeout: options.stallTimeout,
      steer: options.steer,
    }).pipe(
      options.taskRef
        ? Effect.provideService(CurrentTaskRef, options.taskRef)
        : identity,
    )
    return ExitCode(0)
  }

  const cliCommand = pipe(
    options.preset.cliAgent.command({
      prompt: options.prompt,
      prdFilePath: pathService.join(".lalph", "prd.yml"),
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
  )

  return yield* cliCommand.pipe(
    worktree.execWithStallTimeout({
      cliAgent: options.preset.cliAgent,
      stallTimeout: options.stallTimeout,
    }),
  )
})
