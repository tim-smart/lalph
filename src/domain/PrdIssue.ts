import { Schema, Array, Equal, SchemaGetter } from "effect"
import * as Yaml from "yaml"
import { withEncodeDefault } from "../shared/schema.ts"

export class PrdIssue extends Schema.Class<PrdIssue>("PrdIssue")({
  id: Schema.NullOr(Schema.String)
    .annotate({
      description:
        "The unique identifier of the issue. If null, it is considered a new issue.",
      documentation: "The unique identifier of the issue.",
    })
    .pipe(withEncodeDefault(() => null)),
  title: Schema.String.annotate({
    description: "The title of the issue",
  }),
  description: Schema.String.annotate({
    description: "The description of the issue in markdown format.",
  }).pipe(withEncodeDefault(() => "")),
  priority: Schema.Finite.annotate({
    description:
      "The priority of the issue. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.",
    documentation:
      "The priority of the issue. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.",
  }).pipe(withEncodeDefault(() => 3)),
  estimate: Schema.NullOr(Schema.Finite)
    .annotate({
      description:
        "The estimate of the issue in points. Null if no estimate is set. Roughly 1 point = 1 hour of work.",
      documentation:
        "Null if no estimate is set. Roughly 1 point = 1 hour of work.",
    })
    .pipe(withEncodeDefault(() => null)),
  state: Schema.Literals([
    "backlog",
    "todo",
    "in-progress",
    "in-review",
    "done",
  ])
    .annotate({
      description: "The state of the issue.",
      documentation: "The state of the issue.",
    })
    .pipe(withEncodeDefault(() => "todo")),
  blockedBy: Schema.Array(Schema.String)
    .annotate({
      description:
        "An array of issue IDs that block this issue. These issues must be completed before this issue can be worked on.",
      documentation: "An array of issue IDs that block this issue.",
    })
    .pipe(withEncodeDefault(() => [])),
  autoMerge: Schema.Boolean.annotate({
    description:
      "Whether the issue should be auto-merged when complete. Read-only field",
  }).pipe(withEncodeDefault(() => false)),
}) {
  static FromInput = Schema.Union([
    Schema.String,
    Schema.toEncoded(PrdIssue),
  ]).pipe(
    Schema.decodeTo(PrdIssue, {
      decode: SchemaGetter.transform((s) =>
        typeof s === "string" ? { title: s } : s,
      ),
      encode: SchemaGetter.passthrough(),
    }),
  )

  static Array = Schema.Array(this)
  static ArrayFromInput = Schema.Array(this.FromInput)
  static ArrayFromJson = Schema.toCodecJson(this.Array)
  static ArrayFromJsonInput = Schema.toCodecJson(this.ArrayFromInput)
  static arrayToYaml(issues: ReadonlyArray<PrdIssue>): string {
    const json = Schema.encodeSync(this.ArrayFromJson)(issues)
    return Yaml.stringify(json, { blockQuote: "literal" })
  }
  static arrayFromYaml(yaml: string): ReadonlyArray<PrdIssue> {
    const json = Yaml.parse(yaml)
    const issues = Schema.decodeSync(PrdIssue.ArrayFromJsonInput)(json)
    return issues
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
      this.state !== issue.state ||
      this.autoMerge !== issue.autoMerge ||
      !Array.makeEquivalence(Equal.asEquivalence())(
        this.blockedBy,
        issue.blockedBy,
      )
    )
  }

  withAutoMerge(autoMerge: boolean): PrdIssue {
    return new PrdIssue({
      ...this,
      autoMerge,
    })
  }
}
