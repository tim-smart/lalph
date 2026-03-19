import { Data } from "effect"
import type { PrdIssue } from "./PrdIssue.ts"

export type CurrentTask = Data.TaggedEnum<{
  task: {
    readonly task: PrdIssue
  }
  ralph: {
    readonly task: string
    readonly specFile: string
  }
}>

export const CurrentTask = Data.taggedEnum<CurrentTask>()
