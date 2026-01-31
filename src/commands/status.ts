import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { Settings } from "../Settings.ts"
import { Effect, Option } from "effect"
import { getAllProjects } from "../Projects.ts"
import { IssueSource } from "../IssueSource.ts"

export const commandStatus = Command.make("status").pipe(
  Command.withDescription("Show the selected issue source options"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const meta = yield* CurrentIssueSource
      const source = yield* IssueSource
      console.log("Issue source:", meta.name)
      console.log("")

      const projects = yield* getAllProjects
      for (const project of projects) {
        yield* source.settings(project.id)
      }

      for (const project of projects) {
        console.log(`Project: ${project.id}`)
        console.log(`  Concurrency: ${project.concurrency}`)
        if (Option.isSome(project.targetBranch)) {
          console.log(`  Target Branch: ${project.targetBranch.value}`)
        }
        console.log(
          `  Git flow: ${project.gitFlow === "pr" ? "Pull Request" : "Commit"}`,
        )
        console.log(
          `  Review mode: ${project.reviewMode ? "Enabled" : "Disabled"}`,
        )
        yield* source.status(project.id)
      }
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
