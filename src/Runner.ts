import { Data, DateTime, Duration, Effect, Path, Stream } from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "./Worktree.ts"
import { getOrSelectCliAgent } from "./CliAgent.ts"

export const run = Effect.fnUntraced(
  function* (options: {
    readonly autoMerge: boolean
    readonly stallTimeout: Duration.Duration
  }) {
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd

    const cliCommand = cliAgent.command({
      prompt: promptGen.prompt,
      prdFilePath: pathService.join(".lalph", "prd.json"),
      progressFilePath: "PROGRESS.md",
    })
    const handle = yield* ChildProcess.make(
      cliCommand[0]!,
      cliCommand.slice(1),
      {
        cwd: worktree.directory,
        extendEnv: true,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      },
    )

    let lastOutputAt = yield* DateTime.now

    const stallTimeout = Effect.suspend(function loop(): Effect.Effect<
      never,
      RunnerStalled
    > {
      const now = DateTime.nowUnsafe()
      const deadline = DateTime.addDuration(lastOutputAt, options.stallTimeout)
      if (DateTime.isLessThan(deadline, now)) {
        return Effect.fail(new RunnerStalled())
      }
      const timeUntilDeadline = DateTime.distanceDuration(deadline, now)
      return Effect.flatMap(Effect.sleep(timeUntilDeadline), loop)
    })

    yield* handle.all.pipe(
      Stream.runForEachArray((output) => {
        lastOutputAt = DateTime.nowUnsafe()
        for (const chunk of output) {
          process.stdout.write(chunk)
        }
        return Effect.void
      }),
      Effect.raceFirst(stallTimeout),
    )
    const exitCode = yield* handle.exitCode
    yield* Effect.log(`Agent exited with code: ${exitCode}`)

    if (options.autoMerge) {
      const prs = yield* prd.mergableGithubPrs
      for (const pr of prs) {
        yield* ChildProcess.make`gh pr merge ${pr} -sd`.pipe(
          ChildProcess.exitCode,
        )
      }
    }
  },
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)

export class RunnerStalled extends Data.TaggedError("RunnerStalled") {}
