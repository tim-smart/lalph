import { Data } from "effect"

export class CliAgent extends Data.Class<{
  id: string
  name: string
  command: (options: {
    readonly prompt: string
    readonly prdFilePath: string
    readonly progressFilePath: string
  }) => ReadonlyArray<string>
}> {}

export const opencode = new CliAgent({
  id: "opencode",
  name: "opencode",
  command: ({ prompt, prdFilePath, progressFilePath }) => [
    "npx",
    "-y",
    "opencode-ai@latest",
    "run",
    prompt,
    "-f",
    prdFilePath,
    "-f",
    progressFilePath,
  ],
})

export const claude = new CliAgent({
  id: "claude",
  name: "Claude Code",
  command: ({ prompt, prdFilePath, progressFilePath }) => [
    "npx",
    "-y",
    "@anthropic-ai/claude-code@latest",
    "-p",
    `@${prdFilePath} @${progressFilePath}

${prompt}`,
  ],
})

export const allCliAgents = [opencode, claude]
