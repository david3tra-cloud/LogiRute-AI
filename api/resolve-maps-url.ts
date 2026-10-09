import type { IncomingMessage, ServerResponse } from "node:http";
import { handleResolveMapsUrl } from "../mapsUrlService.js";

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[]> },
  res: ServerResponse
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Método no permitido." }));
    return;
  }

  try {
    let targetUrl: string | undefined;

    if (req.query && typeof req.query.url === "string") {
      targetUrl = req.query.url;
    } else {
      const parsedUrl = new URL(req.url ?? "", "http://localhost");
      targetUrl = parsedUrl.searchParams.get("url") ?? undefined;
    }

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
}
