import type { OutputTransformer } from "../domain/CliAgent.ts"
import { Option, pipe, Schema, Stream } from "effect"
import { ansiColors } from "../shared/ansi-colors.ts"
import { streamFilterJson } from "../shared/stream.ts"

export const claudeOutputTransformer: OutputTransformer = (stream) =>
  stream.pipe(
    streamFilterJson(StreamJsonMessage),
    Stream.map((m) => m.format()),
  )

const ContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
  content: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
})

const ToolUseResult = Schema.Struct({
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  interrupted: Schema.optional(Schema.Boolean),
  isImage: Schema.optional(Schema.Boolean),
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
  tool_use_result: Schema.optional(ToolUseResult),
  duration_ms: Schema.optional(Schema.Number),
  total_cost_usd: Schema.optional(Schema.Number),
}) {
  format(): string {
    switch (this.type) {
      case "system":
        return this.subtype === "init" ? dim("[Session started]") + "\n" : ""
      case "assistant":
        return formatAssistantMessage(this)
      case "user":
        return formatToolResult(this)
      case "result":
        return formatResult(this)
      default:
        return ""
    }
  }
}

const BashInput = Schema.Struct({ command: Schema.optional(Schema.String) })
const FileInput = Schema.Struct({ file_path: Schema.optional(Schema.String) })
const PatternInput = Schema.Struct({ pattern: Schema.optional(Schema.String) })
const QuestionOption = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
})
const Question = Schema.Struct({
  question: Schema.String,
  header: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(QuestionOption)),
})
const AskUserQuestionInput = Schema.Struct({
  questions: Schema.optional(Schema.Array(Question)),
})

const McpInputFields = [
  "query",
  "documentId",
  "page",
  "pattern",
  "relative_path",
  "name_path",
  "file_path",
  "root_path",
] as const

const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max) + "..." : s

const dim = (s: string) => ansiColors.dim + s + ansiColors.reset
const cyan = (s: string) => ansiColors.cyan + s + ansiColors.reset
const yellow = (s: string) => ansiColors.yellow + s + ansiColors.reset
const green = (s: string) => ansiColors.green + s + ansiColors.reset

const formatToolName = (name: string) =>
  name.replace("mcp__", "").replace(/__/g, ":")

const withDetail = (display: string, detail: Option.Option<string>) =>
  display + Option.getOrElse(detail, () => "")

const formatBashInput = (input: unknown) =>
  pipe(
    Schema.decodeUnknownOption(BashInput)(input),
    Option.flatMap((data) => Option.fromNullishOr(data.command)),
    Option.filter((cmd) => cmd.length > 0),
    Option.map((cmd) => dim("$ " + truncate(cmd, 100)) + "\n"),
  )

const formatFileInput = (input: unknown) =>
  pipe(
    Schema.decodeUnknownOption(FileInput)(input),
    Option.flatMap((data) => Option.fromNullishOr(data.file_path)),
    Option.filter((path) => path.length > 0),
    Option.map((path) => dim(path) + "\n"),
  )

const formatPatternInput = (input: unknown) =>
  pipe(
    Schema.decodeUnknownOption(PatternInput)(input),
    Option.flatMap((data) => Option.fromNullishOr(data.pattern)),
    Option.filter((pattern) => pattern.length > 0),
    Option.map((pattern) => dim(pattern) + "\n"),
  )

const formatMcpInput = (input: unknown): Option.Option<string> => {
  if (typeof input !== "object" || input === null) return Option.none()
  const data = input as Record<string, unknown>
  const parts = McpInputFields.flatMap((field) =>
    Option.match(Option.fromNullishOr(data[field]), {
      onNone: () => [],
      onSome: (value) => [`${field}=${truncate(String(value), 50)}`],
    }),
  )
  return parts.length > 0
    ? Option.some(dim(parts.join(" ")) + "\n")
    : Option.none()
}

const formatGenericInput = (input: unknown) =>
  pipe(
    Option.fromNullishOr(input),
    Option.map((v) => dim(truncate(JSON.stringify(v), 100)) + "\n"),
  )

type DecodedQuestion = typeof Question.Encoded

const formatUserQuestion = (input: unknown) =>
  pipe(
    Schema.decodeUnknownOption(AskUserQuestionInput)(input),
    Option.flatMap((data) => Option.fromNullishOr(data.questions)),
    Option.map((questions) =>
      questions
        .map((q: DecodedQuestion) => {
          let result = "\n" + yellow("⚠ WAITING FOR INPUT") + "\n"
          result += cyan((q.header ? `[${q.header}] ` : "") + q.question) + "\n"
          if (q.options) {
            result +=
              q.options
                .map(
                  (opt, i) =>
                    `  ${i + 1}. ${opt.label}${opt.description ? dim(` - ${opt.description}`) : ""}`,
                )
                .join("\n") + "\n"
          }
          return result
        })
        .join("\n"),
    ),
    Option.getOrElse(() => ""),
  )

const formatToolInput = (name: string, input: unknown): string => {
  const display = "\n" + cyan("▶ " + formatToolName(name)) + "\n"

  if (name === "Bash") return withDetail(display, formatBashInput(input))
  if (name === "AskUserQuestion") return display + formatUserQuestion(input)
  if (name === "Read" || name === "Write" || name === "Edit")
    return withDetail(display, formatFileInput(input))
  if (name === "Grep" || name === "Glob")
    return withDetail(display, formatPatternInput(input))
  if (name.startsWith("mcp__"))
    return withDetail(display, formatMcpInput(input))
  return withDetail(display, formatGenericInput(input))
}

const formatAssistantMessage = (msg: StreamJsonMessage): string => {
  const content = msg.message?.content
  if (!content) return ""
  return content
    .map((block) => {
      if (block.type === "text" && block.text) return block.text
      if (block.type === "tool_use" && block.name)
        return formatToolInput(block.name, block.input)
      return ""
    })
    .join("")
}

const formatLongOutput = (text: string): string => {
  const lines = text.trim().split("\n")
  if (lines.length > 8) {
    const preview = [
      ...lines.slice(0, 4),
      `... (${lines.length - 7} more lines)`,
      ...lines.slice(-3),
    ].join("\n")
    return dim(preview) + "\n"
  }
  return text.length > 500 ? dim(truncate(text, 500)) + "\n" : dim(text) + "\n"
}

const formatToolResult = (msg: StreamJsonMessage): string => {
  let output = ""
  const result = msg.tool_use_result
  if (result) {
    if (result.stderr?.trim())
      output += yellow("stderr: ") + truncate(result.stderr.trim(), 500) + "\n"
    if (result.interrupted) output += yellow("[interrupted]") + "\n"
    if (result.stdout?.trim()) output += formatLongOutput(result.stdout.trim())
  }
  const content = msg.message?.content
  if (content) {
    for (const block of content) {
      if (block.type === "tool_result") {
        if (block.is_error) output += yellow("✗ Tool error") + "\n"
        if (block.content) output += formatLongOutput(block.content)
      }
    }
  }
  return output
}

const formatResult = (msg: StreamJsonMessage): string => {
  if (msg.subtype === "success") {
    const duration = msg.duration_ms
      ? (msg.duration_ms / 1000).toFixed(1) + "s"
      : ""
    const cost = msg.total_cost_usd ? "$" + msg.total_cost_usd.toFixed(4) : ""
    const info = [duration, cost].filter(Boolean).join(" | ")
    return "\n" + green("✓ Done") + " " + dim(info) + "\n"
  }
  if (msg.subtype === "error") return "\n" + yellow("✗ Error") + "\n"
  return ""
}
