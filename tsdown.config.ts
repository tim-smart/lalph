import { defineConfig } from "tsdown"
import solidPlugin from "rolldown-plugin-solid"

export default defineConfig({
  entry: ["src/cli.ts", "src/tui.tsx"],
  outDir: "dist",
  treeshake: true,
  inlineOnly: false,
  plugins: [solidPlugin()],
})
