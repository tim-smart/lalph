import { Array, Data, Effect, Layer, Option, Path, pipe, String } from "effect"
import { Project, ProjectId } from "./domain/Project.ts"
import { allProjects, CurrentProjectId, Settings } from "./Settings.ts"
import { Prompt } from "effect/unstable/cli"
import { IssueSource } from "./IssueSource.ts"
import { CurrentIssueSource } from "./CurrentIssueSource.ts"
import { findProjectRoot } from "./shared/lalphDirectory.ts"

export const layerProjectIdPrompt = Layer.effect(
  CurrentProjectId,
  Effect.gen(function* () {
    const project = yield* selectProject
    return project.id
  }),
).pipe(Layer.provide(Settings.layer), Layer.provide(CurrentIssueSource.layer))

export const getAllProjects = Settings.get(allProjects).pipe(
  Effect.map(Option.getOrElse((): ReadonlyArray<Project> => [])),
)

export const projectById = Effect.fnUntraced(function* (projectId: ProjectId) {
  const projects = yield* getAllProjects
  return Array.findFirst(projects, (p) => p.id === projectId)
})

export class ProjectNotFound extends Data.TaggedError("ProjectNotFound")<{
  readonly projectId: ProjectId
}> {
  readonly message = `Project "${this.projectId}" not found`
}

// Prompts

export const selectProject = Effect.gen(function* () {
  const projects = yield* getAllProjects
  if (projects.length === 0) {
    return yield* welcomeWizard
  } else if (projects.length === 1) {
    const project = projects[0]!
    yield* Effect.log(`Using project: ${project.id}`)
    return project
  }
  const selection = yield* Prompt.autoComplete({
    message: "Select a project:",
    choices: projects.map((p) => ({
      title: p.id,
      value: p,
    })),
  })
  return selection!
})

export const welcomeWizard = Effect.gen(function* () {
  const welcome = [
    "  .--.",
    " |^()^|  lalph",
    "  '--'",
    "",
    "Let's add your first project.",
    "Projects let you configure how lalph runs tasks.",
    "",
  ].join("\n")
  console.log(welcome)
  return yield* addOrUpdateProject()
})

export const addOrUpdateProject = Effect.fnUntraced(function* (
  existing?: Project,
  fromPlanMode = false,
) {
  const pathService = yield* Path.Path
  const projects = yield* getAllProjects
  const id = existing
    ? existing.id
    : yield* Prompt.text({
        message: "Project name",
        validate(input) {
          input = input.trim()
          if (input.length === 0) {
            return Effect.fail("Project name cannot be empty")
          } else if (projects.some((p) => p.id === input)) {
            return Effect.fail("Project already exists")
          }
          return Effect.succeed(input)
        },
      })
  const concurrency = yield* Prompt.integer({
    message: "Concurrency (number of tasks to run in parallel)",
    min: 1,
  })
  const targetBranch = pipe(
    yield* Prompt.text({
      message: "Target branch (leave empty to use HEAD)",
      default: existing
        ? Option.getOrElse(existing.targetBranch, () => "")
        : "",
    }),
    String.trim,
    Option.liftPredicate(String.isNonEmpty),
  )
  const gitFlow = yield* Prompt.select({
    message: "Git flow",
    choices: [
      {
        title: "Pull Request",
        description: "Create a pull request for each task",
        value: "pr",
        selected: existing ? existing.gitFlow === "pr" : false,
      },
      {
        title: "Commit",
        description: "Tasks are committed directly to the target branch",
        value: "commit",
        selected: existing ? existing.gitFlow === "commit" : false,
      },
      {
        title: "Ralph",
        description: "Tasks are determined from a spec file",
        value: "ralph",
        selected: existing ? existing.gitFlow === "ralph" : false,
      },
    ] as const,
  })

  let ralphSpec = Option.none<string>()
  if (gitFlow === "ralph" && !fromPlanMode) {
    const cwd = pathService.resolve(".")
    const relativeRoot = pipe(
      yield* findProjectRoot(cwd),
      Option.getOrElse(() => cwd),
    )
    ralphSpec = yield* Prompt.file({
      message: "Path to Ralph spec file",
    }).pipe(
      Effect.fromYieldable,
      Effect.map((selectedPath) =>
        pathService.relative(relativeRoot, selectedPath),
      ),
      Effect.map(Option.some),
    )
  }

  const researchAgent = yield* Prompt.toggle({
    message: "Enable research agent?",
    initial: existing ? existing.researchAgent : false,
  })
  const reviewAgent = yield* Prompt.toggle({
    message: "Enable review agent?",
    initial: existing ? existing.reviewAgent : false,
  })

  const project = new Project({
    id: ProjectId.makeUnsafe(id),
    enabled: existing ? existing.enabled : true,
    concurrency,
    targetBranch,
    gitFlow,
    ralphSpec: Option.getOrUndefined(ralphSpec),
    researchAgent,
    reviewAgent,
  })
  yield* Settings.set(
    allProjects,
    Option.some(
      existing
        ? projects.map((p) => (p.id === project.id ? project : p))
        : [...projects, project],
    ),
  )

  const source = yield* IssueSource
  yield* source.reset.pipe(Effect.provideService(CurrentProjectId, project.id))
  if (gitFlow !== "ralph") {
    yield* source.settings(project.id)
  }

  return project
})
