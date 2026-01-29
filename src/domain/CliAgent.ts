import { Data, PlatformError, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { claudeOutputTransformer } from "../CliAgent/claude.ts"

export class CliAgent extends Data.Class<{
  id: string
  name: string
  outputTransformer?: OutputTransformer | undefined
  command: (options: {
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
  commandPlan: (options: {
    readonly prompt: string
    readonly prdFilePath: string
    readonly dangerous: boolean
  }) => ChildProcess.Command
}> {}

export type OutputTransformer = (
  stream: Stream.Stream<string, PlatformError.PlatformError>,
) => Stream.Stream<string, PlatformError.PlatformError>

const opencode = new CliAgent({
  id: "opencode",
  name: "opencode",
  command: ({ prompt, prdFilePath }) => {
    console.log("Got prompt:", prompt)
    return ChildProcess.make({
      extendEnv: true,
      env: {
        OPENCODE_PERMISSION: '{"*":"allow"}',
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
    })`opencode run ${prompt} -f ${prdFilePath}`
  },
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
  command: ({ prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
    })`claude --dangerously-skip-permissions --output-format stream-json --verbose --disallowed-tools AskUserQuestion -p ${`@${prdFilePath}

${prompt}`}`,
  outputTransformer: claudeOutputTransformer,
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
  command: ({ prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: "pipe",
      stderr: "pipe",
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
  command: ({ prompt, prdFilePath }) =>
    ChildProcess.make({
      stdout: "pipe",
      stderr: "pipe",
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
