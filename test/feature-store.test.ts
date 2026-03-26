import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { Effect, Option } from "effect"
import {
  FeatureNotFound,
  FeatureStore,
  InvalidFeatureFile,
} from "../src/FeatureStore.ts"
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
  const directory = await mkdtemp(path.join(tmpdir(), "lalph-feature-store-"))
  tempDirectories.push(directory)
  return directory
}

const runWithStore = <A, E>(
  directory: string,
  effect: Effect.Effect<A, E, FeatureStore>,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(FeatureStore.layerAt(directory))),
  )

const makeFeature = () =>
  new Feature({
    name: FeatureName.makeUnsafe("feature-persistence"),
    projectId: ProjectId.makeUnsafe("project-alpha"),
    executionMode: "pr",
    specFilePath: ".specs/feature-driven-execution.md",
    baseBranch: "master",
    featureBranch: "feature/feature-persistence",
    lifecycleStatus: "draft",
    parentIssueSourceId: "LIN-101",
  })

describe("FeatureStore", () => {
  it("round-trips persisted feature metadata", async () => {
    const directory = await makeTempDirectory()
    const feature = makeFeature()

    await runWithStore(directory, FeatureStore.create(feature))

    const loaded = await runWithStore(
      directory,
      FeatureStore.load(feature.name),
    )
    assert.ok(Option.isSome(loaded))
    assert.deepEqual(loaded.value, feature)

    const updated = feature.update({
      lifecycleStatus: "active",
      finalIntegrationPrId: "github:42",
    })
    await runWithStore(directory, FeatureStore.update(updated))

    const listed = await runWithStore(directory, FeatureStore.list())
    assert.deepEqual(listed, [updated])
  })

  it("returns none for missing features and a not-found error on update", async () => {
    const directory = await makeTempDirectory()
    const feature = makeFeature()

    const loaded = await runWithStore(
      directory,
      FeatureStore.load(feature.name),
    )
    assert.ok(Option.isNone(loaded))

    const exit = await Effect.runPromiseExit(
      FeatureStore.update(feature).pipe(
        Effect.provide(FeatureStore.layerAt(directory)),
      ),
    )
    assert.equal(exit._tag, "Failure")
    assert.ok(exit.cause.reasons[0]?.error instanceof FeatureNotFound)
  })

  it("fails when a feature file exists but contains invalid data", async () => {
    const directory = await makeTempDirectory()
    const featuresDirectory = path.join(directory, ".lalph", "features")
    await mkdir(featuresDirectory, { recursive: true })
    await writeFile(
      path.join(featuresDirectory, "broken.json"),
      JSON.stringify({ name: 1 }),
    )

    const loadExit = await Effect.runPromiseExit(
      FeatureStore.load(FeatureName.makeUnsafe("broken")).pipe(
        Effect.provide(FeatureStore.layerAt(directory)),
      ),
    )
    assert.equal(loadExit._tag, "Failure")
    assert.ok(loadExit.cause.reasons[0]?.error instanceof InvalidFeatureFile)

    const listExit = await Effect.runPromiseExit(
      FeatureStore.list().pipe(Effect.provide(FeatureStore.layerAt(directory))),
    )
    assert.equal(listExit._tag, "Failure")
    assert.ok(listExit.cause.reasons[0]?.error instanceof InvalidFeatureFile)
  })
})
