import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: false,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["tests/deca-transportista/integration.test.tsx"],
    setupFiles: ["tests/deca-transportista/integration.setup.ts"],
  },
});
