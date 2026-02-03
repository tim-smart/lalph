import { Array, Effect, Option, Schema } from "effect"
import { Setting, Settings } from "./Settings.ts"
import { CliAgentPreset, CliAgentPresetId } from "./domain/CliAgentPreset.ts"
import { Prompt } from "effect/unstable/cli"
import { allCliAgents } from "./domain/CliAgent.ts"
import { parseCommand } from "./shared/child-process.ts"
import { IssueSource } from "./IssueSource.ts"

export const allCliAgentPresets = new Setting(
  "cliAgentPresets",
  Schema.Array(CliAgentPreset),
)

export const getAllCliAgentPresets = Settings.get(allCliAgentPresets).pipe(
  Effect.map(Option.getOrElse((): ReadonlyArray<CliAgentPreset> => [])),
)

export const getPresetsWithMetadata = <S extends Schema.Top>(
  source: string,
  schema: S,
) =>
  getAllCliAgentPresets.pipe(
    Effect.flatMap(
      Effect.forEach((preset) =>
        preset.decodeMetadata(source, schema).pipe(
          Effect.map(
            Option.map((metadata) => ({
              preset,
              metadata,
            })),
          ),
        ),
      ),
    ),
    Effect.map(Array.getSomes),
  )

export const cliAgentPresetById = Effect.fnUntraced(function* (
  presetId: CliAgentPresetId,
) {
  const presets = yield* getAllCliAgentPresets
  return Array.findFirst(presets, (p) => p.id === presetId)
})

export const getDefaultCliAgentPreset = Effect.gen(function* () {
  const presets = yield* getAllCliAgentPresets
  const preset = presets.find((p) => p.id === CliAgentPreset.defaultId)
  return preset ?? (yield* welcomeWizard)
})

export const welcomeWizard = Effect.gen(function* () {
  const welcome = [
    "  .--.",
    " |^()^|  lalph",
    "  '--'",
    "",
    "Let's setup your default AI agent preset.",
    "AI agent presets let you configure what cli agent lalph",
    "uses to run tasks.",
    "",
  ].join("\n")
  console.log(welcome)
  return yield* addOrUpdatePreset({
    allowSourceMetadata: false,
    idOverride: CliAgentPreset.defaultId,
  })
})

export const addOrUpdatePreset = Effect.fnUntraced(function* (options: {
  readonly existing?: CliAgentPreset
  readonly allowSourceMetadata: boolean
  readonly idOverride?: CliAgentPresetId
}) {
  const presets = yield* getAllCliAgentPresets

  const id = options.existing
    ? options.existing.id
    : (options.idOverride ??
      CliAgentPresetId.makeUnsafe(
        yield* Prompt.text({
          message: "Preset name",
          validate(input) {
            input = input.trim()
            if (input.length === 0) {
              return Effect.fail("Preset name cannot be empty")
            } else if (presets.some((p) => p.id === input)) {
              return Effect.fail("Preset already exists")
            }
            return Effect.succeed(input)
          },
        }),
      ))

  const cliAgent = yield* selectCliAgent
  const commandPrefix = yield* promptForCommandPrefix
  const extraArgs = yield* Prompt.text({
    message: "Extra arguments pass to the CLI agent? (leave empty for none)",
  })
    .asEffect()
    .pipe(Effect.map(parseCommand))

  let preset = new CliAgentPreset({
    id,
    cliAgent,
    commandPrefix,
    extraArgs,
    sourceMetadata: {},
  })

  if (options.allowSourceMetadata) {
    const source = yield* IssueSource
    preset = yield* source.updateCliAgentPreset(preset)
  }

  yield* Settings.set(
    allCliAgentPresets,
    Option.some(
      options.existing
        ? presets.map((p) => (p.id === preset.id ? preset : p))
        : [...presets, preset],
    ),
  )

  return preset
})

const selectCliAgent = Prompt.select({
  message: "Select the CLI agent to use",
  choices: allCliAgents.map((agent) => ({
    title: agent.name,
    value: agent,
  })),
})

const promptForCommandPrefix = Effect.gen(function* () {
  const prefix = yield* Prompt.text({
    message: "Command prefix for cli command? (leave empty for none)",
  })
  return parseCommand(prefix)
})
