import { GoogleGenerativeAI } from "@google/generative-ai";
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
    const keys = Object.keys(addressCache);
    if (keys.length > 100) {
      delete addressCache[keys[0]];
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(addressCache));
  } catch (e) {
    console.warn("Failed to save address cache", e);
  }
};

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

const extractCoords = (text: string) => {
  if (!text) return null;
  let normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2');
  const coordPattern = /([-+]?\d+\.?\d*)\s*[,; \t]\s*([-+]?\d+\.?\d*)/;
  const match = normalized.match(coordPattern);
  
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
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

const isPlusCode = (text: string) => /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,}/.test(text.trim().toUpperCase());
const isUrl = (text: string) => /^https?:\/\//i.test(text.trim());

/**
 * Busca un sitio usando Gemini 1.5 Flash con Grounding.
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
  
  if (addressCache[cacheKey]) return addressCache[cacheKey];

  const directCoords = extractCoords(rawManual || rawInput);
  if (directCoords && !isPlusCode(rawManual || rawInput)) {
    const isCoordinateOnly = !rawInput || extractCoords(rawInput);
    const result = {
      recipient: isCoordinateOnly ? "Punto GPS" : rawInput,
      address: isCoordinateOnly ? `Ubicación: ${directCoords.lat}, ${directCoords.lng}` : rawInput,
      lat: directCoords.lat,
      lng: directCoords.lng,
      sourceUrl: isUrl(rawManual) ? rawManual : `https://www.google.com/maps?q=${directCoords.lat},${directCoords.lng}`
    };
    addressCache[cacheKey] = result;
    saveCache();
    return result;
  }

  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
  // Elche por defecto como tenías
  const anchor = userLocation || { latitude: 38.2622, longitude: -0.6993 };

  const result = await withRetry(async () => {
    // Usamos gemini-1.5-flash que es el modelo actual con soporte estable
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        tools: [{ googleSearchRetrieval: {} }] as any 
    });

    const prompt = `
      ESTO ES UNA OPERACIÓN DE REPARTO LOGÍSTICO CRÍTICA.
      Consulta: "${rawManual || rawInput}".
      Ubicación de referencia: Lat: ${anchor.latitude}, Lng: ${anchor.longitude}.
      OBJETIVO: Identificar el local comercial o industrial exacto.
      REGLAS:
      1. MAPEO DE MARCAS: Si el usuario busca una marca (ej: "Paredes"), busca la TIENDA oficial local.
      2. RESOLUCIÓN DE ALIAS: Busca el nombre comercial real según Google Maps.
      3. FORMATO: 
         Línea 1: NOMBRE OFICIAL.
         Línea 2: DIRECCIÓN POSTAL COMPLETA.
    `;

    const response = await model.generateContent(prompt);
    const text = response.response.text() || "";
    const metadata = response.response.candidates?.[0]?.groundingMetadata;
    const chunks = metadata?.groundingChunks;
    
    let lat: number | null = null;
    let lng: number | null = null;
    let title = "";
    let url = "";

    if (chunks && chunks.length > 0) {
      const searchWords = rawInput.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      for (const c of chunks) {
        if (c.googleSearchRetrieval?.source?.url || c.web?.uri) {
           const uri = c.googleSearchRetrieval?.source?.url || c.web?.uri;
           const cData = extractCoords(uri);
           if (cData) {
             const currentTitle = (c.web?.title || "").toLowerCase();
             const score = searchWords.reduce((acc, word) => acc + (currentTitle.includes(word) ? 1 : 0), 0);
             if (!lat || score > 0) {
               lat = cData.lat;
               lng = cData.lng;
               url = uri;
               title = c.web?.title || title;
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
      return {
        recipient: rawInput || "Destino sin coordenadas",
        address: rawInput || "Sin dirección precisa",
        lat: anchor.latitude,
        lng: anchor.longitude,
        sourceUrl: `https://www.google.com/maps?q=${encodeURIComponent(rawInput || "destino")}`,
        phone: undefined
      };
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    return {
      recipient: title || lines[0] || rawInput,
      address: lines[1] || lines[0] || rawInput,
      lat,
      lng,
      sourceUrl: url || `https://www.google.com/maps?q=${lat},${lng}`,
      phone: text.match(/(?:\+34|34)?[6789]\d{8}/)?.[0]
    };
  }, onRetry);

  addressCache[cacheKey] = result;
  saveCache();
  return result;
};

let lastRouteHash = "";

export const optimizeRoute = async (deliveries: Delivery[], start: string, onRetry?: (msg: string) => void) => {
  const routeHash = JSON.stringify(deliveries.map(d => d.id).sort()) + start;
  if (routeHash === lastRouteHash && addressCache['last_route_order']) {
    return addressCache['last_route_order'];
  }

  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
  const result = await withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `Ordena estos IDs para la ruta más corta empezando en ${start}: ${JSON.stringify(deliveries.map(d => ({id: d.id, a: d.address})))}. Responde solo JSON: {"order": ["id1", "id2", ...]}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
    return JSON.parse(response.response.text()).order as string[];
  }, onRetry);

  lastRouteHash = routeHash;
  addressCache['last_route_order'] = result;
  return result;
};
