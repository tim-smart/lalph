import { Array, Effect, Option, Schema, String, identity } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import { ChildProcess } from "effect/unstable/process"
import { allCliAgents } from "../domain/CliAgent.ts"
import { Setting, selectedCliAgentId } from "../Settings.ts"

const commandPrefixSetting = new Setting(
  "commandPrefix",
  Schema.Option(Schema.String),
)

const parseCommandPrefix = (value: string) => {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  return Array.isArrayNonEmpty(parts)
    ? ChildProcess.prefix(parts[0], parts.slice(1))
    : identity<ChildProcess.Command>
}

const normalizePrefix = (value: string) =>
  Option.some(value.trim()).pipe(Option.filter(String.isNonEmpty))

export const promptForCommandPrefix = Effect.gen(function* () {
  const prefix = yield* Prompt.text({
    message: "Command prefix for agent commands? (leave empty for none)",
  })
  const prefixOption = normalizePrefix(prefix)
  yield* commandPrefixSetting.set(Option.some(prefixOption))
  return prefixOption
})

export const getCommandPrefix = Effect.gen(function* () {
  const stored = yield* commandPrefixSetting.get
  return Option.match(Option.flatten(stored), {
    onNone: () => identity<ChildProcess.Command>,
    onSome: parseCommandPrefix,
  })
})

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

export const getOrSelectCliAgent = Effect.gen(function* () {
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

export const commandAgent = Command.make("agent").pipe(
  Command.withDescription("Select the CLI agent to use"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const agent = yield* selectCliAgent
      yield* promptForCommandPrefix
      return agent
    }),
  ),
)
