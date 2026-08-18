import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const src = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  // tsconfig paths 와 같은 alias. 안 맞추면 alias 를 쓰는 모듈은 테스트에서 해석되지 않는다.
  resolve: {
    alias: {
      "@lib": `${src}/lib`,
      "@components": `${src}/components`,
      "@hooks": `${src}/hooks`,
      domains: `${src}/domains`,
      "@": src,
    },
  },
})
