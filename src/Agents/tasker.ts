import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgent } from "../domain/CliAgent.ts"

export const agentTasker = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly specificationPath: string
  readonly commandPrefix: (
    command: ChildProcess.Command,
  ) => ChildProcess.Command
  readonly cliAgent: CliAgent
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  return yield* pipe(
    options.cliAgent.command({
      prompt: promptGen.promptPlanTasks({
        specsDirectory: options.specsDirectory,
        specificationPath: options.specificationPath,
      }),
      prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
    }),
    ChildProcess.setCwd(worktree.directory),
    options.commandPrefix,
    worktree.execWithOutput(options),
  )
})
