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
    include: [
      "tests/deca-transportista/integration.test.tsx",
      "tests/deca-bulk-add-to-routes.test.ts",
      "tests/deca-bulk-add-to-routes.react.test.tsx",
      "tests/deca-identities-*.test.ts",
      "tests/deca-identities-*.test.tsx",
    ],
    setupFiles: ["tests/deca-transportista/integration.setup.ts"],
  },
});
