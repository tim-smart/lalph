import { Array, Effect, Option, Path } from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"
import { ChildProcess } from "effect/unstable/process"
import { Prompt } from "effect/unstable/cli"
import { allCliAgents } from "./domain/CliAgent.ts"
import { selectedCliAgentId } from "./Settings.ts"
import { Worktree } from "./Worktree.ts"

export const run = Effect.fnUntraced(
  function* (options: { readonly autoMerge: boolean }) {
    const pathService = yield* Path.Path
    const worktree = yield* Worktree
    const promptGen = yield* PromptGen
    const cliAgent = yield* getOrSelectCliAgent
    const prd = yield* Prd

    const cliCommand = cliAgent.command({
      prompt: promptGen.prompt,
      prdFilePath: pathService.join(".lalph", "prd.json"),
      progressFilePath: "PROGRESS.md",
    })
    const exitCode = yield* ChildProcess.make(
      cliCommand[0]!,
      cliCommand.slice(1),
      {
        cwd: worktree.directory,
        extendEnv: true,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    ).pipe(ChildProcess.exitCode)

    yield* Effect.log(`Agent exited with code: ${exitCode}`)

    if (options.autoMerge) {
      const prs = yield* prd.mergableGithubPrs
      for (const pr of prs) {
        yield* ChildProcess.make`gh pr merge ${pr} -sd`.pipe(
          ChildProcess.exitCode,
        )
      }
    }
  },
  Effect.scoped,
  Effect.provide([PromptGen.layer, Prd.layer, Worktree.layer]),
)

export const selectCliAgent = Effect.gen(function* () {
  const agent = yield* Prompt.select({
    message: "Select the CLI agent to use",
    choices: allCliAgents.map((agent) => ({
      title: agent.name,
      value: agent,
    })),
  })
  yield* selectedCliAgentId.set(Option.some(agent.id))
  return agent
})

const getOrSelectCliAgent = Effect.gen(function* () {
  const selectedAgent = (yield* selectedCliAgentId.get).pipe(
    Option.filterMap((id) =>
      Array.findFirst(allCliAgents, (agent) => agent.id === id),
    ),
  )
  if (Option.isSome(selectedAgent)) {
    return selectedAgent.value
  }
  return yield* selectCliAgent
})
