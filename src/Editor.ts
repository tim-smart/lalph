import { Cause, Effect, FileSystem, Layer, ServiceMap } from "effect"
import { configEditor } from "./shared/config.ts"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { PlatformServices } from "./shared/platform.ts"

export class Editor extends ServiceMap.Service<Editor>()("lalph/Editor", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const editor = yield* configEditor
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const edit = (path: string) =>
      ChildProcess.make(editor[0]!, [...editor.slice(1), path], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).pipe(
        spawner.exitCode,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.orDie,
      )

    const editTemp = Effect.fnUntraced(
      function* (options: {
        readonly initialContent?: string
        readonly suffix?: string
      }) {
        const initialContent = options.initialContent ?? ""
        const file = yield* fs.makeTempFileScoped({
          suffix: options.suffix ?? ".txt",
        })

        const run = Effect.gen(function* () {
          if (initialContent) {
            yield* fs.writeFileString(file, initialContent)
          }

          const exitCode = yield* ChildProcess.make(
            editor[0]!,
            [...editor.slice(1), file],
            {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
            },
          ).pipe(spawner.exitCode)

          if (exitCode !== 0) {
            return yield* new Cause.NoSuchElementError()
          }
          const content = (yield* fs.readFileString(file)).trim()
          if (content === initialContent) {
            return yield* new Cause.NoSuchElementError()
          }
          return content
        }).pipe(
          Effect.tapCause((cause) =>
            Effect.gen(function* () {
              const failReason = cause.reasons.find(Cause.isFailReason)
              if (failReason && Cause.isNoSuchElementError(failReason.error)) {
                return
              }
              const content = yield* fs.readFileString(file).pipe(
                Effect.map((content) => content.trim()),
                Effect.catch(() => Effect.succeed("")),
              )
              if (content === "") {
                return
              }
              const saved = yield* saveTempFile({
                content,
                ...(options.suffix ? { suffix: options.suffix } : {}),
              })
              console.log(
                `Failed to save editor contents. Draft saved to temporary file: ${saved}`,
              )
            }),
          ),
        )

        return yield* run
      },
      Effect.scoped,
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.option,
    )

    const saveTempFile = Effect.fnUntraced(function* (options: {
      readonly content: string
      readonly suffix?: string
    }) {
      const file = yield* fs.makeTempFile({
        suffix: options.suffix ?? ".txt",
      })
      yield* fs.writeFileString(file, options.content)
      return file
    })

    return { edit, editTemp, saveTempFile } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(PlatformServices),
  )
}
