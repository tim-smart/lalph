import {
  Data,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Stream,
} from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Worktree } from "./Worktree.ts"
import { getOrSelectCliAgent } from "./CliAgent.ts"

export const run = Effect.fnUntraced(
  function* (options: {
    readonly autoMerge: boolean
    readonly targetBranch: Option.Option<string>
    readonly stallTimeout: Duration.Duration
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd

    if (Option.isSome(options.targetBranch)) {
      yield* ChildProcess.make`git checkout ${`origin/${options.targetBranch.value}`}`.pipe(
        ChildProcess.exitCode,
      )
    }

    const chooseCommand = cliAgent.command({
      prompt: promptGen.promptChoose,
      prdFilePath: pathService.join(".lalph", "prd.yml"),
    })

    yield* ChildProcess.make(chooseCommand[0]!, chooseCommand.slice(1), {
      cwd: worktree.directory,
      extendEnv: true,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).pipe(ChildProcess.exitCode)

    const taskJson = yield* fs.readFileString(
      pathService.join(worktree.directory, ".lalph", "task.json"),
    )
    const task = yield* Schema.decodeEffect(ChosenTask)(taskJson)

    const cliCommand = cliAgent.command({
      prompt: promptGen.prompt({
        taskId: task.id,
        targetBranch: Option.getOrUndefined(options.targetBranch),
      }),
      prdFilePath: pathService.join(".lalph", "prd.yml"),
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

    const prs = yield* prd.mergableGithubPrs
    if (prs.length === 0) {
      yield* prd.maybeRevertIssue({
        ...task,
        issueId: task.id,
      })
    } else if (options.autoMerge) {
      for (const pr of prs) {
        if (Option.isSome(options.targetBranch)) {
          yield* ChildProcess.make`gh pr edit ${pr} --base ${options.targetBranch.value}`.pipe(
            ChildProcess.exitCode,
          )
        }

        yield* ChildProcess.make`gh pr merge ${pr} -sd`.pipe(
          ChildProcess.exitCode,
        )
      }
    }
  },
  // on interrupt or error, revert any state changes made in the PRD
  Effect.onError(
    Effect.fnUntraced(function* () {
      const prd = yield* Prd
      yield* Effect.ignore(prd.revertStateIds)
    }),
  ),
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)

export class RunnerStalled extends Data.TaggedError("RunnerStalled") {
  readonly message = "The runner has stalled due to inactivity."
}

const ChosenTask = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    todoStateId: Schema.String,
    inProgressStateId: Schema.String,
    reviewStateId: Schema.String,
  }),
)
