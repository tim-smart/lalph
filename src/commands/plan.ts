import { Data, Effect, FileSystem, Option, Path, pipe, Schema } from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { Worktree } from "../Worktree.ts"
import { Command, Flag } from "effect/unstable/cli"
import { CurrentIssueSource } from "../CurrentIssueSource.ts"
import { commandRoot } from "./root.ts"
import { CurrentProjectId, Settings } from "../Settings.ts"
import { addOrUpdateProject, selectProject } from "../Projects.ts"
import { agentPlanner } from "../Agents/planner.ts"
import { agentTasker } from "../Agents/tasker.ts"
import { commandPlanTasks } from "./plan/tasks.ts"
import { Editor } from "../Editor.ts"
import { getDefaultCliAgentPreset } from "../Presets.ts"
import { ChildProcess } from "effect/unstable/process"
import { parseBranch } from "../shared/git.ts"

const dangerous = Flag.boolean("dangerous").pipe(
  Flag.withAlias("d"),
  Flag.withDescription(
    "Enable dangerous mode (skip permission prompts) during plan generation",
  ),
)

const withNewProject = Flag.boolean("new").pipe(
  Flag.withAlias("n"),
  Flag.withDescription("Create a new project before starting plan mode"),
)

export const commandPlan = Command.make("plan", {
  dangerous,
  withNewProject,
}).pipe(
  Command.withDescription("Iterate on an issue plan and create PRD tasks"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ dangerous, withNewProject }) {
      const editor = yield* Editor

      const thePlan = yield* editor.editTemp({
        suffix: ".md",
      })
      if (Option.isNone(thePlan)) return

      // We nest this effect, so we can launch the editor first as fast as
      // possible
      yield* Effect.gen(function* () {
        const project = withNewProject
          ? yield* addOrUpdateProject()
          : yield* selectProject
        const { specsDirectory } = yield* commandRoot

        yield* plan({
          plan: thePlan.value,
          specsDirectory,
          targetBranch: project.targetBranch,
          dangerous,
        }).pipe(Effect.provideService(CurrentProjectId, project.id))
      }).pipe(Effect.provide([Settings.layer, CurrentIssueSource.layer]))
    }, Effect.provide(Editor.layer)),
  ),
  Command.withSubcommands([commandPlanTasks]),
)

const plan = Effect.fnUntraced(
  function* (options: {
    readonly plan: string
    readonly specsDirectory: string
    readonly targetBranch: Option.Option<string>
    readonly dangerous: boolean
  }) {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const preset = yield* getDefaultCliAgentPreset

    yield* agentPlanner({
      plan: options.plan,
      specsDirectory: options.specsDirectory,
      dangerous: options.dangerous,
      preset,
    })

    const planDetails = yield* pipe(
      fs.readFileString(
        pathService.join(worktree.directory, ".lalph", "plan.json"),
      ),
      Effect.flatMap(Schema.decodeEffect(PlanDetails)),
      Effect.mapError(() => new SpecNotFound()),
    )

    if (Option.isSome(options.targetBranch)) {
      yield* commitAndPushSpecification({
        specsDirectory: options.specsDirectory,
        targetBranch: options.targetBranch.value,
      })
    }

    yield* Effect.log("Converting specification into tasks")

    yield* agentTasker({
      specificationPath: planDetails.specification,
      specsDirectory: options.specsDirectory,
      preset,
    })

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
  Effect.provide([
    PromptGen.layer,
    Prd.layerProvided,
    Worktree.layer,
    Settings.layer,
    CurrentIssueSource.layer,
  ]),
)

export class SpecNotFound extends Data.TaggedError("SpecNotFound") {
  readonly message = "The AI agent failed to produce a specification."
}

export class SpecGitError extends Data.TaggedError("SpecGitError")<{
  readonly message: string
}> {}

const commitAndPushSpecification = Effect.fnUntraced(
  function* (options: {
    readonly specsDirectory: string
    readonly targetBranch: string
  }) {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path

    const absSpecsDirectory = pathService.join(
      worktree.directory,
      options.specsDirectory,
    )

    const git = (args: ReadonlyArray<string>) =>
      ChildProcess.make("git", [...args], {
        cwd: worktree.directory,
        stdout: "inherit",
        stderr: "inherit",
      }).pipe(ChildProcess.exitCode)

    const addCode = yield* git(["add", absSpecsDirectory])
    if (addCode !== 0) {
      return yield* new SpecGitError({
        message: "Failed to stage specification changes.",
      })
    }

    const commitCode = yield* git(["commit", "-m", "Update plan specification"])
    if (commitCode !== 0) {
      return yield* new SpecGitError({
        message: "Failed to commit the generated specification changes.",
      })
    }

    const parsed = parseBranch(options.targetBranch)
    yield* git(["push", parsed.remote, `HEAD:${parsed.branch}`])
  },
  Effect.ignore({ log: "Warn" }),
)

const PlanDetails = Schema.fromJsonString(
  Schema.Struct({
    specification: Schema.String,
  }),
)
