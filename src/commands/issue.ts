import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../CurrentIssueSource.ts"
import { Effect, flow, Option, Schema } from "effect"
import { IssueSource } from "../IssueSource.ts"
import { PrdIssue } from "../domain/PrdIssue.ts"
import * as Yaml from "yaml"
import { CurrentProjectId } from "../Settings.ts"
import { layerProjectIdPrompt } from "../Projects.ts"
import { Editor } from "../Editor.ts"

const issueTemplate = `---
title: Issue Title
priority: 3
estimate: null
blockedBy: []
autoMerge: false
---

`

const FrontMatterSchema = Schema.toCodecJson(
  Schema.Struct({
    title: Schema.String,
    priority: Schema.Finite,
    estimate: Schema.NullOr(Schema.Finite),
    blockedBy: Schema.Array(Schema.String),
    autoMerge: Schema.Boolean,
  }),
)

const handler = flow(
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const editor = yield* Editor

      const content = yield* editor.editTemp({
        suffix: ".md",
        initialContent: issueTemplate,
      })
      if (Option.isNone(content)) {
        return
      }

      const lines = content.value.split("\n")
      const yamlLines: string[] = []
      let descriptionStartIndex = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (line.trim() === "---") {
          if (yamlLines.length === 0) {
            // starting delimiter
            continue
          } else {
            // ending delimiter
            descriptionStartIndex = i + 1
            break
          }
        }
        yamlLines.push(line)
      }
      const yamlContent = yamlLines.join("\n")
      const frontMatter = yield* Schema.decodeEffect(FrontMatterSchema)(
        Yaml.parse(yamlContent),
      )
      const description = lines.slice(descriptionStartIndex).join("\n").trim()

      if (frontMatter.title.trim() === "Issue Title") return

      yield* Effect.gen(function* () {
        const source = yield* IssueSource
        const projectId = yield* CurrentProjectId
        const created = yield* source.createIssue(
          projectId,
          new PrdIssue({
            id: null,
            ...frontMatter,
            description,
            state: "todo",
          }),
        )
        console.log(`Created issue with ID: ${created.id}`)
        console.log(`URL: ${created.url}`)
      }).pipe(Effect.provide([layerProjectIdPrompt, CurrentIssueSource.layer]))
    }),
  ),
  Command.provide(Editor.layer),
)

export const commandIssue = Command.make("issue").pipe(
  Command.withDescription(
    "Create a new issue by editing a file with YAML front matter; save and close it to create the issue in the current issue source.",
  ),
  handler,
)

export const commandIssueAlias = Command.make("i").pipe(
  Command.withDescription(
    "Alias for 'issue' (create a new issue by editing a file with YAML front matter; save and close it to create the issue in the current issue source).",
  ),
  handler,
)
