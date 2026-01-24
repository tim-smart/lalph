import { Array, Effect, Option, Schema, String, identity } from "effect"
import { Prompt } from "effect/unstable/cli"
import { ChildProcess } from "effect/unstable/process"
import { Setting } from "./Settings.ts"

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
  return Option.match(stored, {
    onNone: () => identity<ChildProcess.Command>,
    onSome: (prefixOption) =>
      Option.match(prefixOption, {
        onNone: () => identity<ChildProcess.Command>,
        onSome: parseCommandPrefix,
      }),
  })
})
