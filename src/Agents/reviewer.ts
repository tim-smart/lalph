import { Duration, Effect, FileSystem, Option, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { GitFlow } from "../GitFlow.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { runClanka } from "../Clanka.ts"
import { CurrentTask } from "../domain/CurrentTask.ts"

export const agentReviewer = Effect.fnUntraced(function* (options: {
  readonly specsDirectory: string
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly instructions: string
  readonly currentTask: CurrentTask
}) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const gitFlow = yield* GitFlow

  const mode = CurrentTask.$match(options.currentTask, {
    task: () => "default" as const,
    ralph: () => "ralph" as const,
  })

  const system = CurrentTask.$match(options.currentTask, {
    task: () => promptGen.systemClanka(options),
    ralph: () => undefined,
  })

  const customInstructions = yield* pipe(
    fs.readFileString(pathService.join(worktree.directory, "LALPH_REVIEW.md")),
    Effect.option,
  )

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      system,
      prompt: Option.match(customInstructions, {
        onNone: () =>
          promptGen.promptReview({
            prompt: options.instructions,
            gitFlow,
          }),
        onSome: (prompt) =>
          promptGen.promptReviewCustom({
            prompt,
            specsDirectory: options.specsDirectory,
            removePrdNotes: true,
          }),
      }),
      stallTimeout: options.stallTimeout,
      mode,
    })
    return ExitCode(0)
  }

  const cliCommand = pipe(
    options.preset.cliAgent.command({
      prompt: Option.match(customInstructions, {
        onNone: () =>
          promptGen.promptReview({
            prompt: options.instructions,
            gitFlow,
          }),
        onSome: (prompt) =>
          promptGen.promptReviewCustom({
            prompt,
            specsDirectory: options.specsDirectory,
            removePrdNotes: false,
          }),
      }),
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
