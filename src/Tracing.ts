import {
  Cause,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  LogLevel,
  Tracer,
} from "effect"
import { CurrentLoggers } from "effect/Logger"
import { MinimumLogLevel } from "effect/References"

export const TracingLayer = Layer.unwrap(
  Effect.gen(function* () {
    const logLevel = yield* MinimumLogLevel
    if (LogLevel.isLessThan("Trace", logLevel)) {
      return Layer.empty
    }
    return TracerLogger
  }),
)

const TracerLogger = Effect.gen(function* () {
  const loggers = yield* CurrentLoggers
  const tracer = yield* Tracer.Tracer
  const fiber = Fiber.getCurrent()!

  const log = (message: string, time: bigint) => {
    const date = new Date(Number(time / BigInt(1e6)))
    const options: Logger.Logger.Options<string> = {
      message,
      fiber,
      date,
      logLevel: "Trace",
      cause: Cause.empty,
    }
    loggers.forEach((logger) => {
      logger.log(options)
    })
  }

  return Tracer.make({
    span(options) {
      const span = tracer.span(options)
      log(`${options.name}: started`, options.startTime)
      const oldEnd = span.end
      span.end = (endTime, cause) => {
        const duration = Duration.nanos(endTime - span.status.startTime)
        log(
          `${options.name}: completed. Took ${Duration.format(duration)}`,
          endTime,
        )
        return oldEnd.call(span, endTime, cause)
      }
      return span
    },
  })
}).pipe(Layer.effect(Tracer.Tracer))
