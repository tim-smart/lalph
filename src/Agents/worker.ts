import { Duration, Effect, Path, pipe } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"

export const agentWorker = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly prompt: string
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree

  const cliCommand = pipe(
    options.preset.cliAgent.command({
      prompt: options.prompt,
      prdFilePath: pathService.join(".lalph", "prd.yml"),
      extraArgs: [],
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
