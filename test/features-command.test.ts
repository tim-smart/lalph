import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { FeatureNotFound, FeatureStore } from "../src/FeatureStore.ts"
import { commandFeatures } from "../src/commands/features.ts"
import { Feature, FeatureName } from "../src/domain/Feature.ts"
import { ProjectId } from "../src/domain/Project.ts"

const tempDirectories: Array<string> = []

after(async () => {
  await Promise.all(
    tempDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

const makeTempDirectory = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "lalph-features-command-"),
  )
  tempDirectories.push(directory)
  return directory
}

const makeFeature = (name: string, overrides: Partial<Feature> = {}) =>
  new Feature({
    name: FeatureName.makeUnsafe(name),
    projectId: ProjectId.makeUnsafe("project-alpha"),
    executionMode: "pr",
    specFilePath: `.specs/${name}.md`,
    baseBranch: "master",
    featureBranch: `feature/${name}`,
    lifecycleStatus: "active",
    ...overrides,
  })

const seedFeatures = (directory: string, features: ReadonlyArray<Feature>) =>
  Effect.runPromise(
    Effect.forEach(features, (feature) => FeatureStore.create(feature)).pipe(
      Effect.provide(FeatureStore.layerAt(directory)),
    ),
  )

const runFeaturesCommand = (directory: string, args: ReadonlyArray<string>) =>
  Command.runWith(commandFeatures, { version: "test" })(args).pipe(
    Effect.provide(FeatureStore.layerAt(directory)),
  )

const captureConsoleLogs = async <A>(f: () => Promise<A>) => {
  const logs: Array<string> = []
  const originalLog = console.log

  console.log = (...args) => {
    logs.push(args.map(String).join(" "))
  }

  try {
    const result = await f()
    return {
      output: logs.join("\n"),
      result,
    }
  } finally {
    console.log = originalLog
  }
}

describe("features commands", () => {
  it("shows a helpful empty state for features ls", async () => {
    const directory = await makeTempDirectory()

    const { output } = await captureConsoleLogs(() =>
      Effect.runPromise(runFeaturesCommand(directory, ["ls"])),
    )

    assert.equal(
      output,
      "No features configured yet. Run 'lalph features create' to get started.",
    )
  })

  it("lists persisted feature metadata with features ls", async () => {
    const directory = await makeTempDirectory()
    const alpha = makeFeature("alpha", {
      executionMode: "pr",
      lifecycleStatus: "active",
    })
    const beta = makeFeature("beta", {
      projectId: ProjectId.makeUnsafe("project-beta"),
      executionMode: "ralph",
      baseBranch: "develop",
      featureBranch: "feature/beta",
      specFilePath: ".specs/beta.md",
      lifecycleStatus: "paused",
    })

    await seedFeatures(directory, [beta, alpha])

    const { output } = await captureConsoleLogs(() =>
      Effect.runPromise(runFeaturesCommand(directory, ["ls"])),
    )

    assert.match(output, /Feature: alpha/)
    assert.match(output, /  Project: project-alpha/)
    assert.match(output, /  Execution mode: pr/)
    assert.match(output, /  Base branch: master/)
    assert.match(output, /  Feature branch: feature\/alpha/)
    assert.match(output, /  Spec file: \.specs\/alpha\.md/)
    assert.match(output, /  Lifecycle status: active/)
    assert.match(output, /Feature: beta/)
    assert.match(output, /  Project: project-beta/)
    assert.match(output, /  Execution mode: ralph/)
    assert.match(output, /  Base branch: develop/)
    assert.match(output, /  Lifecycle status: paused/)
    assert.ok(
      output.indexOf("Feature: alpha") < output.indexOf("Feature: beta"),
    )
  })

  it("shows full stored metadata for one feature", async () => {
    const directory = await makeTempDirectory()
    const feature = makeFeature("feature-inspect", {
      lifecycleStatus: "draft",
      parentIssueSourceId: "LIN-101",
      finalIntegrationPrId: "github:42",
    })

    await seedFeatures(directory, [feature])

    const { output } = await captureConsoleLogs(() =>
      Effect.runPromise(
        runFeaturesCommand(directory, ["show", "feature-inspect"]),
      ),
    )

    assert.match(output, /Feature: feature-inspect/)
    assert.match(output, /  Project: project-alpha/)
    assert.match(output, /  Execution mode: pr/)
    assert.match(output, /  Spec file: \.specs\/feature-inspect\.md/)
    assert.match(output, /  Base branch: master/)
    assert.match(output, /  Feature branch: feature\/feature-inspect/)
    assert.match(output, /  Lifecycle status: draft/)
    assert.match(output, /  Parent issue source ID: LIN-101/)
    assert.match(output, /  Final integration PR ID: github:42/)
  })

  it("fails clearly for unknown feature names", async () => {
    const directory = await makeTempDirectory()

    const exit = await Effect.runPromiseExit(
      runFeaturesCommand(directory, ["show", "missing-feature"]),
    )

    assert.equal(exit._tag, "Failure")
    assert.ok(exit.cause.reasons[0]?.error instanceof FeatureNotFound)
    assert.equal(
      exit.cause.reasons[0]?.error.message,
      'Feature "missing-feature" was not found.',
    )
  })
})
