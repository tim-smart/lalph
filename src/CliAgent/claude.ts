import { Schema, Stream } from "effect"
import type { OutputTransformer } from "../domain/CliAgent.ts"
import { streamFilterJson } from "../shared/stream.ts"
import { ansiColors } from "../shared/ansi-colors.ts"

export const claudeOutputTransformer: OutputTransformer = (stream) =>
  stream.pipe(
    streamFilterJson(StreamJsonMessage),
    Stream.map((m) => m.format()),
  )

// Schema definitions

const ContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
})

class StreamJsonMessage extends Schema.Class<StreamJsonMessage>(
  "claude/StreamJsonMessage",
)({
  type: Schema.String,
  subtype: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.Array(ContentBlock)),
    }),
  ),
  duration_ms: Schema.optional(Schema.Number),
  total_cost_usd: Schema.optional(Schema.Number),
}) {
  format(): string {
    switch (this.type) {
      case "system":
        return this.subtype === "init"
          ? ansiColors.dim + "[Session started]" + ansiColors.reset + "\n"
          : ""
      case "assistant":
        return formatAssistantMessage(this)
      case "result":
        return formatResult(this)
      default:
        return ""
    }
  }
}

const formatToolName = (name: string): string =>
  name.replace("mcp__", "").replace(/__/g, ":")

const formatAssistantMessage = (msg: StreamJsonMessage): string => {
  const content = msg.message?.content
  if (!content) return ""

  return content
    .map((block) => {
      if (block.type === "text" && block.text) {
        return block.text
      } else if (block.type === "tool_use" && block.name) {
        return (
          "\n" +
          ansiColors.cyan +
          "▶ " +
          formatToolName(block.name) +
          ansiColors.reset +
          "\n"
        )
      }
      return ""
    })
    .join("")
}

const formatResult = (msg: StreamJsonMessage): string => {
  if (msg.subtype === "success") {
    const duration = msg.duration_ms
      ? (msg.duration_ms / 1000).toFixed(1) + "s"
      : ""
    const cost = msg.total_cost_usd ? "$" + msg.total_cost_usd.toFixed(4) : ""
    const info = [duration, cost].filter(Boolean).join(" | ")
    return (
      "\n" +
      ansiColors.green +
      "✓ Done" +
      ansiColors.reset +
      " " +
      ansiColors.dim +
      info +
      ansiColors.reset +
      "\n"
    )
  } else if (msg.subtype === "error") {
    return "\n" + ansiColors.yellow + "✗ Error" + ansiColors.reset + "\n"
  }
  return ""
}
