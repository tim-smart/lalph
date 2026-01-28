import { Data, Duration, Effect, FileSystem, Path, pipe, Schema } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { RunnerStalled } from "../domain/Errors.ts"
import type { CliAgent } from "../domain/CliAgent.ts"

export const agentChooser = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly commandPrefix: (
    command: ChildProcess.Command,
  ) => ChildProcess.Command
  readonly cliAgent: CliAgent
}) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const worktree = yield* Worktree
  const promptGen = yield* PromptGen
  const prd = yield* Prd

  yield* pipe(
    options.cliAgent.resolveCommandChoose({
      prompt: promptGen.promptChoose,
      prdFilePath: pathService.join(".lalph", "prd.yml"),
    }),
    ChildProcess.setCwd(worktree.directory),
    options.commandPrefix,
    ChildProcess.exitCode,
    Effect.timeoutOrElse({
      duration: options.stallTimeout,
      onTimeout: () => Effect.fail(new RunnerStalled()),
    }),
  )

  const taskJson = yield* fs.readFileString(
    pathService.join(worktree.directory, ".lalph", "task.json"),
  )
  return yield* Schema.decodeEffect(ChosenTask)(taskJson).pipe(
    Effect.mapError(() => new ChosenTaskNotFound()),
    Effect.flatMap(
      Effect.fnUntraced(function* (task) {
        const prdTask = yield* prd.findById(task.id)
        if (prdTask?.state === "in-progress") {
          return { ...task, prd: prdTask }
        }
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
