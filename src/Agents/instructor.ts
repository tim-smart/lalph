import { Duration, Effect, FileSystem, Option, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgent } from "../domain/CliAgent.ts"
import type { PrdIssue } from "../domain/PrdIssue.ts"

export const agentInstructor = Effect.fnUntraced(function* (options: {
  readonly targetBranch: Option.Option<string>
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly commandPrefix: (
    command: ChildProcess.Command,
  ) => ChildProcess.Command
  readonly cliAgent: CliAgent
  readonly task: PrdIssue
  readonly githubPrNumber: number | undefined
}) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  yield* pipe(
    options.cliAgent.command({
      outputMode: "pipe",
      prompt: promptGen.promptInstructions({
        task: options.task,
        targetBranch: Option.getOrUndefined(options.targetBranch),
        specsDirectory: options.specsDirectory,
        githubPrNumber: options.githubPrNumber,
      }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
    }),
    ChildProcess.setCwd(worktree.directory),
    options.commandPrefix,
    worktree.execWithStallTimeout({
      cliAgent: options.cliAgent,
      stallTimeout: options.stallTimeout,
    }),
  )
  return yield* fs.readFileString(
    pathService.join(worktree.directory, ".lalph", "instructions.md"),
  )
})
