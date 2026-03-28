// geocodingService.ts

const GEOCODING_API_KEY = import.meta.env.VITE_GOOGLE_GEOCODING_KEY;

// Solo sesgo por país
const DEFAULT_REGION = "es";

if (!GEOCODING_API_KEY) {
  console.warn(
    "VITE_GOOGLE_GEOCODING_KEY no está definida. El geocoding puede fallar."
  );
}

export async function geocodeAddress(address: string) {
  if (!GEOCODING_API_KEY) {
    throw new Error(
      "Falta la clave de Google Geocoding (VITE_GOOGLE_GEOCODING_KEY)."
    );
  }

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