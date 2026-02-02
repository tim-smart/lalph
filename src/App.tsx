import { createAtomValue } from "@effect/atom-solid"
import { allProjectsAtom } from "./Projects.ts"
import { For } from "solid-js"
import { AsyncResult } from "effect/unstable/reactivity"

export function App() {
  const projects = createAtomValue(allProjectsAtom)

  return (
    <>
      {AsyncResult.builder(projects())
        .onSuccess((projects) => (
          <For each={projects}>
            {(project) => (
              <box>
                <text>{project.id}</text>
              </box>
            )}
          </For>
        ))
        .render()}
    </>
  )
}
