/**
 * Pretty output formatter for Claude Code stream-json output
 * Effect-idiomatic implementation for effect-smol
 */
import { Effect, Schema } from "effect"

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const

// Schema for content blocks
const ContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
})

// Schema for stream-json messages
const StreamJsonMessage = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    subtype: Schema.optional(Schema.String),
    message: Schema.optional(
      Schema.Struct({
        content: Schema.optional(Schema.Array(ContentBlock)),
      }),
    ),
    duration_ms: Schema.optional(Schema.Number),
    total_cost_usd: Schema.optional(Schema.Number),
  }),
)

type StreamJsonMessageType = typeof StreamJsonMessage.Type

const decoder = new TextDecoder()

const formatToolName = (name: string): string =>
  name.replace("mcp__", "").replace(/__/g, ":")

const formatAssistantMessage = (msg: StreamJsonMessageType): string => {
  const content = msg.message?.content
  if (!content) return ""

  return content
    .map((block) => {
      if (block.type === "text" && block.text) {
        return block.text
      } else if (block.type === "tool_use" && block.name) {
        return (
          "\n" +
          colors.cyan +
          "▶ " +
          formatToolName(block.name) +
          colors.reset +
          "\n"
        )
      }
      return ""
    })
    .join("")
}

const formatResult = (msg: StreamJsonMessageType): string => {
  if (msg.subtype === "success") {
    const duration = msg.duration_ms
      ? (msg.duration_ms / 1000).toFixed(1) + "s"
      : ""
    const cost = msg.total_cost_usd ? "$" + msg.total_cost_usd.toFixed(4) : ""
    const info = [duration, cost].filter(Boolean).join(" | ")
    return (
      "\n" +
      colors.green +
      "✓ Done" +
      colors.reset +
      " " +
      colors.dim +
      info +
      colors.reset +
      "\n"
    )
  } else if (msg.subtype === "error") {
    return "\n" + colors.yellow + "✗ Error" + colors.reset + "\n"
  }
  return ""
}

const formatMessage = (msg: StreamJsonMessageType): string => {
  switch (msg.type) {
    case "system":
      return msg.subtype === "init"
        ? colors.dim + "[Session started]" + colors.reset + "\n"
        : ""
    case "assistant":
      return formatAssistantMessage(msg)
    case "result":
      return formatResult(msg)
    default:
      return ""
  }
}

// Parse and format a single line using Effect Schema (no try/catch)
const parseLine = (line: string): Effect.Effect<string> => {
  if (!line.trim()) return Effect.succeed("")

  return Schema.decodeEffect(StreamJsonMessage)(line).pipe(
    Effect.map(formatMessage),
    Effect.catch(() => Effect.succeed(line + "\n")),
  )
}

/**
 * Create a pretty writer for Claude stream-json output
 * Uses Effect Schema for parsing (no try/catch)
 */
export const createPrettyWriter = () => {
  let buffer = ""

  const parseLineSync = (line: string): string => {
    if (!line.trim()) return ""
    return Effect.runSync(parseLine(line))
  }

  return {
    write: (chunk: Uint8Array) => {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const formatted = parseLineSync(line)
        if (formatted) {
          process.stdout.write(formatted)
        }
      }
    },
    flush: () => {
      if (buffer.trim()) {
        const formatted = parseLineSync(buffer)
        if (formatted) {
          process.stdout.write(formatted)
        }
      }
      buffer = ""
    },
  }
}
