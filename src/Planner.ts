import { Effect, FileSystem, Path } from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "./Worktree.ts"
import { getOrSelectCliAgent } from "./CliAgent.ts"

export const plan = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const cliAgent = yield* getOrSelectCliAgent

  const lalphPlanPath = pathService.join(worktree.directory, "lalph-plan.md")
  yield* Effect.scoped(fs.open(lalphPlanPath, { flag: "a+" }))

  const cliCommand = cliAgent.commandPlan({
    prompt: promptGen.planPrompt(),
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

  const planContent = yield* fs.readFileString(lalphPlanPath)
  yield* fs.writeFileString(pathService.resolve("lalph-plan.md"), planContent)
}).pipe(
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)

export const planContinue = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const cliAgent = yield* getOrSelectCliAgent

  const lalphPlanPath = pathService.join(worktree.directory, "lalph-plan.md")
  yield* Effect.scoped(fs.open(lalphPlanPath, { flag: "a+" }))

  const cliCommand = cliAgent.commandPlan({
    prompt: promptGen.planContinuePrompt,
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

  const planContent = yield* fs
    .readFileString(lalphPlanPath)
    .pipe(Effect.orElseSucceed(() => ""))

  yield* fs.writeFileString(pathService.resolve("lalph-plan.md"), planContent)
}).pipe(
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)
