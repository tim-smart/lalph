import {
  Data,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Path,
  pipe,
  Schema,
} from "effect"
import { PromptGen } from "../PromptGen.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { RunnerStalled } from "../domain/Errors.ts"
import { makeWaitForFile } from "../shared/fs.ts"
import { GitFlow } from "../GitFlow.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClanka } from "../Clanka.ts"
import { ChosenTaskDeferred } from "../TaskTools.ts"
import { IssueSource } from "../IssueSource.ts"
import { CurrentProjectId } from "../Settings.ts"

export const agentChooser = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
}) {
  const projectId = yield* CurrentProjectId
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const source = yield* IssueSource
  const gitFlow = yield* GitFlow
  const waitForFile = yield* makeWaitForFile

  // use clanka
  if (!options.preset.cliAgent.command) {
    const deferred = ChosenTaskDeferred.of(Deferred.makeUnsafe())
    const result = yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      prompt: promptGen.promptChooseClanka({ gitFlow }),
      mode: "choose",
      stallTimeout: options.stallTimeout,
    }).pipe(
      Effect.provideService(ChosenTaskDeferred, deferred),
      Effect.flatMap(() => Effect.fail(new ChosenTaskNotFound())),
      Effect.raceFirst(Deferred.await(deferred)),
    )
    const prdTask = yield* source.findById(projectId, result.taskId)
    if (!prdTask) return yield* new ChosenTaskNotFound()
    return {
      id: result.taskId,
      githubPrNumber: result.githubPrNumber ?? null,
      prd: prdTask,
    }
  }

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
      orElse: () => Effect.fail(new RunnerStalled()),
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
        const prdTask = yield* source.findById(projectId, task.id)
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
