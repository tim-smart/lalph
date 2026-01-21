import {
  Data,
  DateTime,
  Deferred,
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
    readonly startedDeferred: Deferred.Deferred<void>
    readonly targetBranch: Option.Option<string>
    readonly specsDirectory: string
    readonly stallTimeout: Duration.Duration
    readonly runTimeout: Duration.Duration
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd

    const exec = (
      template: TemplateStringsArray,
      ...args: Array<string | number | boolean>
    ) =>
      ChildProcess.make({
        cwd: worktree.directory,
      })(template, ...args).pipe(ChildProcess.exitCode)

    const execOutput = (
      template: TemplateStringsArray,
      ...args: Array<string | number | boolean>
    ) =>
      ChildProcess.make({
        cwd: worktree.directory,
      })(template, ...args).pipe(
        ChildProcess.string,
        Effect.map((output) => output.trim()),
      )

    const execWithStallTimeout = Effect.fnUntraced(function* (
      command: ReadonlyArray<string>,
    ) {
      let lastOutputAt = yield* DateTime.now

      const stallTimeout = Effect.suspend(function loop(): Effect.Effect<
        never,
        RunnerStalled
      > {
        const now = DateTime.nowUnsafe()
        const deadline = DateTime.addDuration(
          lastOutputAt,
          options.stallTimeout,
        )
        if (DateTime.isLessThan(deadline, now)) {
          return Effect.fail(new RunnerStalled())
        }
        const timeUntilDeadline = DateTime.distanceDuration(deadline, now)
        return Effect.flatMap(Effect.sleep(timeUntilDeadline), loop)
      })

      const handle = yield* ChildProcess.make(command[0]!, command.slice(1), {
        cwd: worktree.directory,
        extendEnv: true,
        env: cliAgent.env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
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
      return yield* handle.exitCode
    }, Effect.scoped)

    if (Option.isSome(options.targetBranch)) {
      yield* exec`git checkout ${`origin/${options.targetBranch.value}`}`
    }

    const currentBranch = execOutput`git branch --show-current`.pipe(
      Effect.map((branch) => {
        branch = branch.trim()
        return branch === "" ? null : branch
      }),
    )

    yield* Effect.gen(function* () {
      const chooseCommand = cliAgent.command({
        prompt: promptGen.promptChoose,
        prdFilePath: pathService.join(".lalph", "prd.yml"),
      })

      yield* ChildProcess.make(chooseCommand[0]!, chooseCommand.slice(1), {
        cwd: worktree.directory,
        extendEnv: true,
        env: cliAgent.env,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      }).pipe(
        ChildProcess.exitCode,
        Effect.timeoutOrElse({
          duration: options.stallTimeout,
          onTimeout: () => Effect.fail(new RunnerStalled()),
        }),
      )

      const taskJson = yield* fs.readFileString(
        pathService.join(worktree.directory, ".lalph", "task.json"),
      )
      const taskId = (yield* Schema.decodeEffect(ChosenTask)(taskJson)).id
      const task = yield* prd.findById(taskId)
      if (!task) return

      yield* Deferred.completeWith(options.startedDeferred, Effect.void)

      const cliCommand = cliAgent.command({
        prompt: promptGen.prompt({
          taskId,
          targetBranch: Option.getOrUndefined(options.targetBranch),
          specsDirectory: options.specsDirectory,
        }),
        prdFilePath: pathService.join(".lalph", "prd.yml"),
      })

      const exitCode = yield* execWithStallTimeout(cliCommand).pipe(
        Effect.timeout(options.runTimeout),
        Effect.catchTag(
          "TimeoutError",
          Effect.fnUntraced(function* (error) {
            const timeoutCommand = cliAgent.command({
              prompt: promptGen.promptTimeout({
                taskId,
              }),
              prdFilePath: pathService.join(".lalph", "prd.yml"),
            })
            yield* execWithStallTimeout(timeoutCommand)
            return yield* error
          }),
        ),
      )
      yield* Effect.log(`Agent exited with code: ${exitCode}`)

      const prs = yield* prd.mergableGithubPrs
      if (prs.length === 0) {
        yield* prd.maybeRevertIssue({ issueId: taskId })
      } else if (task.autoMerge) {
        for (const pr of prs) {
          if (Option.isSome(options.targetBranch)) {
            yield* exec`gh pr edit ${pr.prNumber} --base ${options.targetBranch.value}`
          }

          const exitCode = yield* exec`gh pr merge ${pr.prNumber} -sd`
          if (exitCode !== 0) {
            yield* prd.flagUnmergable({ issueId: pr.issueId })
          }
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const currentBranchName = yield* currentBranch
          if (!currentBranchName) return
          // enter detached state
          yield* exec`git checkout --detach ${currentBranchName}`
          // delete the branch
          yield* exec`git branch -D ${currentBranchName}`
        }).pipe(Effect.ignore),
      ),
    )
  },
  // on interrupt or error, revert any state changes made in the PRD
  Effect.onError(
    Effect.fnUntraced(function* () {
      const prd = yield* Prd
      yield* Effect.ignore(prd.revertStateIds)
    }),
  ),
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)

export class RunnerStalled extends Data.TaggedError("RunnerStalled") {
  readonly message = "The runner has stalled due to inactivity."
}

const ChosenTask = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
  }),
)
