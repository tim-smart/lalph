import { Effect, Option, pipe, String } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import { allProjects, getAllProjects } from "../../Projects.ts"
import { Settings } from "../../Settings.ts"
import { Project, ProjectId } from "../../domain/Project.ts"
import { IssueSource } from "../../IssueSource.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"

export const commandProjectsAdd = Command.make("add").pipe(
  Command.withDescription("Add a new project configuration"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const projects = yield* getAllProjects
      const id = yield* Prompt.text({
        message: "Name",
        validate(input) {
          input = input.trim()
          if (input.length === 0) {
            return Effect.fail("Project name cannot be empty")
          } else if (projects.some((p) => p.id === input)) {
            return Effect.fail(`Project already exists`)
          }
          return Effect.succeed(input)
        },
      })
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
      const reviewMode = yield* Prompt.toggle({
        message: "Enable review agent?",
      })

      const project = new Project({
        id: ProjectId.makeUnsafe(id),
        enabled: true,
        concurrency,
        targetBranch,
        gitFlow,
        reviewMode,
      })
      yield* Settings.set(allProjects, Option.some([...projects, project]))

      const source = yield* IssueSource
      yield* source.settings(project.id)
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
