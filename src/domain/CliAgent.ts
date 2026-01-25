import { Data } from "effect"
import { ChildProcess } from "effect/unstable/process"

export class CliAgent extends Data.Class<{
  id: string
  name: string
  command: (options: {
    readonly outputMode: "pipe" | "inherit"
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
  commandPlan: (options: {
    readonly outputMode: "pipe" | "inherit"
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
}> {}

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
  commandPlan: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      extendEnv: true,
      stdout: outputMode,
      stderr: outputMode,
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
    })`claude --dangerously-skip-permissions --output-format stream-json -p ${`@${prdFilePath}

${prompt}`}`,
  commandPlan: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`claude ${`@${prdFilePath}

${prompt}`}`,
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
  commandPlan: ({ outputMode, prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`codex ${`@${prdFilePath}

${prompt}`}`,
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
  commandPlan: ({ outputMode }) =>
    ChildProcess.make({
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`echo ${"Plan mode is not supported for amp."}`,
})

export const allCliAgents = [opencode, claude, codex, amp]
