import { Duration, Effect, Option, Path, pipe, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "../Worktree.ts"
import type { CliAgentPreset } from "../domain/CliAgentPreset.ts"
import { runClanka } from "../Clanka.ts"
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { Prompt } from "effect/unstable/ai"
import { CurrentTask } from "../domain/CurrentTask.ts"

export const agentWorker = Effect.fnUntraced(function* (options: {
  readonly stallTimeout: Duration.Duration
  readonly preset: CliAgentPreset
  readonly system?: string
  readonly prompt: string
  readonly research: Option.Option<string>
  readonly steer?: Stream.Stream<string>
  readonly maxContext?: number | undefined
  readonly currentTask: CurrentTask
}) {
  const pathService = yield* Path.Path
  const worktree = yield* Worktree

  const prdFilePath = CurrentTask.$match(options.currentTask, {
    task: () => pathService.join(".lalph", "prd.yml"),
    ralph: () => undefined,
  })

  // use clanka
  if (!options.preset.cliAgent.command) {
    yield* runClanka({
      directory: worktree.directory,
      model: options.preset.extraArgs.join(" "),
      system: options.system,
      prompt: Option.match(options.research, {
        onNone: () => options.prompt,
        onSome: (research) =>
          Prompt.make([
            {
              role: "user",
              content: options.prompt,
            },
            {
              role: "user",
              content: `You have already researched the above task, **AVOID DOING MORE RESEARCH** unless information is missing. Have a bias for action.
Here is your research report:

${research}`,
            },
          ]),
      }),
      stallTimeout: options.stallTimeout,
      maxContext: options.maxContext,
      steer: options.steer,
      mode: CurrentTask.$match(options.currentTask, {
        task: () => "default" as const,
        ralph: () => "ralph" as const,
      }),
    })
    return ExitCode(0)
  }

  const cliCommand = pipe(
    options.preset.cliAgent.command({
      prompt: options.prompt,
      prdFilePath,
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
