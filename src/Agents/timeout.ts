import { Duration, Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgent } from "../domain/CliAgent.ts"
import type { PrdIssue } from "../domain/PrdIssue.ts"

export const agentTimeout = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly cliAgent: CliAgent
  readonly commandPrefix: (
    command: ChildProcess.Command,
  ) => ChildProcess.Command
  readonly task: PrdIssue
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  const timeoutCommand = pipe(
    options.cliAgent.command({
      outputMode: "pipe",
      prompt: promptGen.promptTimeout({
        taskId: options.task.id!,
        specsDirectory: options.specsDirectory,
      }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
    }),
    ChildProcess.setCwd(worktree.directory),
    options.commandPrefix,
  )
  return yield* timeoutCommand.pipe(
    worktree.execWithStallTimeout({
      cliAgent: options.cliAgent,
      stallTimeout: options.stallTimeout,
    }),
  )
})
