import {
  Data,
  PlatformError,
  Schema,
  SchemaTransformation,
  Stream,
} from "effect"
import { ChildProcess } from "effect/unstable/process"
import { claudeOutputTransformer } from "../CliAgent/claude.ts"

export class CliAgent<const Id extends string> extends Data.Class<{
  id: Id
  name: string
  outputTransformer?: OutputTransformer | undefined
  command: (options: {
    readonly prompt: string
    readonly prdFilePath: string
    readonly extraArgs: ReadonlyArray<string>
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
  command: ({ prompt, prdFilePath, extraArgs }) =>
    ChildProcess.make(
      "opencode",
      ["run", prompt, "--thinking", ...extraArgs, "-f", prdFilePath],
      {
        extendEnv: true,
        env: {
          OPENCODE_PERMISSION: '{"*":"allow", "question":"deny"}',
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      },
    ),
  commandPlan: ({ prompt, prdFilePath, dangerous }) =>
    ChildProcess.make(
      "opencode",
      [
        "--prompt",
        `@${prdFilePath}

${prompt}`,
      ],
      {
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
      },
    ),
})

const claude = new CliAgent({
  id: "claude",
  name: "Claude Code",
  command: ({ prompt, prdFilePath, extraArgs }) =>
    ChildProcess.make(
      "claude",
      [
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose",
        "--disallowed-tools",
        "AskUserQuestion",
        ...extraArgs,
        "--",
        `@${prdFilePath}

${prompt}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      },
    ),
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
  command: ({ prompt, prdFilePath, extraArgs }) =>
    ChildProcess.make(
      "codex",
      [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        ...extraArgs,
        `@${prdFilePath}

${prompt}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      },
    ),
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
  command: ({ prompt, prdFilePath, extraArgs }) =>
    ChildProcess.make(
      "amp",
      [
        "--dangerously-allow-all",
        "--stream-json-thinking",
        ...extraArgs,
        `@${prdFilePath}

${prompt}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      },
    ),
  commandPlan: () =>
    ChildProcess.make({
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })`echo ${"Plan mode is not supported for amp."}`,
})

export const allCliAgents = [opencode, claude, codex, amp] as const
export type AnyCliAgent = (typeof allCliAgents)[number]

export const CliAgentFromId = Schema.Literals(
  allCliAgents.map((agent) => agent.id),
).pipe(
  Schema.decodeTo(
    Schema.declare((u: unknown): u is AnyCliAgent =>
      // oxlint-disable-next-line typescript/no-explicit-any
      allCliAgents.includes(u as any),
    ),
    SchemaTransformation.transform({
      decode: (id) => allCliAgents.find((agent) => agent.id === id)!,
      encode: (agent) => agent.id,
    }),
  ),
)
