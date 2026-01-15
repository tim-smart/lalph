import { Schema, Data } from "effect"

export class PrdIssue extends Schema.Class<PrdIssue>("PrdIssue")({
  id: Schema.NullOr(Schema.String).annotate({
    description:
      "The unique identifier of the issue. If null, it is considered a new issue.",
  }),
  title: Schema.String.annotate({
    description: "The title of the issue",
  }),
  description: Schema.String.annotate({
    description: "The description of the issue in markdown format.",
  }),
  priority: Schema.Finite.annotate({
    description:
      "The priority of the issue. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.",
  }),
  estimate: Schema.NullOr(Schema.Finite).annotate({
    description:
      "The estimate of the issue in points. Null if no estimate is set. Roughly 1 point = 1 hour of work.",
  }),
  stateId: Schema.String.annotate({
    description: "The state ID of the issue.",
  }),
  blockedBy: Schema.Array(Schema.String).annotate({
    description:
      "An array of issue IDs that block this issue. These issues must be completed before this issue can be worked on.",
  }),
  complete: Schema.Boolean.annotate({
    description: "Whether the issue is complete.",
  }),
}) {
  static Array = Schema.Array(this)
  static ArrayFromJson = Schema.toCodecJson(this.Array)
  static arrayToJson(issues: ReadonlyArray<PrdIssue>): string {
    return JSON.stringify(
      Schema.encodeSync(this.ArrayFromJson)(issues),
      null,
      2,
    )
  }

  static jsonSchemaDoc = Schema.toJsonSchemaDocument(this)
  static jsonSchema = {
    ...this.jsonSchemaDoc.schema,
    $defs: this.jsonSchemaDoc.definitions,
  }

  isChangedComparedTo(issue: PrdIssue): boolean {
    return (
      this.title !== issue.title ||
      this.description !== issue.description ||
      this.stateId !== issue.stateId
    )
  }
}

export class PrdList<O = unknown> extends Data.Class<{
  readonly issues: ReadonlyMap<string, PrdIssue>
  readonly orignals: ReadonlyMap<string, O>
}> {
  static fromJson(json: string): ReadonlyArray<PrdIssue> {
    const issues = Schema.decodeSync(PrdIssue.ArrayFromJson)(JSON.parse(json))
    return issues
  }

  toJson(): string {
    const issuesArray = Array.from(this.issues.values())
    return PrdIssue.arrayToJson(issuesArray)
  }

  cast<T>(): PrdList<T> {
    return this as any
  }
}
