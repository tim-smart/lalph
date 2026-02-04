import { Data } from "effect"
import type { PrdIssue } from "./PrdIssue.ts"

export class RunnerStalled extends Data.TaggedError("RunnerStalled") {
  readonly message = "The runner has stalled due to inactivity."
}

export class TaskStateChanged extends Data.TaggedError("TaskStateChanged")<{
  readonly issueId: string
  readonly state: PrdIssue["state"] | "missing"
}> {
  readonly message = `Task "${this.issueId}" moved to "${this.state}", cancelling run.`
}
