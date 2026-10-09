import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { handleResolveMapsUrl } from "./mapsUrlService";

const oauthPopupHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // usamos el manifest.webmanifest de /public
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        globIgnores: ["**/tesseract/**"],
      },
    }),
    {
      name: "resolve-maps-url-dev-middleware",
      configureServer(server) {
        server.middlewares.use("/api/resolve-maps-url", async (req, res) => {
          if (req.method !== "GET" && req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Método no permitido." }));
            return;
          }

          try {
            const reqUrl = new URL(req.url ?? "", "http://localhost");
            const targetUrl = reqUrl.searchParams.get("url");
            const result = await handleResolveMapsUrl(targetUrl);
            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.data));
          } catch (err: unknown) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  err instanceof Error
                    ? err.message
                    : "Error interno al resolver el enlace.",
              })
            );
          }
        });
      },
    },
  ],
  server: {
    port: 3000,
    headers: oauthPopupHeaders,
  },
  preview: {
    headers: oauthPopupHeaders,
  },
});
