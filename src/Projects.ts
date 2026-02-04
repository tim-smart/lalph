import {
  Array,
  Data,
  Effect,
  Layer,
  Option,
  pipe,
  PlatformError,
  Schema,
  String,
} from "effect"
import { Project, ProjectId } from "./domain/Project.ts"
import { AsyncResult, Atom } from "effect/unstable/reactivity"
import { CurrentProjectId, Setting, Settings } from "./Settings.ts"
import { Prompt } from "effect/unstable/cli"
import { IssueSource } from "./IssueSource.ts"
import { CurrentIssueSource } from "./CurrentIssueSource.ts"

export const layerProjectIdPrompt = Layer.effect(
  CurrentProjectId,
  Effect.gen(function* () {
    const project = yield* selectProject
    return project.id
  }),
).pipe(Layer.provide(Settings.layer), Layer.provide(CurrentIssueSource.layer))

export const allProjects = new Setting("projects", Schema.Array(Project))

export const getAllProjects = Settings.get(allProjects).pipe(
  Effect.map(Option.getOrElse((): ReadonlyArray<Project> => [])),
)

export const projectById = Effect.fnUntraced(function* (projectId: ProjectId) {
  const projects = yield* getAllProjects
  return Array.findFirst(projects, (p) => p.id === projectId)
})

export const allProjectsAtom = (function () {
  const read = Settings.runtime.atom(
    Effect.fnUntraced(function* () {
      const settings = yield* Settings
      const projects = yield* settings.get(allProjects)
      return Option.getOrElse(projects, (): ReadonlyArray<Project> => [])
    }),
  )
  const set = Settings.runtime.fn<ReadonlyArray<Project>>()(
    Effect.fnUntraced(function* (value, get) {
      const settings = yield* Settings
      yield* settings.set(allProjects, Option.some(value))
      get.refresh(read)
    }),
  )
  return Atom.writable(
    (get) => {
      get.mount(set)
      return get(read)
    },
    (ctx, value: ReadonlyArray<Project>) => {
      ctx.set(set, value)
    },
    (r) => r(read),
  )
})()

export const projectAtom = Atom.family(
  (
    projectId: ProjectId,
  ): Atom.Writable<
    AsyncResult.AsyncResult<
      Option.Option<Project>,
      PlatformError.PlatformError
    >,
    Option.Option<Project>
  > => {
    const read = Atom.make(
      Effect.fnUntraced(function* (get) {
        const projects = yield* get.result(allProjectsAtom)
        return Array.findFirst(projects, (p) => p.id === projectId)
      }),
    )
    const set = Settings.runtime.fn<Option.Option<Project>>()(
      Effect.fnUntraced(function* (value, get) {
        const projects = yield* get.result(allProjectsAtom)
        const updatedProjects = Option.match(value, {
          onNone: () => Array.filter(projects, (p) => p.id !== projectId),
          onSome: (project) =>
            Array.map(projects, (p) => (p.id === projectId ? project : p)),
        })
        get.set(allProjectsAtom, updatedProjects)
      }),
    )
    return Atom.writable(
      (get) => {
        get.mount(set)
        return get(read)
      },
      (ctx, value: Option.Option<Project>) => {
        ctx.set(set, value)
      },
      (refresh) => refresh(read),
    )
  },
)

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
    "Welcome! Let's add your first project.",
    "Projects let you configure how lalph runs tasks.",
    "",
  ].join("\n")
  console.log(welcome)
  return yield* addOrUpdateProject()
})

export const addOrUpdateProject = Effect.fnUntraced(function* (
  existing?: Project,
) {
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
        selected: existing ? existing.gitFlow === "pr" : false,
      },
    ] as const,
  })
  const reviewAgent = yield* Prompt.toggle({
    message: "Enable review agent?",
    initial: existing ? existing.reviewAgent : true,
  })

  const project = new Project({
    id: ProjectId.makeUnsafe(id),
    enabled: existing ? existing.enabled : true,
    concurrency,
    targetBranch,
    gitFlow,
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
  yield* source.settings(project.id)

  return project
})
