import { Effect, FileSystem, Option, Path } from "effect"

const findProjectRoot = Effect.fnUntraced(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path

  let current = cwd
  while (true) {
    const inProjectRoot = yield* fs.exists(pathService.join(current, ".git"))
    if (inProjectRoot) {
      return Option.some(current)
    }

    const parent = pathService.dirname(current)
    if (parent === current) {
      return Option.none<string>()
    }
    current = parent
  }
})

export const resolveLalphDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const cwd = pathService.resolve(".")

  const inCwd = yield* fs.exists(pathService.join(cwd, ".lalph"))
  if (inCwd) {
    return cwd
  }

  const projectRoot = yield* findProjectRoot(cwd)
  if (Option.isSome(projectRoot)) {
    const inProjectRoot = yield* fs.exists(
      pathService.join(projectRoot.value, ".lalph"),
    )
    if (inProjectRoot) {
      return projectRoot.value
    }
  }

  return cwd
})
