import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@components/common/ui": fileURLToPath(
        new URL("./src/components/ui", import.meta.url)
      ),
      "@components": fileURLToPath(
        new URL("./src/components", import.meta.url)
      ),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@packages": fileURLToPath(new URL("../../packages", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
})
