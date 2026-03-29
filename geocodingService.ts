// geocodingService.ts

const GEOCODING_API_KEY = import.meta.env.VITE_GOOGLE_GEOCODING_KEY;

// Solo sesgo por país
const DEFAULT_REGION = "es";

if (!GEOCODING_API_KEY) {
  console.warn(
    "VITE_GOOGLE_GEOCODING_KEY no está definida. El geocoding puede fallar."
  );
}

// Intenta extraer coordenadas lat,lng de un string
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const trimmed = input.trim();

  // 1) Formato simple "lat,lng"
  const simpleMatch = trimmed.match(
    /^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/
  );
  if (simpleMatch) {
    const lat = parseFloat(simpleMatch[1]);
    const lng = parseFloat(simpleMatch[3]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng };
    }
  }

  // 2) Coordenadas dentro de una URL (ej: .../@38.2695,-0.6987,17z/...)
  const urlMatch = trimmed.match(
    /@(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)/ // @lat,lng
  );
  if (urlMatch) {
    const lat = parseFloat(urlMatch[1]);
    const lng = parseFloat(urlMatch[3]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

export async function geocodeAddress(address: string) {
  if (!GEOCODING_API_KEY) {
    throw new Error(
      "Falta la clave de Google Geocoding (VITE_GOOGLE_GEOCODING_KEY)."
    );
  }

  // 1) Si el usuario ha puesto coordenadas o una URL con coordenadas,
  // las usamos directamente y evitamos llamar a la API.
  const directCoords = parseLatLng(address);
  if (directCoords) {
    return directCoords;
  }

  // 2) Si es un enlace de Maps sin coordenadas claras (Plus Code, etc.),
  // usamos el texto completo como address para Geocoding.
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${GEOCODING_API_KEY}&region=${DEFAULT_REGION}`;

  console.log("GEOCODING URL:", url);
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error al llamar a Geocoding: ${res.status} - ${txt}`);
  }

  const data = await res.json();

  if (data.status !== "OK" || !data.results.length) {
    throw new Error("No se ha podido encontrar esa dirección");
  }

  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}