import { isGoogleMapsUrl } from "./mapsUrlService";

const GEOCODING_API_KEY = import.meta.env.VITE_GOOGLE_GEOCODING_KEY;

// Solo sesgo por país
const DEFAULT_REGION = "es";

function isUrlFormattedInput(input: string): boolean {
  const trimmed = input.trim();
  return (
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
    /^www\./i.test(trimmed) ||
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?:[/:?#]|$)/i.test(
      trimmed,
    )
  );
}

if (!GEOCODING_API_KEY) {
  console.warn(
    "VITE_GOOGLE_GEOCODING_KEY no está definida. El geocoding puede fallar."
  );
}

// Intenta extraer coordenadas lat,lng de un string formato simple "lat,lng"
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const trimmed = input.trim();

  // Formato simple "lat,lng"
  const simpleMatch = trimmed.match(
    /^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/
  );
  if (simpleMatch) {
    const lat = parseFloat(simpleMatch[1]);
    const lng = parseFloat(simpleMatch[3]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

export async function geocodeAddress(address: string) {
  if (isGoogleMapsUrl(address) || isUrlFormattedInput(address)) {
    throw new Error(
      "No se pueden enviar URLs a geocodificar como dirección. Introduce una dirección de texto o un Plus Code; para enlaces de Maps, usa el campo de coordenadas o enlace de Maps."
    );
  }

  if (!GEOCODING_API_KEY) {
    throw new Error(
      "Falta la clave de Google Geocoding (VITE_GOOGLE_GEOCODING_KEY)."
    );
  }

  // 1) Si el usuario ha puesto coordenadas directas, las usamos y evitamos llamar a la API.
  const directCoords = parseLatLng(address);
  if (directCoords) {
    return directCoords;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${GEOCODING_API_KEY}&region=${DEFAULT_REGION}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("No se pudo conectar con Google Geocoding.");
  }

  if (!res.ok) {
    throw new Error(
      `Google Geocoding respondió con un error HTTP (${res.status}).`
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("Google Geocoding devolvió una respuesta no válida.");
  }

  if (!data || typeof data !== "object" || !("status" in data)) {
    throw new Error("Google Geocoding devolvió una respuesta no válida.");
  }

  const response = data as {
    status: unknown;
    results?: unknown;
  };
  if (response.status !== "OK") {
    if (response.status === "ZERO_RESULTS") {
      throw new Error("Google Geocoding no encontró esa dirección.");
    }
    const status =
      typeof response.status === "string" ? ` (${response.status})` : "";
    throw new Error(
      `Google Geocoding no pudo completar la búsqueda${status}.`
    );
  }

  if (!Array.isArray(response.results) || response.results.length === 0) {
    throw new Error("Google Geocoding no encontró una ubicación usable.");
  }

  const firstResult = response.results[0];
  if (
    !firstResult ||
    typeof firstResult !== "object" ||
    !("geometry" in firstResult)
  ) {
    throw new Error("Google Geocoding no encontró una ubicación usable.");
  }

  const geometry = firstResult.geometry;
  if (
    !geometry ||
    typeof geometry !== "object" ||
    !("location" in geometry)
  ) {
    throw new Error("Google Geocoding no encontró una ubicación usable.");
  }

  const loc = geometry.location;
  if (
    !loc ||
    typeof loc !== "object" ||
    !("lat" in loc) ||
    !("lng" in loc) ||
    typeof loc.lat !== "number" ||
    typeof loc.lng !== "number" ||
    !Number.isFinite(loc.lat) ||
    !Number.isFinite(loc.lng)
  ) {
    throw new Error("Google Geocoding no encontró una ubicación usable.");
  }

  return { lat: loc.lat, lng: loc.lng };
}