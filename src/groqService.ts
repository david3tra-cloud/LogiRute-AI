// src/groqService.ts
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.warn('VITE_GROQ_API_KEY no está definida en las variables de entorno.');
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Helper genérico para llamar a Groq
async function callGroq(model: string, systemPrompt: string, userPrompt: string) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
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
  if (!content) throw new Error('Groq devolvió una respuesta vacía');
  return content as string;
}

// TIPOS INTERNOS
interface ParsedAddress {
  recipient: string;
  address: string;
  phone?: string;
  lat: number;
  lng: number;
  sourceUrl?: string;
}

// 1) Parsear texto del usuario a dirección + coords (tú decides el prompt)
export async function parseAddress(
  rawText: string,
  currentUserLoc?: { latitude: number; longitude: number },
  manualCoords?: string
): Promise<ParsedAddress> {
  const systemPrompt = `
Eres un asistente para un repartidor. A partir de un texto en español, 
extraes:
- nombre del destinatario (recipient)
- dirección (address)
- teléfono (phone) si aparece
- latitud y longitud aproximadas (lat, lng) en números
Responde SOLO en JSON con esta forma:
{"recipient":"","address":"","phone":"","lat":0,"lng":0}
`.trim();

  const userPrompt = `
Texto: "${rawText}"

Si el usuario te da coordenadas manuales ("38.269, -0.698") respétalas.
Si no puedes inferir lat/lng, inventa una aproximación razonable pero válida.
`.trim();

  const content = await callGroq(
    'llama-3.1-70b-versatile', // o el modelo de Groq que prefieras
    systemPrompt,
    userPrompt
  );

  try {
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    const jsonString = content.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonString);

    return {
      recipient: parsed.recipient || 'Cliente',
      address: parsed.address || rawText,
      phone: parsed.phone || '',
      lat: Number(parsed.lat) || (currentUserLoc?.latitude ?? 0),
      lng: Number(parsed.lng) || (currentUserLoc?.longitude ?? 0),
      sourceUrl: parsed.sourceUrl,
    };
  } catch (e) {
    console.error('Error parseando respuesta de Groq:', e, content);
    throw new Error('No se pudo interpretar la dirección con IA.');
  }
}

// 2) Optimizar ruta (devuelve ids ordenados)
export async function optimizeRoute(deliveries: { id: string; address: string }[]): Promise<string[]> {
  if (deliveries.length <= 1) return deliveries.map(d => d.id);

  const systemPrompt = `
Eres un optimizador de rutas para un repartidor.
Devuelves SOLO un array JSON de ids en el orden más eficiente.
Ejemplo: ["a1","c3","b2"]
`.trim();

  const list = deliveries
    .map((d, i) => `${i + 1}. id=${d.id} dirección="${d.address}"`)
    .join('\n');

  const userPrompt = `
Tengo estas paradas:
${list}

Devuélveme SOLO el array de ids en el mejor orden posible.
`.trim();

  const content = await callGroq(
    'llama-3.1-70b-versatile',
    systemPrompt,
    userPrompt
  );

  try {
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']');
    const jsonString = content.slice(jsonStart, jsonEnd + 1);
    const arr = JSON.parse(jsonString);
    if (!Array.isArray(arr)) throw new Error('La respuesta no es un array');
    return arr;
  } catch (e) {
    console.error('Error parseando orden de ruta Groq:', e, content);
    // fallback: deja el orden tal cual
    return deliveries.map(d => d.id);
  }
}
