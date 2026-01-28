import { Effect, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgent } from "../domain/CliAgent.ts"

export const agentPlanner = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly commandPrefix: (
    command: ChildProcess.Command,
  ) => ChildProcess.Command
  readonly dangerous: boolean
  readonly cliAgent: CliAgent
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  return yield* pipe(
    options.cliAgent.commandPlan({
      prompt: promptGen.planPrompt(options),
      prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
      dangerous: options.dangerous,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.commandPrefix,
    ChildProcess.exitCode,
  )
})
