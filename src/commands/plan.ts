import {
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  pipe,
  Schema,
} from "effect"
import { PromptGen } from "../PromptGen.ts"
import { Prd } from "../Prd.ts"
import { Worktree } from "../Worktree.ts"
import type { ChildProcess } from "effect/unstable/process"
import { getCommandPrefix, getOrSelectCliAgent } from "./agent.ts"
import { Command, Flag } from "effect/unstable/cli"
import { CurrentIssueSource } from "../CurrentIssueSource.ts"
import { commandRoot } from "./root.ts"
import { CurrentProjectId, Settings } from "../Settings.ts"
import {
  addOrUpdateProject,
  layerProjectIdPrompt,
  selectProject,
} from "../Projects.ts"
import { agentPlanner } from "../Agents/planner.ts"
import { agentTasker } from "../Agents/tasker.ts"
import { commandPlanTasks } from "./plan/tasks.ts"

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
    Effect.fnUntraced(
      function* ({ dangerous, withNewProject }) {
        const project = withNewProject
          ? yield* addOrUpdateProject()
          : yield* selectProject
        const { specsDirectory } = yield* commandRoot
        const commandPrefix = yield* getCommandPrefix
        yield* plan({
          specsDirectory,
          targetBranch: project.targetBranch,
          commandPrefix,
          dangerous,
        }).pipe(Effect.provideService(CurrentProjectId, project.id))
      },
      Effect.provide([Settings.layer, CurrentIssueSource.layer]),
    ),
  ),
  Command.withSubcommands([commandPlanTasks]),
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
    const cliAgent = yield* getOrSelectCliAgent

    yield* agentPlanner({
      specsDirectory: options.specsDirectory,
      commandPrefix: options.commandPrefix,
      dangerous: options.dangerous,
      cliAgent,
    })

    yield* Effect.log("Converting specification into tasks")
    const planDetails = yield* pipe(
      fs.readFileString(
        pathService.join(worktree.directory, ".lalph", "plan.json"),
      ),
      Effect.flatMap(Schema.decodeEffect(PlanDetails)),
    )

    yield* agentTasker({
      specificationPath: planDetails.specification,
      specsDirectory: options.specsDirectory,
      commandPrefix: options.commandPrefix,
      cliAgent,
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
    Worktree.layer.pipe(Layer.provide(layerProjectIdPrompt)),
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
