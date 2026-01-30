#!/usr/bin/env node

import { Command } from "effect/unstable/cli"
import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { Settings } from "./Settings.ts"
import { commandRoot } from "./commands/root.ts"
import { commandPlan } from "./commands/plan.ts"
import { commandIssue } from "./commands/issue.ts"
import { commandEdit } from "./commands/edit.ts"
import { commandShell } from "./commands/shell.ts"
import { commandSource, commandSourceStatus } from "./commands/source.ts"
import { commandAgent } from "./commands/agent.ts"
import PackageJson from "../package.json" with { type: "json" }
import { resetCurrentIssueSource } from "./IssueSources.ts"
import { TracingLayer } from "./Tracing.ts"
import { MinimumLogLevel } from "effect/References"
import { atomRuntime, lalphMemoMap } from "./shared/runtime.ts"
import { PlatformServices } from "./shared/platform.ts"

commandRoot.pipe(
  Command.withSubcommands([
    commandPlan,
    commandIssue,
    commandEdit,
    commandShell,
    commandSource,
    commandSourceStatus,
    commandAgent,
  ]),
  // Common flags are handled here
  Command.provideEffectDiscard(
    Effect.fnUntraced(function* (options) {
      if (options.reset) {
        yield* resetCurrentIssueSource
      }
    }),
  ),
  Command.provide(Settings.layer),
  Command.provide(TracingLayer),
  Command.provide(({ verbose }) => {
    if (!verbose) return Layer.empty
    const logLevel = Layer.succeed(MinimumLogLevel, "All")
    atomRuntime.addGlobalLayer(logLevel)
    return logLevel
  }),
  Command.run({
    version: PackageJson.version,
  }),
  Effect.provide(PlatformServices),
  Effect.provideService(Layer.CurrentMemoMap, lalphMemoMap),
  NodeRuntime.runMain,
)
