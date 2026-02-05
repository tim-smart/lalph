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

const dangerous = Flag.boolean("dangerous").pipe(
  Flag.withAlias("d"),
  Flag.withDescription(
    "Skip permission prompts while generating the specification from your plan",
  ),
)

const withNewProject = Flag.boolean("new").pipe(
  Flag.withAlias("n"),
  Flag.withDescription(
    "Create a new project (via prompts) before starting plan mode",
  ),
)

export const commandPlan = Command.make("plan", {
  dangerous,
  withNewProject,
}).pipe(
  Command.withDescription(
    "Open an editor to draft a plan; on save, generate a specification under --specs and then create PRD tasks from it. Use --new to create a project first; use --dangerous to skip permission prompts during spec generation.",
  ),
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

const PlanDetails = Schema.fromJsonString(
  Schema.Struct({
    specification: Schema.String,
  }),
)
