import { GoogleGenerativeAI } from "@google/generative-ai";
import { Delivery } from "../types";

// Inicialización con la clave de entorno
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

/**
 * CACHE DE DIRECCIONES
 */
const CACHE_STORAGE_KEY = 'logiroute_address_cache_v1';
const getInitialCache = (): Record<string, any> => {
  try {
    const saved = localStorage.getItem(CACHE_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch (e) { return {}; }
};

let addressCache: Record<string, any> = getInitialCache();

/**
 * FUNCIÓN CRÍTICA: buildSearchQuery
 * Necesaria para que App.tsx no dé error de "not defined"
 */
export const buildSearchQuery = (name: string, address: string): string => {
  return `${name} ${address}`.trim();
};

/**
 * PARSE ADDRESS (El "Cerebro" simplificado para evitar el 404)
 */
export const parseAddress = async (
  input: string,
  userLocation?: { latitude: number; longitude: number },
  manualCoords?: string,
  onRetry?: (msg: string) => void
) => {
  const cacheKey = input.toLowerCase().trim();
  if (addressCache[cacheKey]) return addressCache[cacheKey];

  try {
    // Usamos el modelo estándar sin "tools" para evitar el error 404
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Actúa como un experto en logística en Elche.
    Analiza esta ubicación: "${input}".
    
    Responde estrictamente con este formato JSON:
    {
      "recipient": "Nombre oficial del establecimiento",
      "address": "Calle, número y CP en Elche",
      "lat": 38.2622,
      "lng": -0.6993
    }
    
    Si no conoces el sitio exacto, usa coordenadas aproximadas de Elche (38.2622, -0.6993).`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    // Limpiar el JSON por si viene con markdown
    text = text.replace(/```json|```/gi, '').trim();
    const data = JSON.parse(text);

    const finalResult = {
      recipient: data.recipient || input,
      address: data.address || input,
      lat: data.lat || 38.2622,
      lng: data.lng || -0.6993,
      sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input)}`,
      phone: ""
    };

    // Guardar en cache
    addressCache[cacheKey] = finalResult;
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(addressCache));

    return finalResult;

  } catch (error) {
    console.error("Error en Gemini:", error);
    // FALLBACK: Si falla la IA, devolvemos los datos básicos para no romper la App
    return {
      recipient: input,
      address: "Revisar dirección manualmente",
      lat: 38.2622,
      lng: -0.6993,
      sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input)}`,
      phone: ""
    };
  }
};

/**
 * OPTIMIZACIÓN DE RUTA
 */
export const optimizeRoute = async (deliveries: Delivery[], start: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Ordena estos IDs por proximidad para una ruta lógica en Elche empezando en ${start}: 
    ${JSON.stringify(deliveries.map(d => ({id: d.id, a: d.address})))}. 
    Responde solo JSON: {"order": ["id1", "id2", ...]}`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().replace(/```json|```/gi, '').trim();
    return JSON.parse(text).order as string[];
  } catch (e) {
    console.error("Error optimizando:", e);
    return deliveries.map(d => d.id); // Devolvemos el orden actual si falla
  }
};
