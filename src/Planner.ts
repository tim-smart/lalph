import { Effect, Path } from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "./Worktree.ts"
import { getOrSelectCliAgent } from "./CliAgent.ts"

export const plan = Effect.gen(function* () {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const cliAgent = yield* getOrSelectCliAgent

  const cliCommand = cliAgent.commandPlan({
    prompt: promptGen.planPrompt,
    prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
  })
  const exitCode = yield* ChildProcess.make(
    cliCommand[0]!,
    cliCommand.slice(1),
    {
      cwd: worktree.directory,
      extendEnv: true,
      env: {
        PWD: worktree.directory,
      },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    },
  ).pipe(ChildProcess.exitCode)

  yield* Effect.log(`Agent exited with code: ${exitCode}`)
}).pipe(
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)
