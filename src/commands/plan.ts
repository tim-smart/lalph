import { Effect, Stream, FileSystem, Option, Path, pipe } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { getCommandPrefix, getOrSelectCliAgent } from "./agent.ts"
import { Command, Flag } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { createPrettyWriter } from "../shared/OutputFormatter.ts"
import { commandRoot } from "./root.ts"

const dangerous = Flag.boolean("dangerous").pipe(
  Flag.withDescription(
    "Enable dangerous mode (skip permission prompts) during plan generation",
  ),
)

export const commandPlan = Command.make("plan", { dangerous }).pipe(
  Command.withDescription("Iterate on an issue plan and create PRD tasks"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ dangerous }) {
      const { specsDirectory, targetBranch } = yield* commandRoot
      const commandPrefix = yield* getCommandPrefix
      yield* plan({
        specsDirectory,
        targetBranch,
        commandPrefix,
        dangerous,
      }).pipe(Effect.provide(CurrentIssueSource.layer))
    }),
  ),
)
const plan = Effect.fnUntraced(
  function* (options: {
    readonly specsDirectory: string
    readonly targetBranch: Option.Option<string>
    readonly commandPrefix: (
      command: ChildProcess.Command,
    ) => ChildProcess.Command
    readonly dangerous: boolean
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent

    const exec = (
      template: TemplateStringsArray,
      ...args: Array<string | number | boolean>
    ) =>
      ChildProcess.exitCode(
        ChildProcess.make({
          cwd: worktree.directory,
          extendEnv: true,
        })(template, ...args),
      )

    if (Option.isSome(options.targetBranch)) {
      yield* exec`git checkout ${`origin/${options.targetBranch.value}`}`
    }
    const planCommand = pipe(
      cliAgent.commandPlan({
        outputMode: "pipe",
        prompt: promptGen.planPrompt(options),
        prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
        dangerous: options.dangerous,
      }),
      ChildProcess.setCwd(worktree.directory),
      options.commandPrefix,
    )
    const planPrettyWriter = createPrettyWriter()
    const exitCode = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* planCommand
        yield* handle.all.pipe(
          Stream.runForEach((chunk) => {
            planPrettyWriter.write(chunk)
            return Effect.void
          }),
          Effect.ensuring(Effect.sync(() => planPrettyWriter.flush())),
        )
        return yield* handle.exitCode
      }),
    )
    yield* Effect.log(`Agent exited with code: ${exitCode}`)

    if (!worktree.inExisting) {
      yield* pipe(
        fs.copy(
          pathService.join(worktree.directory, options.specsDirectory),
          options.specsDirectory,
          { overwrite: true },
        ),
        Effect.ignore,
      )
    }
  },
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)
