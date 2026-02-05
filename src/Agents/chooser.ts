import { Data, Duration, Effect, FileSystem, Path, pipe, Schema } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { RunnerStalled } from "../domain/Errors.ts"
import { makeWaitForFile } from "../shared/fs.ts"
import { GitFlow } from "../GitFlow.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"

export const agentChooser = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
}) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const prd = yield* Prd
  const gitFlow = yield* GitFlow
  const waitForFile = yield* makeWaitForFile

  const taskJsonCreated = waitForFile(
    pathService.join(worktree.directory, ".lalph"),
    "task.json",
  )

  yield* pipe(
    options.preset.cliAgent.command({
      prompt: promptGen.promptChoose({ gitFlow }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
      extraArgs: options.preset.extraArgs,
    }),
    ChildProcess.setCwd(worktree.directory),
    options.preset.withCommandPrefix,
    worktree.execWithWorkerOutput({
      cliAgent: options.preset.cliAgent,
    }),
    Effect.timeoutOrElse({
      duration: options.stallTimeout,
      onTimeout: () => Effect.fail(new RunnerStalled()),
    }),
    Effect.raceFirst(taskJsonCreated),
  )

  return yield* pipe(
    fs.readFileString(
      pathService.join(worktree.directory, ".lalph", "task.json"),
    ),
    Effect.flatMap(Schema.decodeEffect(ChosenTask)),
    Effect.mapError((_) => new ChosenTaskNotFound()),
    Effect.flatMap(
      Effect.fnUntraced(function* (task) {
        const prdTask = yield* prd.findById(task.id)
        if (prdTask) return { ...task, prd: prdTask }
        return yield* new ChosenTaskNotFound()
      }),
    ),
  )
})

export class ChosenTaskNotFound extends Data.TaggedError("ChosenTaskNotFound") {
  readonly message = "The AI agent failed to choose a task."
}

const ChosenTask = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    githubPrNumber: Schema.NullOr(Schema.Finite),
  }),
)
