/**
 * Pretty output formatter for Claude Code stream-json output
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
}

interface StreamJsonMessage {
  type: "system" | "assistant" | "user" | "result"
  subtype?: string
  message?: {
    content?: Array<{
      type: string
      text?: string
      name?: string
      input?: unknown
    }>
  }
  result?: string
  duration_ms?: number
  total_cost_usd?: number
}

export class OutputFormatter {
  private buffer = ""
  private lastWasText = false

  /**
   * Process a chunk of output data
   */
  processChunk(chunk: Uint8Array): void {
    this.buffer += new TextDecoder().decode(chunk)

    // Process complete lines
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? "" // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line)
      }
    }
  }

  /**
   * Flush any remaining buffer content
   */
  flush(): void {
    if (this.buffer.trim()) {
      this.processLine(this.buffer)
      this.buffer = ""
    }
    if (this.lastWasText) {
      process.stdout.write("\n")
    }
  }

  private processLine(line: string): void {
    try {
      const json: StreamJsonMessage = JSON.parse(line)
      this.formatMessage(json)
    } catch {
      // Not JSON, output as-is
      process.stdout.write(line + "\n")
    }
  }

  private formatMessage(msg: StreamJsonMessage): void {
    switch (msg.type) {
      case "system":
        // Skip init messages, they're noisy
        if (msg.subtype === "init") {
          process.stdout.write(
            `${colors.dim}[Session started]${colors.reset}\n`,
          )
        }
        break

      case "assistant":
        this.formatAssistantMessage(msg)
        break

      case "result":
        this.formatResult(msg)
        break

      default:
        // Skip other message types
        break
    }
  }

  private formatAssistantMessage(msg: StreamJsonMessage): void {
    const content = msg.message?.content
    if (!content) return

    for (const block of content) {
      if (block.type === "text" && block.text) {
        // Output assistant text directly
        process.stdout.write(block.text)
        this.lastWasText = true
      } else if (block.type === "tool_use" && block.name) {
        // Show tool usage summary
        if (this.lastWasText) {
          process.stdout.write("\n")
          this.lastWasText = false
        }
        const toolName = block.name.replace("mcp__", "").replace(/__/g, ":")
        process.stdout.write(`${colors.cyan}▶ ${toolName}${colors.reset}\n`)
      }
    }
  }

  private formatResult(msg: StreamJsonMessage): void {
    if (this.lastWasText) {
      process.stdout.write("\n")
      this.lastWasText = false
    }

    if (msg.subtype === "success") {
      const duration = msg.duration_ms
        ? `${(msg.duration_ms / 1000).toFixed(1)}s`
        : ""
      const cost = msg.total_cost_usd ? `$${msg.total_cost_usd.toFixed(4)}` : ""
      const info = [duration, cost].filter(Boolean).join(" | ")
      process.stdout.write(
        `\n${colors.green}✓ Done${colors.reset} ${colors.dim}${info}${colors.reset}\n`,
      )
    } else if (msg.subtype === "error") {
      process.stdout.write(`\n${colors.yellow}✗ Error${colors.reset}\n`)
    }
  }
}

/**
 * Create a simple function to process output chunks with pretty formatting
 */
export const createPrettyWriter = () => {
  const formatter = new OutputFormatter()
  return {
    write: (chunk: Uint8Array) => formatter.processChunk(chunk),
    flush: () => formatter.flush(),
  }
}
