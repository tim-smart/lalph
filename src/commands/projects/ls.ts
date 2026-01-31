import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"
import { IssueSource } from "../../IssueSource.ts"
import { CurrentIssueSource } from "../../IssueSources.ts"
import { getAllProjects } from "../../Projects.ts"
import { Settings } from "../../Settings.ts"

export const commandProjectsLs = Command.make("ls").pipe(
  Command.withDescription("List all configured projects and their settings"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const meta = yield* CurrentIssueSource
      const source = yield* IssueSource
      console.log("Issue source:", meta.name)
      console.log("")

      const projects = yield* getAllProjects

      if (projects.length === 0) {
        console.log(
          "No projects configured yet. Run 'lalph projects add' to get started.",
        )
        return
      }
      for (const project of projects) {
        console.log(`Project: ${project.id}`)
        console.log(`  Enabled: ${project.enabled ? "Yes" : "No"}`)
        yield* source.info(project.id)
        console.log(`  Concurrency: ${project.concurrency}`)
        if (Option.isSome(project.targetBranch)) {
          console.log(`  Target Branch: ${project.targetBranch.value}`)
        }
        console.log(
          `  Git flow: ${project.gitFlow === "pr" ? "Pull Request" : "Commit"}`,
        )
        console.log(
          `  Review agent: ${project.reviewAgent ? "Enabled" : "Disabled"}`,
        )
        console.log("")
      }
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(CurrentIssueSource.layer),
)
