import { AsyncResult, Atom } from "effect/unstable/reactivity"
import { createAtomValue } from "@effect/atom-solid"
import { Effect, Schedule, Stream } from "effect"

const count = Atom.make(Stream.fromSchedule(Schedule.spaced(1000)))

export function App() {
  const value = createAtomValue(count)

  return (
    <text>
      Hello, World!{" "}
      {AsyncResult.builder(value())
        .onSuccess((n) => n)
        .render()}
    </text>
  )
}
