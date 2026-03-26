import {
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  ServiceMap,
} from "effect"
import { Prompt } from "effect/unstable/cli"
import {
  FeatureAlreadyExists,
  FeatureStorageRoot,
  FeatureStore,
} from "./FeatureStore.ts"
import { Feature, FeatureExecutionMode, FeatureName } from "./domain/Feature.ts"
import type { Project } from "./domain/Project.ts"
import { getAllProjects } from "./Projects.ts"

export type FeatureSpecFileSource = "new" | "existing"

export interface FeatureCreateInput {
  readonly project: Project
  readonly executionMode: FeatureExecutionMode
  readonly name: string
  readonly baseBranch: string
  readonly featureBranch: string
  readonly specFilePath: string
  readonly specFileSource: FeatureSpecFileSource
}

export class NoProjectsConfigured extends Data.TaggedError(
  "NoProjectsConfigured",
) {
  readonly message =
    "No projects configured yet. Run 'lalph projects add' first."
}

export class SpecFileAlreadyExists extends Data.TaggedError(
  "SpecFileAlreadyExists",
)<{
  readonly path: string
}> {
  readonly message = `Spec file "${this.path}" already exists.`
}

export class SpecFileNotFound extends Data.TaggedError("SpecFileNotFound")<{
  readonly path: string
}> {
  readonly message = `Spec file "${this.path}" was not found.`
}

const validateNonEmpty = (label: string) => (input: string) => {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return Effect.fail(`${label} cannot be empty`)
  }
  return Effect.succeed(trimmed)
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const defaultFeatureBranch = (name: string) => {
  const slug = slugify(name)
  return slug.length > 0 ? `feature/${slug}` : "feature/new-feature"
}

const defaultSpecFilePath = (name: string) => {
  const slug = slugify(name)
  return slug.length > 0 ? `.specs/${slug}.md` : ".specs/new-feature.md"
}

const renderInitialSpec = (input: {
  readonly name: string
  readonly executionMode: FeatureExecutionMode
}) =>
  [
    `# ${input.name}`,
    "",
    "## Summary",
    "",
    `Planned ${input.executionMode}-mode feature created with \`lalph features create\`.`,
    "",
    "## Tasks",
    "",
    "- [ ] Define the implementation plan",
    "",
  ].join("\n")

const resolveSpecFilePath = (
  pathService: Path.Path,
  root: string,
  specFilePath: string,
) =>
  pathService.isAbsolute(specFilePath)
    ? pathService.normalize(specFilePath)
    : pathService.join(root, specFilePath)

const normalizeInput = (input: FeatureCreateInput): FeatureCreateInput => ({
  ...input,
  name: input.name.trim(),
  baseBranch: input.baseBranch.trim(),
  featureBranch: input.featureBranch.trim(),
  specFilePath: input.specFilePath.trim(),
})

const bootstrapSpecFile = Effect.fnUntraced(function* (
  input: FeatureCreateInput,
) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const root = yield* FeatureStorageRoot
  const absoluteSpecFilePath = resolveSpecFilePath(
    pathService,
    root,
    input.specFilePath,
  )

  if (input.specFileSource === "existing") {
    if (!(yield* fs.exists(absoluteSpecFilePath))) {
      return yield* new SpecFileNotFound({ path: input.specFilePath })
    }
    return
  }

  if (yield* fs.exists(absoluteSpecFilePath)) {
    return yield* new SpecFileAlreadyExists({ path: input.specFilePath })
  }

  yield* fs.makeDirectory(pathService.dirname(absoluteSpecFilePath), {
    recursive: true,
  })
  yield* fs.writeFileString(
    absoluteSpecFilePath,
    renderInitialSpec({
      name: input.name,
      executionMode: input.executionMode,
    }),
  )
})

const promptForFeatureCreate = Effect.fnUntraced(function* () {
  const projects = yield* getAllProjects

  if (projects.length === 0) {
    return yield* new NoProjectsConfigured()
  }

  const project = yield* Prompt.select({
    message: "Project",
    choices: projects.map((project) => ({
      title: project.id,
      description: `Git flow: ${project.gitFlow}`,
      value: project,
    })),
  })

  const executionMode = yield* Prompt.select({
    message: "Execution mode",
    choices: [
      {
        title: "Pull Request",
        description: "Track child work with PRs targeting the feature branch",
        value: "pr",
      },
      {
        title: "Ralph",
        description: "Run the feature directly from its spec file",
        value: "ralph",
      },
    ] as const,
  })

  const name = yield* Prompt.text({
    message: "Feature name",
    validate: validateNonEmpty("Feature name"),
  })
  const baseBranch = yield* Prompt.text({
    message: "Base branch",
    default: Option.getOrElse(project.targetBranch, () => "master"),
    validate: validateNonEmpty("Base branch"),
  })
  const featureBranch = yield* Prompt.text({
    message: "Feature branch",
    default: defaultFeatureBranch(name),
    validate: validateNonEmpty("Feature branch"),
  })
  const specFileSource = yield* Prompt.select({
    message: "Spec file source",
    choices: [
      {
        title: "Create new spec file",
        description: "Bootstrap a new spec file at the path you choose",
        value: "new",
      },
      {
        title: "Use existing spec file",
        description: "Point the feature at a spec file that already exists",
        value: "existing",
      },
    ] as const,
  })
  const specFilePath = yield* Prompt.text({
    message:
      specFileSource === "new"
        ? "Path for new spec file"
        : "Path to existing spec file",
    default: defaultSpecFilePath(name),
    validate: validateNonEmpty("Spec file path"),
  })

  return {
    project,
    executionMode,
    name,
    baseBranch,
    featureBranch,
    specFilePath,
    specFileSource,
  } satisfies FeatureCreateInput
})

export class FeatureCreateWizard extends ServiceMap.Service<FeatureCreateWizard>()(
  "lalph/FeatureCreateWizard",
  {
    make: Effect.succeed({
      prompt: promptForFeatureCreate,
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)

  static layerTest(input: FeatureCreateInput) {
    return Layer.succeed(this, {
      prompt: () => Effect.succeed(input),
    })
  }

  static prompt() {
    return this.use((wizard) => wizard.prompt())
  }
}

export const createFeature = Effect.fnUntraced(function* () {
  const input = normalizeInput(yield* FeatureCreateWizard.prompt())
  const featureName = FeatureName.makeUnsafe(input.name)
  const existingFeature = yield* FeatureStore.load(featureName)

  if (Option.isSome(existingFeature)) {
    return yield* new FeatureAlreadyExists({ name: featureName })
  }

  yield* bootstrapSpecFile(input)

  const feature = new Feature({
    name: featureName,
    projectId: input.project.id,
    executionMode: input.executionMode,
    specFilePath: input.specFilePath,
    baseBranch: input.baseBranch,
    featureBranch: input.featureBranch,
    lifecycleStatus: "active",
  })

  yield* FeatureStore.create(feature)

  console.log(`Created feature: ${feature.name}`)
  console.log(`  Project: ${feature.projectId}`)
  console.log(`  Execution mode: ${feature.executionMode}`)
  console.log(`  Base branch: ${feature.baseBranch}`)
  console.log(`  Feature branch: ${feature.featureBranch}`)
  console.log(`  Spec file: ${feature.specFilePath}`)
  console.log(`  Lifecycle status: ${feature.lifecycleStatus}`)
})
