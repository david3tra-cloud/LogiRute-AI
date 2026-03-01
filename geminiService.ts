import { GoogleGenerativeAI } from "@google/generative-ai";
import { Delivery } from "../types";

// Inicialización de la API con tu clave de entorno
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

// Cache persistente para no gastar cuota en búsquedas repetidas
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
    if (keys.length > 100) delete addressCache[keys[0]];
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(addressCache));
  } catch (e) {
    console.warn("Error guardando cache:", e);
  }
};

/**
 * FUNCIÓN AÑADIDA: Necesaria para que App.tsx no dé error de "not defined"
 */
export const buildSearchQuery = (name: string, address: string): string[] => {
  const query = `${name} ${address}`.trim();
  return [query];
};

/**
 * Función de reintentos para manejar errores 429 (Límite de cuota)
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
        if (onRetry) onRetry(`Límite agotado. Reintentando en ${waitTime/1000}s...`);
        await new Promise(res => setTimeout(res, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Extrae coordenadas de texto o URLs de Google Maps
 */
const extractCoords = (text: string) => {
  if (!text) return null;
  const normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2');
  const patterns = [
    /([-+]?\d+\.\d+)\s*[,; \t]\s*([-+]?\d+\.\d+)/, // lat, lng puro
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                  // formato URL @lat,lng
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/               // formato interno Maps
  ];
  
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90) return { lat, lng };
    }
  }
  return null;
};

/**
 * Limpia etiquetas de la IA (ej: "Dirección: Calle...")
 */
const cleanLine = (text: string) => {
  return text
    .replace(/^(NOMBRE|DIRECCION|DIRECCIÓN|ADDRESS|NAME|UBICACIÓN|Lugar):/i, '')
    .trim();
};

/**
 * PROCESAMIENTO DE DIRECCIONES (El "Cerebro")
 */
export const parseAddress = async (
  input: string,
  userLocation?: { latitude: number; longitude: number },
  manualCoords?: string,
  onRetry?: (msg: string) => void
) => {
  const rawInput = input.trim();
  const rawManual = manualCoords?.trim() || "";
  const cacheKey = `${rawInput}|${rawManual}`.toLowerCase();
  
  if (addressCache[cacheKey]) return addressCache[cacheKey];

  const direct = extractCoords(rawManual || rawInput);
  if (direct && !/^[A-Z0-9]{4,}\+/.test(rawInput)) {
    const result = {
      recipient: rawInput || "Punto GPS",
      address: `Coordenadas: ${direct.lat}, ${direct.lng}`,
      lat: direct.lat,
      lng: direct.lng,
      sourceUrl: `https://www.google.com/maps?q=${direct.lat},${direct.lng}`
    };
    addressCache[cacheKey] = result;
    saveCache();
    return result;
  }

  const anchor = userLocation || { latitude: 38.2622, longitude: -0.6993 }; // Elche

  const result = await withRetry(async () => {
    // CAMBIO: Usamos la versión estable -001 para evitar el error 404
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-001",
      tools: [{ googleSearchRetrieval: {} }] as any 
    });

    const prompt = `
      SISTEMA DE LOCALIZACIÓN LOGÍSTICA.
      BUSCA: "${rawInput}".
      UBICACIÓN ACTUAL RELEVANTE: Elche, Alicante, España (Lat ${anchor.latitude}, Lng ${anchor.longitude}).

      TAREA:
      1. Encuentra el nombre oficial y la DIRECCIÓN POSTAL REAL (Calle, Número, CP, Ciudad).
      2. Si el usuario pone un negocio (ej: El Corte Inglés), busca su ubicación exacta en Elche.
      3. RESPONDE SOLO 2 LÍNEAS:
         Línea 1: Nombre comercial exacto.
         Línea 2: Dirección postal completa.
    `;

    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const metadata = (response.response.candidates?.[0] as any)?.groundingMetadata;
    
    let lat = anchor.latitude;
    let lng = anchor.longitude;
    let title = "";
    let url = "";

    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        const uri = chunk.web?.uri || chunk.googleSearchRetrieval?.source?.url;
        if (uri) {
          const coords = extractCoords(uri);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            url = uri;
            title = chunk.web?.title || "";
            break; 
          }
        }
      }
    }

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    const finalResult = {
      recipient: title || lines[0] || rawInput,
      address: lines[1] || lines[0] || rawInput,
      lat,
      lng,
      sourceUrl: url || `https://www.google.com/maps?q=${lat},${lng}`,
      phone: text.match(/(?:\+34|34)?[6789]\d{8}/)?.[0]
    };
    return finalResult;
  }, onRetry);

  addressCache[cacheKey] = result;
  saveCache();
  return result;
};

/**
 * OPTIMIZACIÓN DE RUTA
 */
export const optimizeRoute = async (deliveries: Delivery[], start: string, onRetry?: (msg: string) => void) => {
  return await withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001" });
    const prompt = `Ordena estos IDs por proximidad geográfica para la ruta más corta empezando en ${start}: ${JSON.stringify(deliveries.map(d => ({id: d.id, a: d.address})))}. Responde solo JSON: {"order": ["id1", "id2", ...]}`;
    
    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });
    
    return JSON.parse(response.response.text()).order as string[];
  }, onRetry);
};
