import { defineConfig, mergeConfig } from "vite";
import viteConfig from "./vite.config";

for (const name of Object.keys(process.env)) {
  if (name.toUpperCase().startsWith("VITE_")) {
    delete process.env[name];
  }
}
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54329";
process.env.VITE_SUPABASE_ANON_KEY = "e2e-fake-key";

export default mergeConfig(
  viteConfig,
  defineConfig({
    envDir: false,
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    plugins: [
      {
        name: "block-maps-url-e2e",
        enforce: "pre",
        configureServer(server) {
          server.middlewares.use("/api/resolve-maps-url", (_req, res) => {
            res.statusCode = 403;
            res.end("Blocked in E2E");
          });
        },
      },
    ],
  }),
);
