import { Effect, FileSystem, Option, Path } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import { getOrSelectCliAgent } from "../CliAgent.ts"
import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { commandRoot } from "./root.ts"

export const commandPlan = Command.make("plan").pipe(
  Command.withDescription("Iterate on an issue plan and create PRD tasks"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const { specsDirectory, targetBranch } = yield* commandRoot
      yield* plan({ specsDirectory, targetBranch }).pipe(
        Effect.provide(CurrentIssueSource.layer),
      )
    }),
  ),
)

const plan = Effect.fnUntraced(
  function* (options: {
    readonly specsDirectory: string
    readonly targetBranch: Option.Option<string>
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
      ChildProcess.make({
        cwd: worktree.directory,
        extendEnv: true,
      })(template, ...args).pipe(ChildProcess.exitCode)

    if (Option.isSome(options.targetBranch)) {
      yield* exec`git checkout ${`origin/${options.targetBranch.value}`}`
    }

    const cliCommand = cliAgent.commandPlan({
      prompt: promptGen.planPrompt(options),
      prdFilePath: pathService.join(worktree.directory, ".lalph", "prd.yml"),
    })
    const exitCode = yield* ChildProcess.make(
      cliCommand[0]!,
      cliCommand.slice(1),
      {
        cwd: worktree.directory,
        extendEnv: true,
        env: cliAgent.env,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    ).pipe(ChildProcess.exitCode)

    yield* Effect.log(`Agent exited with code: ${exitCode}`)

    if (!worktree.inExisting) {
      yield* fs
        .copy(
          pathService.join(worktree.directory, options.specsDirectory),
          options.specsDirectory,
          {
            overwrite: true,
          },
        )
        .pipe(Effect.ignore)
    }
  },
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)
