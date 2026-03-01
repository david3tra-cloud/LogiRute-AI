import { GoogleGenAI, Type } from "@google/genai";
import { Delivery } from "../types";

// Persistent cache in localStorage to avoid re-searching the same locations across sessions
const CACHE_STORAGE_KEY = 'logiroute_address_cache_v1';
const getInitialCache = (): Record<string, any> => {
  try {
    const saved = localStorage.getItem(CACHE_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
};

let addressCache: Record<string, any> = getInitialCache();

const saveCache = () => {
  try {
    // Keep cache size reasonable (max 100 entries)
    const keys = Object.keys(addressCache);
    if (keys.length > 100) {
      delete addressCache[keys[0]];
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(addressCache));
  } catch (e) {
    console.warn("Failed to save address cache", e);
  }
};

// Sinónimos y palabras clave por tipo de negocio
const BUSINESS_SYNONYMS: Record<string, string[]> = {
  'zapato': ['zapatería', 'tienda zapatos', 'calzado', 'shoes store'],
  'farmacia': ['pharmacy', 'medicinas', 'recetas'],
  'pizza': ['pizzería', 'pizza store'],
  'café': ['coffee', 'cafetería', 'bar café'],
};

function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function expandSearchTerms(name: string, address: string = ''): string[] {
  const normalizedName = normalizeText(name);
  const normalizedAddr = normalizeText(address);
  const combined = `${normalizedName}${normalizedAddr ? ' ' + normalizedAddr : ''}`.trim();

  let expanded = [combined];

  // Detecta palabras clave y expande
  for (const [keyword, synonyms] of Object.entries(BUSINESS_SYNONYMS)) {
    if (combined.includes(keyword)) {
      synonyms.forEach(syn => {
        expanded.push(`${normalizedName} ${syn} ${normalizedAddr}`.trim());
      });
      break;
    }
  }

  return expanded.filter(q => q.length > 0);
}

export const buildSearchQuery = (name: string, address: string = ''): string[] => {
  return expandSearchTerms(name, address);
};

/**
 * Espera un tiempo determinado para reintentos.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Envoltorio con reintentos para manejar errores de cuota (429).
 */
async function withRetry<T>(
  fn: () => Promise<T>, 
  onRetry?: (msg: string) => void,
  maxRetries = 3
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error?.message?.includes("429") || error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");
      
      if (isQuotaError && i < maxRetries - 1) {
        const waitTime = Math.pow(2, i) * 2000;
        if (onRetry) onRetry(`Límite (429). Reintentando en ${waitTime/1000}s...`);
        await sleep(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Extrae coordenadas de cualquier texto, URL o formato lat,lng.
 * Devuelve siempre { lat, lng } con lat en [-90,90] y lng en [-180,180].
 */
const extractCoords = (text: string) => {
  if (!text) return null;
  
  // Normalizar comas decimales y limpiar texto
  let normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2');

  // 1. Patrón específico COORDENADAS: lat, lng
  const coordsPrefixPattern = /COORDENADAS[:\s]*([-+]?\d+\.?\d*)\s*[,; \t]\s*([-+]?\d+\.?\d*)/i;
  const prefixMatch = normalized.match(coordsPrefixPattern);
  if (prefixMatch) {
    const lat = parseFloat(prefixMatch[1]);
    const lng = parseFloat(prefixMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  // 2. Patrones URL de Google Maps
  const urlPatterns = [
    /@(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/,
    /query=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/,
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
    /place\/([-+]?\d+\.?\d*)\+([-+]?\d+\.?\d*)/,
    /ll=([-+]?\d+\.?\d*),([-+]?\d+\.?\d*)/
  ];
  
  for (const pattern of urlPatterns) {
    const urlMatch = normalized.match(pattern);
    if (urlMatch) {
      const lat = parseFloat(urlMatch[1]);
      const lng = parseFloat(urlMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }

  // 3. Patrones tipo lat: xx, lng: yy
  const latPattern = /lat(?:itud)?[:\s]*([-+]?\d+\.?\d*)/i;
  const lngPattern = /l(?:ng|on|ongitud)?[:\s]*([-+]?\d+\.?\d*)/i;
  
  const latMatch = normalized.match(latPattern);
  const lngMatch = normalized.match(lngPattern);

  if (latMatch && lngMatch) {
    const lat = parseFloat(latMatch[1]);
    const lng = parseFloat(lngMatch[1]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  // 4. Patrón simple lat,lng restringido a España
  const simplePattern = /([-+]?\d+\.?\d*)\s*[,; \t]\s*([-+]?\d+\.?\d*)/;
  const match = normalized.match(simplePattern);
  
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const isSpain = lat > 35 && lat < 44 && lng > -10 && lng < 5;
    if (!isNaN(lat) && !isNaN(lng) && isSpain) {
      return { lat, lng };
    }
  }
  
  return null;
};

const isPlusCode = (text: string) => {
  return /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,}/.test(text.trim().toUpperCase());
};

const isUrl = (text: string) => {
  return /^https?:\/\//i.test(text.trim());
};

/**
 * Busca un sitio usando Gemini con grounding en Maps.
 * Devuelve siempre lat y lng como números válidos.
 */
export const parseAddress = async (
  input: string,
  userLocation?: { latitude: number; longitude: number },
  manualCoords?: string,
  onRetry?: (msg: string) => void
): Promise<{
  recipient: string;
  address: string;
  lat: number;
  lng: number;
  sourceUrl: string;
  phone?: string;
}> => {
  const rawInput = input.trim();
  const rawManual = manualCoords?.trim() || "";
  const cacheKey = `${rawInput}|${rawManual}`.toLowerCase();
  
  // 1. Check persistent cache first
  if (addressCache[cacheKey]) {
    return addressCache[cacheKey];
  }

  // 2. Local check for coordinates (No API call needed)
  const directCoords = extractCoords(rawManual || rawInput);
  if (directCoords && !isPlusCode(rawManual || rawInput)) {
    const isCoordinateOnly = !rawInput || extractCoords(rawInput);
    const result = {
      recipient: isCoordinateOnly ? "Punto GPS" : rawInput,
      address: isCoordinateOnly ? `Ubicación: ${directCoords.lat}, ${directCoords.lng}` : rawInput,
      lat: directCoords.lat,
      lng: directCoords.lng,
      sourceUrl: isUrl(rawManual) ? rawManual : `https://www.google.com/maps/dir/?api=1&destination=${directCoords.lat},${directCoords.lng}`
    };
    addressCache[cacheKey] = result;
    saveCache();
    return result;
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.length < 10) {
    throw new Error("Error de Configuración: La clave de API no es válida o está vacía. Por favor, usa el botón 'REPARAR APP' en el panel de CONTROL.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const anchor = userLocation || { latitude: 38.2622, longitude: -0.6993 };

  const result = await withRetry(async () => {
    const prompt = `
      LOCALIZA EL PUNTO EXACTO EN GOOGLE MAPS PARA: "${rawManual || rawInput}".
      IMPORTANTE: Si es una empresa, busca su ubicación ACTUAL (2024-2025). No uses direcciones antiguas si se ha mudado.
      
      RESPONDE CON ESTE FORMATO:
      NOMBRE: [Nombre oficial]
      DIRECCION: [Dirección completa]
      COORDENADAS: [latitud], [longitud]
      URL: [Enlace de Google Maps]
    `;

    let response: any;
    try {
      // Usamos gemini-2.5-flash con googleMaps para máxima precisión en lugares
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleMaps: {} }, { googleSearch: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: anchor.latitude,
                longitude: anchor.longitude
              }
            }
          },
          temperature: 0.1
        },
      });
    } catch (e: any) {
      console.warn("Error con Google Maps tool, usando fallback search:", e);
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0,
          },
        });
      } catch (fallbackErr) {
        console.warn("Error en búsqueda principal:", fallbackErr);
        // Fallback simplificado si falla todo lo anterior
        response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [{
            role: "user",
            parts: [{
              text: `Localiza las coordenadas GPS y dirección de: "${rawManual || rawInput}" en Elche.
Responde solo JSON con este esquema:
{"lat": 0, "lng": 0, "address": "", "recipient": ""}`
            }]
          }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                address: { type: Type.STRING },
                recipient: { type: Type.STRING }
              },
              required: ["lat", "lng", "address", "recipient"]
            }
          }
        });
        const data = JSON.parse(response.text);
        if (data.lat === undefined || data.lng === undefined || isNaN(data.lat) || isNaN(data.lng)) {
          throw new Error("No se encontraron coordenadas válidas.");
        }
        
        return {
          recipient: data.recipient || rawInput,
          address: data.address || rawInput,
          lat: data.lat,
          lng: data.lng,
          sourceUrl: `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}`
        };
      }
    }

    const text: string = response.text || "";
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const chunks = groundingMetadata?.groundingChunks as any[] | undefined;
    
    let lat: number | null = null;
    let lng: number | null = null;
    let title = "";
    let url = "";

    // 1. Intentar extraer de los metadatos de búsqueda (Grounding)
    if (chunks && chunks.length > 0) {
      for (const c of chunks) {
        if (c.web?.uri) {
          const cData = extractCoords(c.web.uri);
          if (cData) {
            lat = cData.lat;
            lng = cData.lng;
            url = c.web.uri;
            title = c.web.title || title;
            break; 
          }
        }
      }
    }

    // 2. Si no hay en metadatos, extraer del texto de la respuesta
    if (lat === null || lng === null) {
      const coordsFromText = extractCoords(text);
      if (coordsFromText) {
        lat = coordsFromText.lat;
        lng = coordsFromText.lng;
      }
    }

    // 3. Extraer URL del texto si no la tenemos
    if (!url) {
      const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.app\.goo\.gl)\/[^\s]+/i);
      if (urlMatch) url = urlMatch[0];
    }

    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
      throw new Error(`No se pudo localizar con precisión "${rawInput}". Por favor, introduce una dirección más específica o coordenadas.`);
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const cleanLine = (line: string, prefix: string) => line.replace(new RegExp(`^${prefix}:?\\s*`, 'i'), '').trim();
    
    let finalRecipient = rawInput;
    let finalAddress = rawInput;

    lines.forEach(line => {
      if (line.toUpperCase().startsWith('NOMBRE')) finalRecipient = cleanLine(line, 'NOMBRE');
      if (line.toUpperCase().startsWith('DIRECCION')) finalAddress = cleanLine(line, 'DIRECCION');
    });

    return {
      recipient: title || finalRecipient,
      address: finalAddress,
      lat,
      lng,
      sourceUrl: url || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      phone: text.match(/(?:\+34|34)?[6789]\d{8}/)?.[0]
    };
  }, onRetry);

  addressCache[cacheKey] = result;
  saveCache();
  return result;
};

// Simple route hash to avoid re-optimizing the exact same list
let lastRouteHash = "";

export const optimizeRoute = async (deliveries: Delivery[], start: string, onRetry?: (msg: string) => void) => {
  const routeHash = JSON.stringify(deliveries.map(d => d.id).sort()) + start;
  if (routeHash === lastRouteHash && addressCache['last_route_order']) {
    return addressCache['last_route_order'];
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.length < 10) {
    throw new Error("Error de Configuración: La clave de API no es válida o está vacía.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const result = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{
        role: "user",
        parts: [{
          text: `Ordena estos IDs para la ruta más corta empezando en ${start}: ${JSON.stringify(
            deliveries.map(d => ({ id: d.id, a: d.address }))
          )}.
Responde solo JSON: {"order": ["id1", "id2", ...]}`
        }]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { 
            order: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            } 
          },
          required: ["order"]
        }
      }
    });
    const data = JSON.parse(response.text);
    return data.order as string[];
  }, onRetry);

  lastRouteHash = routeHash;
  addressCache['last_route_order'] = result;
  return result;
};
