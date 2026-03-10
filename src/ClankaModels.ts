import { NodeHttpClient } from "@effect/platform-node"
import { Codex } from "clanka"
import { Layer, LayerMap, PlatformError, Schema } from "effect"
import { layerKvs } from "./Kvs.ts"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"

export const CodexLayer: Layer.Layer<
  OpenAiClient.OpenAiClient,
  PlatformError.PlatformError
> = Codex.layer.pipe(
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(layerKvs),
)

export const clankaModels = {
  "gpt-5.4-xhigh": OpenAiLanguageModel.model("gpt-5.4", {
    reasoning: {
      effort: "xhigh",
      summary: "auto",
    },
  }).pipe(Layer.provideMerge(CodexLayer)),
  "gpt-5.4-high": OpenAiLanguageModel.model("gpt-5.4", {
    reasoning: {
      effort: "high",
      summary: "auto",
    },
  }).pipe(Layer.provideMerge(CodexLayer)),
  "gpt-5.4-medium": OpenAiLanguageModel.model("gpt-5.4", {
    reasoning: {
      effort: "high",
      summary: "auto",
    },
  }).pipe(Layer.provideMerge(CodexLayer)),
} as const

export type ClankaModel = keyof typeof clankaModels
export const ClankaModel = Schema.Literals(
  Object.keys(clankaModels) as ClankaModel[],
)

export const clankaSubagent = OpenAiLanguageModel.model("gpt-5.4", {
  reasoning: {
    effort: "low",
    summary: "auto",
  },
}).pipe(Layer.provideMerge(CodexLayer))

export class ClankaModels extends LayerMap.Service<ClankaModels>()(
  "lalph/ClankaModels",
  {
    layers: clankaModels,
  },
) {}
