import { Data, PlatformError, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { claudeOutputTransformer } from "../CliAgent/claude.ts"

export class CliAgent extends Data.Class<{
  id: string
  name: string
  outputTransformer?: OutputTransformer | undefined
  command: (options: {
    readonly outputMode: "pipe" | "inherit"
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
  commandChoose?: (options: {
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
  commandPlan: (options: {
    readonly prompt: string
    readonly prdFilePath: string
    readonly dangerous: boolean
  }) => ChildProcess.Command
}> {
  resolveCommandChoose(options: {
    readonly prompt: string
    readonly prdFilePath: string
  }) {
    return this.commandChoose
      ? this.commandChoose(options)
      : this.command({
          ...options,
          outputMode: "inherit",
        })
  }
}

export type OutputTransformer = (
  stream: Stream.Stream<string, PlatformError.PlatformError>,
) => Stream.Stream<string, PlatformError.PlatformError>

const opencode = new CliAgent({
  id: "opencode",
  name: "opencode",
  command: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      extendEnv: true,
      env: {
        OPENCODE_PERMISSION: '{"*":"allow"}',
      },
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`opencode run ${prompt} -f ${prdFilePath}`,
  commandPlan: ({ prompt, prdFilePath, dangerous }) =>
    ChildProcess.make({
      extendEnv: true,
      ...(dangerous
        ? {
            env: {
              OPENCODE_PERMISSION: '{"*":"allow"}',
            },
          }
        : {}),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })`opencode --prompt ${`@${prdFilePath}

${prompt}`}`,
})

const claude = new CliAgent({
  id: "claude",
  name: "Claude Code",
  command: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`claude --dangerously-skip-permissions --output-format stream-json --verbose --disallowed-tools AskUserQuestion -p ${`@${prdFilePath}

${prompt}`}`,
  outputTransformer: claudeOutputTransformer,
  commandChoose: ({ prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })`claude --dangerously-skip-permissions -p ${`@${prdFilePath}

${prompt}`}`,
  commandPlan: ({ prompt, prdFilePath, dangerous }) =>
    ChildProcess.make(
      "claude",
      [
        ...(dangerous ? ["--dangerously-skip-permissions"] : []),
        `@${prdFilePath}

${prompt}`,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    ),
})

const codex = new CliAgent({
  id: "codex",
  name: "Codex CLI",
  command: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`codex exec --dangerously-bypass-approvals-and-sandbox ${`@${prdFilePath}

${prompt}`}`,
  commandPlan: ({ prompt, prdFilePath, dangerous }) =>
    ChildProcess.make(
      "codex",
      [
        ...(dangerous ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
        `@${prdFilePath}

${prompt}`,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    ),
})

const amp = new CliAgent({
  id: "amp",
  name: "amp",
  command: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`amp --dangerously-allow-all --stream-json-thinking -x ${`@${prdFilePath}

${prompt}`}`,
  commandPlan: () =>
    ChildProcess.make({
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })`echo ${"Plan mode is not supported for amp."}`,
})

export const allCliAgents = [opencode, claude, codex, amp]
