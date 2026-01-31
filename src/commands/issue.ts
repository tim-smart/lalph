import { Command } from "effect/unstable/cli"
import { CurrentIssueSource } from "../IssueSources.ts"
import { Effect, FileSystem, flow, Layer, Schema } from "effect"
import { IssueSource } from "../IssueSource.ts"
import { ChildProcess } from "effect/unstable/process"
import { PrdIssue } from "../domain/PrdIssue.ts"
import * as Yaml from "yaml"
import { configEditor } from "../shared/config.ts"
import { CurrentProjectId } from "../Settings.ts"
import { layerProjectIdPrompt } from "../Projects.ts"

const issueTemplate = `---
title: Issue Title
priority: 3
estimate: null
blockedBy: []
autoMerge: false
---

Describe the issue here.`

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
      const source = yield* IssueSource
      const fs = yield* FileSystem.FileSystem
      const projectId = yield* CurrentProjectId
      const tempFile = yield* fs.makeTempFileScoped({
        suffix: ".md",
      })
      const editor = yield* configEditor
      yield* fs.writeFileString(tempFile, issueTemplate)

      const exitCode = yield* ChildProcess.make(
        editor[0]!,
        [...editor.slice(1), tempFile],
        {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      ).pipe(ChildProcess.exitCode)
      if (exitCode !== 0) return

      const content = yield* fs.readFileString(tempFile)
      if (content.trim() === issueTemplate.trim()) {
        return
      }

      const lines = content.split("\n")
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
    }, Effect.scoped),
  ),
  Command.provide(
    Layer.mergeAll(CurrentIssueSource.layer, layerProjectIdPrompt),
  ),
)

export const commandIssue = Command.make("issue").pipe(
  Command.withDescription("Create a new issue in the selected issue source"),
  handler,
)

export const commandIssueAlias = Command.make("i").pipe(
  Command.withDescription("Alias for 'issue' command"),
  handler,
)
