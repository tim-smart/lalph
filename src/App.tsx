import { createAtomValue } from "@effect/atom-solid"
import { allProjectsAtom } from "./Projects.js"
import { For, onMount } from "solid-js"
import { AsyncResult } from "effect/unstable/reactivity"
import { useRenderer } from "@opentui/solid"

export function App() {
  const renderer = useRenderer()
  const projects = createAtomValue(allProjectsAtom)
  onMount(() => {
    renderer
      .getPalette({
        size: 16,
      })
      .then(console.log)
  })

  return (
    <>
      {AsyncResult.builder(projects())
        .onInitial(() => <text>Loading projects...</text>)
        .onSuccess((projects) => (
          <For each={projects}>
            {(project) => (
              <box>
                <text style={{ fg: "blue" }}>{project.id}</text>
              </box>
            )}
          </For>
        ))
        .render()}
    </>
  )
}
