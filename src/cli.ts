#!/usr/bin/env node

import { Command } from "effect/unstable/cli"
import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { Settings } from "./Settings.ts"
import { commandRoot } from "./commands/root.ts"
import { commandPlan } from "./commands/plan.ts"
import { commandIssue } from "./commands/issue.ts"
import { commandEdit } from "./commands/edit.ts"
import { commandSource } from "./commands/source.ts"
import PackageJson from "../package.json" with { type: "json" }
import { TracingLayer } from "./Tracing.ts"
import { MinimumLogLevel } from "effect/References"
import { PlatformServices } from "./shared/platform.ts"
import { commandProjects } from "./commands/projects.ts"
import { commandSh } from "./commands/sh.ts"
import { commandAgents } from "./commands/agents.ts"
import { commandFeatures } from "./commands/features.ts"
import { FeatureStorageRoot, FeatureStore } from "./FeatureStore.ts"
import { FeatureCreateWizard } from "./FeatureCreation.ts"

commandRoot.pipe(
  Command.withSubcommands([
    commandPlan,
    commandIssue,
    commandEdit,
    commandSh,
    commandSource,
    commandAgents,
    commandProjects,
    commandFeatures,
  ]),
  Command.provide(Settings.layer),
  Command.provide(FeatureCreateWizard.layer),
  Command.provide(FeatureStorageRoot.layer),
  Command.provide(FeatureStore.layer),
  Command.provide(TracingLayer),
  Command.provide(({ verbose }) => {
    if (!verbose) return Layer.empty
    return Layer.succeed(MinimumLogLevel, "All")
  }),
  Command.run({
    version: PackageJson.version,
  }),
  Effect.provide(PlatformServices),
  NodeRuntime.runMain,
)
