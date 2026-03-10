import { OpenAiLanguageModel } from "@effect/ai-openai"
import { OpenAiLanguageModel as OpenAiCompatLanguageModel } from "@effect/ai-openai-compat"
import { NodeHttpClient } from "@effect/platform-node"
import { Codex, GithubCopilot } from "clanka"
import { Layer, Schema } from "effect"
import { Model } from "effect/unstable/ai"
import { layerKvs } from "./Kvs.ts"

export const ClankaProvider = Schema.Literals(["codex", "copilot"])
export type ClankaProvider = typeof ClankaProvider.Type

const codexLayer = Codex.layer.pipe(
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(layerKvs),
)

const copilotLayer = GithubCopilot.layer.pipe(
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(layerKvs),
)

const legacyCodexModelAliases = {
  "gpt-5.4-xhigh": {
    model: "gpt-5.4",
    config: {
      reasoning: {
        effort: "xhigh",
        summary: "auto",
      },
    },
  },
  "gpt-5.4-high": {
    model: "gpt-5.4",
    config: {
      reasoning: {
        effort: "high",
        summary: "auto",
      },
    },
  },
  "gpt-5.4-medium": {
    model: "gpt-5.4",
    config: {
      reasoning: {
        effort: "high",
        summary: "auto",
      },
    },
  },
} as const

type LegacyCodexModelAlias = keyof typeof legacyCodexModelAliases

export const normalizeLegacyClankaConfig = (
  model: string,
):
  | {
      readonly provider: ClankaProvider
      readonly model: string
    }
  | undefined => {
  const legacy = legacyCodexModelAliases[model as LegacyCodexModelAlias]
  if (!legacy) {
    return undefined
  }
  return {
    provider: "codex",
    model: legacy.model,
  }
}

const makeCodexModel = (model: string) => {
  const legacy = legacyCodexModelAliases[model as LegacyCodexModelAlias]
  const modelName = legacy?.model ?? model
  return Model.make(
    "codex",
    modelName,
    OpenAiLanguageModel.layer({
      model: modelName,
      ...(legacy ? { config: legacy.config } : {}),
    }).pipe(Layer.provide(codexLayer), Layer.orDie),
  )
}

const makeCopilotModel = (model: string) =>
  Model.make(
    "copilot",
    model,
    OpenAiCompatLanguageModel.layer({
      model,
    }).pipe(Layer.provide(copilotLayer), Layer.orDie),
  )

export const makeClankaModel = (options: {
  readonly provider: ClankaProvider
  readonly model: string
}) =>
  options.provider === "codex"
    ? makeCodexModel(options.model)
    : makeCopilotModel(options.model)
