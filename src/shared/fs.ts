import { Effect, FileSystem, Path, pipe, Stream } from "effect"

export const makeWaitForFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  return (directory: string, name: string) =>
    pipe(
      fs.watch(directory),
      Stream.filter(
        (e) => e._tag === "Create" && pathService.basename(e.path) === name,
      ),
      Stream.runHead,
    )
})
