import { Data, Duration, Effect, FileSystem, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/process"
import { Worktree } from "../Worktree.ts"
import { RunnerStalled } from "../domain/Errors.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClanka } from "../Clanka.ts"

export const agentChooserRalph = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly specFile: string
}) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      prompt: promptGen.promptChooseRalph({ specFile: options.specFile }),
      mode: "ralph",
    })
  } else {
    yield* pipe(
      options.preset.cliAgent.command({
        prompt: promptGen.promptChooseRalph({ specFile: options.specFile }),
        prdFilePath: undefined,
        extraArgs: options.preset.extraArgs,
      }),
      ChildProcess.setCwd(worktree.directory),
      options.preset.withCommandPrefix,
      worktree.execWithWorkerOutput({
        cliAgent: options.preset.cliAgent,
      }),
      Effect.timeoutOrElse({
        duration: options.stallTimeout,
        orElse: () => Effect.fail(new RunnerStalled()),
      }),
    )
  }

  return yield* pipe(
    fs.readFileString(
      pathService.join(worktree.directory, ".lalph", "task.md"),
    ),
    Effect.mapError((_) => new ChosenTaskNotFound()),
  )
})

export class ChosenTaskNotFound extends Data.TaggedError("ChosenTaskNotFound") {
  readonly message = "The AI agent failed to choose a task."
}
