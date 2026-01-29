#!/usr/bin/env node

import { Command } from "effect/unstable/cli"
import { Effect, Layer } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Settings } from "./Settings.ts"
import { commandRoot } from "./commands/root.ts"
import { commandPlan } from "./commands/plan.ts"
import { commandIssue } from "./commands/issue.ts"
import { commandEdit } from "./commands/edit.ts"
import { commandShell } from "./commands/shell.ts"
import { commandSource } from "./commands/source.ts"
import { commandAgent } from "./commands/agent.ts"
import PackageJson from "../package.json" with { type: "json" }
import { resetCurrentIssueSource } from "./IssueSources.ts"
import { TracingLayer } from "./Tracing.ts"
import { MinimumLogLevel } from "effect/References"
import { lalphMemoMap } from "./shared/runtime.ts"

commandRoot.pipe(
  Command.withSubcommands([
    commandPlan,
    commandIssue,
    commandEdit,
    commandShell,
    commandSource,
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
  Command.provide(({ verbose }) =>
    verbose ? Layer.succeed(MinimumLogLevel, "All") : Layer.empty,
  ),
  (_) =>
    Command.run(_, {
      version: PackageJson.version,
    }),
  Effect.provide(NodeServices.layer),
  Effect.provideService(Layer.CurrentMemoMap, lalphMemoMap),
  NodeRuntime.runMain,
)
