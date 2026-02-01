import { Effect, FileSystem, Layer, Path } from "effect"
import { Argument, Command } from "effect/unstable/cli"
import { agentTasker } from "../../Agents/tasker.ts"
import { Prd } from "../../Prd.ts"
import { layerProjectIdPrompt } from "../../Projects.ts"
import { PromptGen } from "../../PromptGen.ts"
import { Settings } from "../../Settings.ts"
import { Worktree } from "../../Worktree.ts"
import { getCommandPrefix, getOrSelectCliAgent } from "../agent.ts"
import { commandRoot } from "../root.ts"

const specificationPath = Argument.path("spec", {
  pathType: "file",
  mustExist: true,
}).pipe(
  Argument.withDescription(
    "Path to the specification file to convert into tasks",
  ),
)

export const commandPlanTasks = Command.make("tasks", {
  specificationPath,
}).pipe(
  Command.withDescription("Convert a specification into tasks"),
  Command.withHandler(
    Effect.fnUntraced(
      function* ({ specificationPath }) {
        const { specsDirectory } = yield* commandRoot
        const fs = yield* FileSystem.FileSystem
        const pathService = yield* Path.Path
        const worktree = yield* Worktree
        const cliAgent = yield* getOrSelectCliAgent
        const commandPrefix = yield* getCommandPrefix

        const content = yield* fs.readFileString(specificationPath)
        const relative = pathService.relative(
          pathService.resolve("."),
          specificationPath,
        )
        const worktreeSpecPath = pathService.join(worktree.directory, relative)
        yield* fs.makeDirectory(pathService.dirname(worktreeSpecPath), {
          recursive: true,
        })
        yield* fs.writeFileString(worktreeSpecPath, content)

        yield* agentTasker({
          specsDirectory,
          specificationPath: relative,
          commandPrefix,
          cliAgent,
        })
      },
      Effect.provide([
        Settings.layer,
        PromptGen.layer,
        Prd.layerProvided.pipe(Layer.provide(layerProjectIdPrompt)),
        Worktree.layer,
      ]),
    ),
  ),
)
