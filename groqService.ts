// groqService.ts
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface ParsedAddress {
  recipient: string;
  address: string;
  phone?: string;
  lat: number;
  lng: number;
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
      model: 'llama-3.1-70b-versatile',
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

export async function parseAddress(
  rawText: string,
  currentUserLoc?: { latitude: number; longitude: number },
  manualCoords?: string
): Promise<ParsedAddress> {
  const systemPrompt = `
Eres un asistente para un repartidor. A partir de un texto en español,
extraes:
- recipient
- address
- phone
- lat
- lng
Responde SOLO en JSON: {"recipient":"","address":"","phone":"","lat":0,"lng":0}
`.trim();

  const userPrompt = `Texto: "${rawText}"`;

  const content = await callGroq(systemPrompt, userPrompt);

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
