// mapsUrlService.ts

export const ALLOWED_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.google.es",
  "www.google.es",
  "google.es",
]);

export type DestinationResult =
  | { kind: "coordinates"; coordinates: [number, number]; raw: string }
  | { kind: "camera-only"; message: string }
  | { kind: "ambiguous"; message: string };

function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function isValidCoordinatePair(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

export function normalizePotentialUrl(input: string): string {
  const trimmed = input.trim();
  if (/^maps\.app\.goo\.gl\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function validateMapsUrl(urlStr: string): URL {
  const normalized = normalizePotentialUrl(urlStr);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("La URL proporcionada no tiene un formato válido.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Solo se admiten enlaces seguros de Google Maps con protocolo HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("La URL de Google Maps no puede incluir usuario ni contraseña.");
  }

  if (parsed.port && parsed.port !== "443") {
    throw new Error("Puerto no permitido en la URL de Google Maps.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_MAPS_HOSTS.has(host)) {
    throw new Error(
      `Dominio no permitido (${host}). Solo se admiten enlaces oficiales de Google Maps.`
    );
  }

  if (
    (host === "www.google.com" ||
      host === "google.com" ||
      host === "www.google.es" ||
      host === "google.es") &&
    parsed.pathname !== "/maps" &&
    !parsed.pathname.startsWith("/maps/")
  ) {
    throw new Error(
      "La URL debe pertenecer al servicio de Google Maps (ruta /maps)."
    );
  }

  if (host === "maps.app.goo.gl" && parsed.pathname.length <= 1) {
    throw new Error("El enlace corto no contiene un código de destino válido.");
  }

  return parsed;
}

export function isGoogleMapsUrl(input: string): boolean {
  try {
    validateMapsUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function isMapsShortUrl(urlStr: string): boolean {
  try {
    const parsed = validateMapsUrl(urlStr);
    return parsed.hostname.toLowerCase() === "maps.app.goo.gl";
  } catch {
    return false;
  }
}

export function extractDestinationFromMapsUrl(urlStr: string): DestinationResult {
  let parsed: URL;
  try {
    parsed = validateMapsUrl(urlStr);
  } catch (err) {
    return {
      kind: "ambiguous",
      message:
        err instanceof Error
          ? err.message
          : "URL de Google Maps no válida o no permitida.",
    };
  }

  const coordRegex = /^(?:loc:)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/;

  // 1. Revisar parámetros de consulta explícitos (q, query, daddr, destination)
  const queryCandidates = ["q", "query", "daddr", "destination"];
  const coordinateCandidates: Array<[number, number]> = [];
  for (const param of queryCandidates) {
    for (const value of parsed.searchParams.getAll(param)) {
      const val = value.trim();
      if (!val) continue;
      const match = val.match(coordRegex);
      if (match) {
        const lat = Number(match[1]);
        const lng = Number(match[2]);
        if (isValidCoordinatePair(lat, lng)) {
          coordinateCandidates.push([lat, lng]);
        }
      }
    }
  }

  // 2. Revisar ruta explícita /maps/place/lat,lng o /maps/search/lat,lng
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return {
      kind: "ambiguous",
      message: "La ruta del enlace contiene una codificación no válida.",
    };
  }

  const pathMatches = Array.from(
    decodedPath.matchAll(
      /\/maps\/(?:place|search)\/([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?=\/|$)/gi
    ),
  );
  for (const pathMatch of pathMatches) {
    const lat = Number(pathMatch[1]);
    const lng = Number(pathMatch[2]);
    if (isValidCoordinatePair(lat, lng)) {
      coordinateCandidates.push([lat, lng]);
    }
  }

  // 3. Revisar parámetros protobuf (!3dlat!4dlng) de chincheta
  const protoMatches = Array.from(
    parsed.pathname.matchAll(
      /!3d([+-]?(?:\d+(?:\.\d*)?|\.\d+))!4d([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
    ),
  );
  for (const protoMatch of protoMatches) {
    const lat = Number(protoMatch[1]);
    const lng = Number(protoMatch[2]);
    if (isValidCoordinatePair(lat, lng)) {
      coordinateCandidates.push([lat, lng]);
    }
  }

  const uniqueCandidates = coordinateCandidates.filter(
    ([lat, lng], index, candidates) =>
      candidates.findIndex(
        ([candidateLat, candidateLng]) =>
          candidateLat === lat && candidateLng === lng,
      ) === index,
  );
  if (uniqueCandidates.length === 1) {
    const [lat, lng] = uniqueCandidates[0];
    return {
      kind: "coordinates",
      coordinates: [lat, lng],
      raw: `${lat}, ${lng}`,
    };
  }
  if (uniqueCandidates.length > 1) {
    return {
      kind: "ambiguous",
      message:
        "El enlace contiene varios destinos posibles. Introduce una dirección o coordenadas.",
    };
  }

  // 4. Si solo contiene coordenadas de cámara (@lat,lng), rechazar explícitamente
  const cameraMatch = (parsed.pathname + parsed.search).match(
    /@([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/
  );
  if (cameraMatch) {
    return {
      kind: "camera-only",
      message:
        "La URL solo contiene coordenadas del centro de mapa / cámara (@lat,lng), no un punto de destino. Introduce una dirección o coordenadas directas.",
    };
  }

  // 5. Si contenía q o query pero no eran coordenadas (búsqueda de texto o nombre)
  const qVal = parsed.searchParams.get("q") || parsed.searchParams.get("query");
  if (qVal) {
    return {
      kind: "ambiguous",
      message:
        "El enlace apunta a una búsqueda o nombre de lugar sin coordenadas directas. Introduce una dirección o coordenadas.",
    };
  }

  return {
    kind: "ambiguous",
    message:
      "No se pudo extraer una ubicación inequívoca del enlace de Google Maps. Introduce una dirección o coordenadas.",
  };
}

export async function resolveMapsShortUrl(initialUrlStr: string): Promise<string> {
  const initialUrl = validateMapsUrl(initialUrlStr);
  let currentUrl = initialUrl.toString();
  const maxRedirects = 3;
  let redirects = 0;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    while (true) {
      // Si la URL actual ya es una URL completa de Maps y no es el acortador, podemos detener la resolución
      if (!isMapsShortUrl(currentUrl) && currentUrl !== initialUrl.toString()) {
        return currentUrl;
      }
      if (redirects >= maxRedirects) {
        throw new Error(
          "Se superó el número máximo de redirecciones permitidas (3)."
        );
      }

      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const locationHeader = res.headers.get("location");
        if (!locationHeader) {
          throw new Error("Redirección sin cabecera Location en Google Maps.");
        }

        // Resolver destinos relativos y validar estrictamente
        const nextUrlObj = new URL(locationHeader, currentUrl);
        const validatedNextUrl = validateMapsUrl(nextUrlObj.toString());

        currentUrl = validatedNextUrl.toString();
        redirects++;
        continue;
      }

      if (res.status >= 200 && res.status < 300) {
        return currentUrl;
      }

      throw new Error(
        `Google Maps respondió con un código HTTP inesperado (${res.status}).`
      );
    }

  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Tiempo de espera agotado al resolver el enlace (límite de 5 segundos)."
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleResolveMapsUrl(
  urlParam: string | null | undefined
): Promise<{
  status: number;
  data: { resolvedUrl?: string; error?: string };
}> {
  if (!urlParam || typeof urlParam !== "string" || !urlParam.trim()) {
    return {
      status: 400,
      data: { error: "Falta el parámetro 'url' en la petición." },
    };
  }

  try {
    const validated = validateMapsUrl(urlParam);
    const resolvedUrl = await resolveMapsShortUrl(validated.toString());
    return {
      status: 200,
      data: { resolvedUrl },
    };
  } catch (err: unknown) {
    return {
      status: 400,
      data: {
        error:
          err instanceof Error
            ? err.message
            : "No se pudo resolver el enlace de forma segura.",
      },
    };
  }
}

export async function resolveGoogleMapsUrl(urlStr: string): Promise<string> {
  const query = encodeURIComponent(urlStr.trim());
  let res: Response;
  try {
    res = await fetch(`/api/resolve-maps-url?url=${query}`);
  } catch {
    throw new Error("No se pudo conectar con el servicio para resolver el enlace.");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Respuesta no válida del servicio de resolución.");
  }

  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Error al resolver enlace (${res.status}).`;
    throw new Error(msg);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("resolvedUrl" in body) ||
    typeof body.resolvedUrl !== "string"
  ) {
    throw new Error("El servicio no devolvió una URL válida.");
  }

  return body.resolvedUrl;
}
