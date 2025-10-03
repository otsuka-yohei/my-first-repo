import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
})
