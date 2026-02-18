
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
  const combined = `${normalizedName} ${normalizedAddr}`;

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
 */
const extractCoords = (text: string) => {
  if (!text) return null;
  
  // Normalizar comas decimales: "38,2805" -> "38.2805"
  let normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2');

  const coordPattern = /([-+]?\d+\.?\d*)\s*[,; \t]\s*([-+]?\d+\.?\d*)/;
  const match = normalized.match(coordPattern);
  
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    
    if (!isNaN(lat) && !isNaN(lng) && 
        lat >= -90 && lat <= 90 && 
        lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  const urlPatterns = [
    /@(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/,
    /query=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/,
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/
  ];
  
  for (const pattern of urlPatterns) {
    const urlMatch = normalized.match(pattern);
    if (urlMatch) {
      const lat = parseFloat(urlMatch[1]);
      const lng = parseFloat(urlMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
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
 * Busca un sitio usando Gemini 2.5 con Maps Grounding afinado.
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

  // 3. Plus Code Check (If it's a raw plus code, we might still need grounding to get the full address/name)
  // However, if we reach here, we likely need the API to resolve the business name/address.

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const anchor = userLocation || { latitude: 38.2622, longitude: -0.6993 };

  const result = await withRetry(async () => {
    const prompt = `
      ESTO ES UNA OPERACIÓN DE REPARTO LOGÍSTICO CRÍTICA.
      Consulta: "${rawManual || rawInput}".
      Ubicación de referencia: Lat: ${anchor.latitude}, Lng: ${anchor.longitude}.

      OBJETIVO: Identificar el local comercial o industrial exacto.
      
      REGLAS:
      1. MAPEO DE MARCAS: Si el usuario busca una marca (ej: "Paredes", "Pacal Shoes"), busca la TIENDA u OUTLET oficial más relevante en el área local.
      2. RESOLUCIÓN DE ALIAS: Busca el nombre comercial real según Google Maps.
      3. FORMATO: 
         Línea 1: NOMBRE OFICIAL.
         Línea 2: DIRECCIÓN POSTAL COMPLETA.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: { latitude: anchor.latitude, longitude: anchor.longitude }
          }
        },
      },
    });

    const text = response.text || "";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    let lat: number | null = null;
    let lng: number | null = null;
    let title = "";
    let url = "";

    if (chunks && chunks.length > 0) {
      const searchWords = rawInput.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      for (const c of chunks) {
        if (c.maps?.uri) {
          const cData = extractCoords(c.maps.uri);
          if (cData) {
            const currentTitle = (c.maps.title || "").toLowerCase();
            const score = searchWords.reduce((acc, word) => acc + (currentTitle.includes(word) ? 1 : 0), 0);
            if (!lat || score > 0) {
              lat = cData.lat;
              lng = cData.lng;
              url = c.maps.uri;
              title = c.maps.title || title;
              if (score >= searchWords.length && score > 0) break;
            }
          }
        }
      }
    }

    if (!lat || !lng) {
      const fallback = extractCoords(text);
      if (fallback) { lat = fallback.lat; lng = fallback.lng; }
    }

    if (!lat || !lng) {
      throw new Error(`No se encontró "${rawInput}". Intenta ser más específico.`);
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    return {
      recipient: title || lines[0] || rawInput,
      address: lines[1] || lines[0] || rawInput,
      lat,
      lng,
      sourceUrl: url || `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
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

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const result = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Ordena estos IDs para la ruta más corta empezando en ${start}: ${JSON.stringify(deliveries.map(d => ({id: d.id, a: d.address})))}. Responde solo JSON: {"order": ["id1", "id2", ...]}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { order: { type: Type.ARRAY, items: { type: Type.STRING } } },
          required: ["order"]
        }
      }
    });
    return JSON.parse(response.text).order as string[];
  }, onRetry);

  lastRouteHash = routeHash;
  addressCache['last_route_order'] = result;
  return result;
};
