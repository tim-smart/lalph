#!/usr/bin/env node

import { Command } from "effect/unstable/cli"
import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { Settings } from "./Settings.ts"
import { commandRoot } from "./commands/root.ts"
import { commandPlan } from "./commands/plan.ts"
import { commandIssue, commandIssueAlias } from "./commands/issue.ts"
import { commandEdit, commandEditAlias } from "./commands/edit.ts"
import { commandSource } from "./commands/source.ts"
import PackageJson from "../package.json" with { type: "json" }
import { TracingLayer } from "./Tracing.ts"
import { MinimumLogLevel } from "effect/References"
import { atomRuntime, lalphMemoMap } from "./shared/runtime.ts"
import { PlatformServices } from "./shared/platform.ts"
import { commandProjects, commandProjectsAlias } from "./commands/projects.ts"
import { commandSh } from "./commands/sh.ts"

commandRoot.pipe(
  Command.withSubcommands([
    commandPlan,
    commandIssue,
    commandEdit,
    commandSh,
    commandSource,
    commandProjects,
    commandIssueAlias,
    commandEditAlias,
    commandProjectsAlias,
  ]),
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
