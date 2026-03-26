import { Schema } from "effect"
import { ProjectId } from "./Project.ts"

export const FeatureName = Schema.NonEmptyString.pipe(
  Schema.brand("lalph/FeatureName"),
)
export type FeatureName = typeof FeatureName.Type

export const FeatureExecutionMode = Schema.Literals(["pr", "ralph"])
export type FeatureExecutionMode = typeof FeatureExecutionMode.Type

export const FeatureLifecycleStatus = Schema.Literals([
  "draft",
  "active",
  "paused",
  "complete",
  "cancelled",
])
export type FeatureLifecycleStatus = typeof FeatureLifecycleStatus.Type

export class Feature extends Schema.Class<Feature>("lalph/Feature")({
  name: FeatureName,
  projectId: ProjectId,
  executionMode: FeatureExecutionMode,
  specFilePath: Schema.String,
  baseBranch: Schema.String,
  featureBranch: Schema.String,
  lifecycleStatus: FeatureLifecycleStatus,
  parentIssueSourceId: Schema.optional(Schema.String),
  finalIntegrationPrId: Schema.optional(Schema.String),
}) {
  static readonly FromJsonString = Schema.fromJsonString(
    Schema.toCodecJson(this),
  )
  static readonly decodeSync = Schema.decodeSync(this.FromJsonString)
  static readonly encodeSync = Schema.encodeSync(this.FromJsonString)

  update(updates: Partial<Feature>): Feature {
    return new Feature({
      ...this,
      ...updates,
    })
  }
}
