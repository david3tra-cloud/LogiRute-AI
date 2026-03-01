import { GoogleGenerativeAI } from "@google/generative-ai";
import { Delivery } from "../types";

// Inicialización con versión específica para evitar el error 404 (image_af9c99.png)
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// Cache persistente
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
 * SOLUCIÓN AL ERROR DE VERCEL (image_b0109d.jpg):
 * Exportamos buildSearchQuery para que App.tsx pueda usarlo.
 */
export const buildSearchQuery = (concept: string, name: string): string => {
  return `${name} ${concept}`.trim();
};

/**
 * Función de reintentos para manejar límites de cuota
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
      const isQuotaError = error?.message?.includes("429") || error?.status === 429;
      
      if (isQuotaError && i < maxRetries - 1) {
        const waitTime = Math.pow(2, i) * 2000;
        if (onRetry) onRetry(`Reintentando en ${waitTime/1000}s...`);
        await new Promise(res => setTimeout(res, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

const extractCoords = (text: string) => {
  if (!text) return null;
  const normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2');
  const patterns = [
    /([-+]?\d+\.\d+)\s*[,; \t]\s*([-+]?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  }
  return null;
};

const cleanLine = (text: string) => text.replace(/^(NOMBRE|DIRECCIÓN|DIRECCION|UBICACIÓN):/i, '').trim();

/**
 * PARSE ADDRESS - EL CEREBRO
 */
export const parseAddress = async (
  input: string,
  userLocation?: { latitude: number; longitude: number },
  manualCoords?: string,
  onRetry?: (msg: string) => void
) => {
  const rawInput = input.trim();
  const cacheKey = `${rawInput}|${manualCoords || ''}`.toLowerCase();
  if (addressCache[cacheKey]) return addressCache[cacheKey];

  const anchor = userLocation || { latitude: 38.2622, longitude: -0.6993 };

  const result = await withRetry(async () => {
    // IMPORTANTE: gemini-1.5-flash-001 resuelve el error 404 de tus capturas
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-001",
      tools: [{ googleSearchRetrieval: {} }] as any 
    });

    const prompt = `Localiza en Elche: "${rawInput}". 
    Responde solo 2 líneas:
    Línea 1: Nombre real del sitio.
    Línea 2: Dirección completa (Calle, Número, Elche).`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const metadata = (response.response.candidates?.[0] as any)?.groundingMetadata;
    
    let lat = anchor.latitude;
    let lng = anchor.longitude;
    let url = "";

    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        const uri = chunk.web?.uri || chunk.googleSearchRetrieval?.source?.url;
        if (uri) {
          const coords = extractCoords(uri);
          if (coords) { lat = coords.lat; lng = coords.lng; url = uri; break; }
        }
      }
    }

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    return {
      recipient: lines[0] || rawInput,
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

/**
 * OPTIMIZACIÓN DE RUTA
 */
export const optimizeRoute = async (deliveries: Delivery[], start: string, onRetry?: (msg: string) => void) => {
  return await withRetry(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001" });
    const prompt = `Ordena estos IDs para la ruta más corta desde ${start}: ${JSON.stringify(deliveries.map(d => ({id: d.id, a: d.address})))}. Responde JSON: {"order": ["id1", "id2", ...]}`;
    
    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });
    
    return JSON.parse(response.response.text()).order as string[];
  }, onRetry);
};
