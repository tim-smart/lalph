import { Array, Effect, Option, pipe, String } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import { allProjects, getAllProjects, selectProject } from "../../Projects.ts"
import { CurrentProjectId, Settings } from "../../Settings.ts"
import { Project } from "../../domain/Project.ts"
import { IssueSource } from "../../IssueSource.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"

export const commandProjectsEdit = Command.make("edit").pipe(
  Command.withDescription("Modify a project"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllProjects
      const project = yield* selectProject
      const concurrency = yield* Prompt.integer({
        message: "Concurrency",
        min: 1,
      })
      const targetBranch = pipe(
        yield* Prompt.text({
          message: "Target branch (leave empty to use HEAD)",
        }),
        String.trim,
        Option.liftPredicate(String.isNonEmpty),
      )
      const gitFlow = yield* Prompt.select({
        message: "Git flow",
        choices: [
          { title: "Pull Request", value: "pr" },
          { title: "Commit", value: "commit" },
        ] as const,
      })
      const reviewAgent = yield* Prompt.toggle({
        message: "Enable review agent?",
      })

      const nextProject = new Project({
        ...project,
        concurrency,
        targetBranch,
        gitFlow,
        reviewAgent,
      })
      yield* Settings.set(
        allProjects,
        Option.some(
          Array.map(projects, (p) =>
            p.id === nextProject.id ? nextProject : p,
          ),
        ),
      )

      const source = yield* IssueSource
      yield* source.reset.pipe(
        Effect.provideService(CurrentProjectId, nextProject.id),
      )
      yield* source.settings(project.id)
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
