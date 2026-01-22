import { Data } from "effect"
import type { Worktree } from "../Worktree.ts"
import { ChildProcess } from "effect/unstable/process"

export class CliAgent extends Data.Class<{
  id: string
  name: string
  command: (options: {
    readonly worktree: Worktree["Service"]
    readonly outputMode: "pipe" | "inherit"
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
  commandPlan: (options: {
    readonly worktree: Worktree["Service"]
    readonly outputMode: "pipe" | "inherit"
    readonly prompt: string
    readonly prdFilePath: string
  }) => ChildProcess.Command
}> {}

export const opencode = new CliAgent({
  id: "opencode",
  name: "opencode",
  command: ({ outputMode, prompt, prdFilePath, worktree }) =>
    ChildProcess.make({
      cwd: worktree.directory,
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
      env: {
        OPENCODE_PERMISSION: '{"*":"allow"}',
      },
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`opencode --prompt ${`@${prdFilePath}

${prompt}`}`,
})

export const claude = new CliAgent({
  id: "claude",
  name: "Claude Code",
  command: ({ outputMode, prompt, prdFilePath, worktree }) =>
    ChildProcess.make({
      cwd: worktree.directory,
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`claude --dangerously-skip-permissions -p ${`@${prdFilePath}

${prompt}`}`,
  commandPlan: ({ outputMode, prompt, prdFilePath, worktree }) =>
    ChildProcess.make({
      cwd: worktree.directory,
      stdout: outputMode,
      stderr: outputMode,
      stdin: "inherit",
    })`claude ${`@${prdFilePath}

${prompt}`}`,
})

export const allCliAgents = [opencode, claude]
