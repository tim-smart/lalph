import {
  Array,
  Data,
  Effect,
  Layer,
  Option,
  PlatformError,
  Schema,
} from "effect"
import { Project, type ProjectId } from "./domain/Project.ts"
import { AsyncResult, Atom } from "effect/unstable/reactivity"
import { CurrentProjectId, Setting, Settings } from "./Settings.ts"
import { Prompt } from "effect/unstable/cli"
import type { NonEmptyReadonlyArray } from "effect/Array"

export const layerProjectIdPrompt = Layer.effect(
  CurrentProjectId,
  Effect.gen(function* () {
    const project = yield* selectProject
    return project.id
  }),
).pipe(Layer.provide(Settings.layer))

export const allProjects = new Setting(
  "projects",
  Schema.NonEmptyArray(Project),
)

export const getAllProjects = Settings.get(allProjects).pipe(
  Effect.map(
    Option.getOrElse(
      (): NonEmptyReadonlyArray<Project> => [Project.defaultProject],
    ),
  ),
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
      return Option.getOrElse(
        projects,
        (): Array.NonEmptyReadonlyArray<Project> => [Project.defaultProject],
      )
    }),
  )
  const set = Settings.runtime.fn<Array.NonEmptyReadonlyArray<Project>>()(
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
    (ctx, value: Array.NonEmptyReadonlyArray<Project>) => {
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
        if (!Array.isArrayNonEmpty(updatedProjects)) return
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
  return yield* Prompt.autoComplete({
    message: "Select a project:",
    choices: projects.map((p) => ({
      title: p.id,
      value: p,
    })),
  })
})
