import { DateTime, Duration, Effect, flow, Schema, Stream } from "effect"
import { RunnerStalled } from "../domain/Errors.ts"

export const streamFilterJson = <S extends Schema.Top>(schema: S) => {
  const fromString = Schema.fromJsonString(schema)
  const decode = Schema.decodeEffect(fromString)
  return flow(
    Stream.splitLines,
    Stream.filterMapEffect((line) => decode(line).pipe(Effect.result)),
  )
}

export const withStallTimeout = (timeout: Duration.Input) => {
  const duration = Duration.fromInputUnsafe(timeout)
  return <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    Stream.suspend(() => {
      let lastOutputAt = DateTime.nowUnsafe()
      const stallTimeout = Effect.suspend(function loop(): Effect.Effect<
        never,
        RunnerStalled
      > {
        const now = DateTime.nowUnsafe()
        const deadline = DateTime.addDuration(lastOutputAt, duration)
        if (DateTime.isLessThan(deadline, now)) {
          return Effect.fail(new RunnerStalled())
        }
        const timeUntilDeadline = DateTime.distance(deadline, now)
        return Effect.flatMap(Effect.sleep(timeUntilDeadline), loop)
      })
      return stream.pipe(
        Stream.tap(() => {
          lastOutputAt = DateTime.nowUnsafe()
          return Effect.void
        }),
        Stream.mergeLeft(Stream.fromEffectDrain(stallTimeout)),
      )
    })
}
