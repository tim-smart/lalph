import { KeyValueStore } from "effect/unstable/persistence"

export const layerKvs = KeyValueStore.layerFileSystem(".lalph/config")
