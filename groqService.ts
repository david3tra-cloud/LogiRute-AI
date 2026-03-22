// groqService.ts
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface ParsedAddress {
  recipient: string;
  address: string;
  phone?: string;
  lat?: number | null;
  lng?: number | null;
  sourceUrl?: string;
}

async function callGroq(systemPrompt: string, userPrompt: string) {
  if (!GROQ_API_KEY) {
    throw new Error('VITE_GROQ_API_KEY no está definida');
  }

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq devolvió una respuesta vacía');
  }
  return content as string;
}

// intenta extraer coords de una cadena: "38.26,-0.70", "https://...@38.26,-0.70,..." etc.
function extractCoordsFromString(value: string): { lat?: number; lng?: number } {
  if (!value) return {};

  // 1) formato simple "lat,lng"
  const simpleMatch = value.match(
    /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/
  );
  if (simpleMatch) {
    const lat = parseFloat(simpleMatch[1]);
    const lng = parseFloat(simpleMatch[2]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
  }

  // 2) URLs de Google Maps con @lat,lng
  const atMatch = value.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
  }

  return {};
}

export async function parseAddress(
  rawText: string,
  currentUserLoc?: { latitude: number; longitude: number },
  manualCoords?: string
): Promise<ParsedAddress> {
  const systemPrompt = `
Eres un asistente para un repartidor. A partir de un texto en español, extraes:
- recipient (nombre de la persona o comercio)
- address (dirección completa en texto)
- phone (si aparece)
- lat (si en el texto hay coordenadas claras)
- lng (si en el texto hay coordenadas claras)
- sourceUrl (si en el texto hay un enlace de Google Maps)

Responde SOLO en JSON, sin texto adicional, por ejemplo:
{"recipient":"Cliente","address":"Calle Mayor 10, Elche","phone":"600000000","lat":38.26,"lng":-0.70,"sourceUrl":"https://maps.google.com/..."}
Si no estás seguro de lat/lng, pon null en esos campos.
`.trim();

  const userPromptParts = [`Texto: "${rawText}"`];
  if (manualCoords && manualCoords.trim()) {
    userPromptParts.push(`Datos adicionales del usuario (coords/plus code/enlace): "${manualCoords.trim()}"`);
  }

  const userPrompt = userPromptParts.join('\n');

  const content = await callGroq(systemPrompt, userPrompt);

  try {
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    const jsonString = content.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonString);

    let lat: number | null | undefined = parsed.lat;
    let lng: number | null | undefined = parsed.lng;

    // Si Groq no ha devuelto coords, intentamos sacarlas del campo manualCoords
    if ((lat == null || lng == null) && manualCoords) {
      const fromManual = extractCoordsFromString(manualCoords);
      if (fromManual.lat != null && fromManual.lng != null) {
        lat = fromManual.lat;
        lng = fromManual.lng;
      }
    }

    // No forzamos a currentUserLoc aquí; dejamos que geocoding se encargue si siguen siendo null
    return {
      recipient: parsed.recipient || 'Cliente',
      address: parsed.address || rawText,
      phone: parsed.phone || '',
      lat: lat != null ? Number(lat) : undefined,
      lng: lng != null ? Number(lng) : undefined,
      sourceUrl: parsed.sourceUrl || manualCoords,
    };
  } catch (e) {
    console.error('Error parseando respuesta de Groq:', e, content);
    throw new Error('No se pudo interpretar la dirección con IA.');
  }
}