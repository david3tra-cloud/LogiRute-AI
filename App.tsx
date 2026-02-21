
import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  Truck,
  MapPin,
  Clock,
  Phone,
  Navigation,
  ListChecks,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Route,
  Smartphone
} from "lucide-react";

export enum DeliveryStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export type DeliveryType = "pickup" | "dropoff" | "mixed";

export interface Delivery {
  id: string;
  concept?: string;
  recipient: string;
  address: string;
  phone?: string;
  coordinates: [number, number];
  status: DeliveryStatus;
  type: DeliveryType;
  sourceUrl?: string;
  estimatedTime?: string;
}

const driverIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const stopIcon = new L.DivIcon({
  className: "custom-stop-icon",
  html: `<div style="background:#fff;border-radius:9999px;border:2px solid #22c55e;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#22c55e;">S</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const initialDeliveries: Delivery[] = [];

const defaultCenter: [number, number] = [38.2699, -0.7126];

function App() {
  const [deliveries, setDeliveries] = useState<Delivery[]>(initialDeliveries);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newNameInput, setNewNameInput] = useState("");
  const [newAddressInput, setNewAddressInput] = useState("");
  const [newPhoneInput, setNewPhoneInput] = useState("");
  const [newCoordsInput, setNewCoordsInput] = useState("");
  const [conceptInput, setConceptInput] = useState("");
  const [newType, setNewType] = useState<DeliveryType>("dropoff");
  const [currentUserLoc, setCurrentUserLoc] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsingMessage, setParsingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentUserLoc([pos.coords.latitude, pos.coords.longitude]);
        setIsLocating(false);
      },
      () => {
        setCurrentUserLoc(defaultCenter);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  const selectedDelivery = useMemo(
    () => deliveries.find((d) => d.id === selectedId) || null,
    [deliveries, selectedId]
  );

  const polylinePositions = useMemo(() => {
    const points: [number, number][] = [];
    if (currentUserLoc) points.push(currentUserLoc);
    deliveries.forEach((d) => points.push(d.coordinates));
    return points;
  }, [currentUserLoc, deliveries]);

  const handleStatusChange = (id: string, status: DeliveryStatus) => {
    setDeliveries((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
  };

  const handleDeleteDelivery = (id: string) => {
    if (!window.confirm("¿Eliminar esta parada?")) return;
    setDeliveries((prev) => prev.filter((d) => d.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const openInMaps = (delivery: Delivery) => {
    const [lat, lng] = delivery.coordinates;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank");
  };

  // helpers muy simples para que compile y funcione
  const buildSearchQuery = (name: string, fullAddress: string) => {
    const q = [name, fullAddress].filter(Boolean).join(" ");
    return [q || fullAddress || "Elx Comunitat Valenciana España"];
  };

  const parseAddress = async (
    query: string,
    userLoc: [number, number] | null,
    coords: string,
    onUpdate: (msg: string) => void
  ) => {
    onUpdate("Analizando dirección...");
    // Si el usuario ha puesto coords manuales, las usamos directamente
    if (coords) {
      const [latStr, lngStr] = coords.split(",").map((s) => s.trim());
      const lat = Number(latStr);
      const lng = Number(lngStr);
      if (!isNaN(lat) && !isNaN(lng)) {
        return {
          recipient: query || "Parada",
          address: query || "Ubicación personalizada",
          phone: "",
          lat,
          lng,
          sourceUrl: `coords:${coords}`,
        };
      }
    }
    // Fallback: usamos centro por defecto o ubicación del usuario
    const [lat, lng] = userLoc || defaultCenter;
    return {
      recipient: query || "Parada",
      address: query || "Elx, Comunitat Valenciana, España",
      phone: "",
      lat,
      lng,
      sourceUrl: "system:fallback",
    };
  };

  const handleAddDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isParsing) return;

    const name = newNameInput.trim();
    let address = newAddressInput.trim();
    const coords = newCoordsInput.trim();

    if (!name && !address && !coords) {
      alert("Introduce algún dato de búsqueda.");
      return;
    }

    if (!address && name) {
      address = name;
    }

    const baseContext = "Elx, Comunitat Valenciana, España";
    const fullAddress = address ? `${address}, ${baseContext}` : baseContext;

    const exists = deliveries.find(
      (d) =>
        (name && d.recipient.toLowerCase() === name.toLowerCase()) ||
        (coords && d.sourceUrl?.includes(coords))
    );

    if (exists && !window.confirm(`Ya tienes una parada para "${exists.recipient}". ¿Añadir duplicado?`)) {
      setIsAdding(false);
      return;
    }

    setIsParsing(true);
    setParsingMessage("Búsqueda inteligente...");

    try {
      const queries = buildSearchQuery(name, fullAddress);
      const searchQuery = queries[0];
      const parsed = await parseAddress(searchQuery, currentUserLoc, coords, (msg) =>
        setParsingMessage(msg)
      );

      const newDelivery: Delivery = {
        id: Math.random().toString(36).substring(2, 9),
        concept: conceptInput.trim() || undefined,
        recipient: name || parsed.recipient,
        address: parsed.address,
        phone: newPhoneInput.trim() || parsed.phone || "",
        coordinates: [parsed.lat, parsed.lng],
        status: DeliveryStatus.PENDING,
        type: newType,
        sourceUrl: parsed.sourceUrl,
        estimatedTime: `~${Math.floor(Math.random() * 3) + 1} h`,
      };

      console.log("Nueva parada creada", {
        input: { name, fullAddress, coords },
        parsed,
        savedCoordinates: newDelivery.coordinates,
      });

      setDeliveries((prev) => [...prev, newDelivery]);

      setConceptInput("");
      setNewNameInput("");
      setNewAddressInput("");
      setNewPhoneInput("");
      setNewCoordsInput("");
      setIsAdding(false);
      setSelectedId(newDelivery.id);
    } catch (error: any) {
      console.error("Error al añadir parada", error);
      const msg =
        (error && error.message) ||
        "No se pudo interpretar la dirección. Intenta ser más específico o añade coordenadas.";
      alert(msg);
    } finally {
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-emerald-400 to-sky-400 flex items-center justify-center">
              <Truck className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">LogiRoute AI</h1>
              <p className="text-xs text-slate-400">
                Planificador inteligente de rutas para repartidores
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>Optimizado para uso en móvil</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-sky-400" />
              <span>Abre cada parada en Google Maps</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-4 flex flex-col gap-4">
        <section className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 items-stretch">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-medium">Paradas de hoy</h2>
              </div>
              <button
                onClick={() => setIsAdding(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Nueva parada
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
              {deliveries.length === 0 ? (
                <div className="p-6 flex flex-col items-center justify-center text-center gap-2 text-sm text-slate-400">
                  <ListChecks className="w-6 h-6 text-slate-600 mb-1" />
                  <p>No tienes paradas añadidas todavía.</p>
                  <p>Pulsa en “Nueva parada” para empezar a planificar tu ruta de reparto.</p>
                </div>
              ) : (
                deliveries.map((d, index) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-800/70 transition ${
                      selectedId === d.id ? "bg-slate-800/90" : ""
                    }`}
                  >
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-100">
                        {index + 1}
                      </div>
                      <div className="w-px flex-1 bg-slate-800" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                            {d.type === "pickup"
                              ? "Recogida"
                              : d.type === "dropoff"
                              ? "Entrega"
                              : "Mixto"}
                          </span>
                          <p className="font-medium text-sm truncate">
                            {d.recipient || "Parada sin nombre"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{d.estimatedTime || "~1 h"}</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-sky-400" />
                        <span className="line-clamp-2">{d.address}</span>
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          {d.phone && (
                            <span className="inline-flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{d.phone}</span>
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] ${
                              d.status === DeliveryStatus.PENDING
                                ? "border-amber-500/30 text-amber-400"
                                : d.status === DeliveryStatus.IN_PROGRESS
                                ? "border-sky-500/30 text-sky-400"
                                : d.status === DeliveryStatus.COMPLETED
                                ? "border-emerald-500/30 text-emerald-400"
                                : "border-rose-500/30 text-rose-400"
                            }`}
                          >
                            {d.status === DeliveryStatus.PENDING && (
                              <>
                                <AlertCircle className="w-3 h-3" />
                                Pendiente
                              </>
                            )}
                            {d.status === DeliveryStatus.IN_PROGRESS && (
                              <>
                                <Clock className="w-3 h-3" />
                                En curso
                              </>
                            )}
                            {d.status === DeliveryStatus.COMPLETED && (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                Entregada
                              </>
                            )}
                            {d.status === DeliveryStatus.CANCELLED && (
                              <>
                                <XCircle className="w-3 h-3" />
                                Cancelada
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openInMaps(d);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>Ir</span>
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleDeleteDelivery(d.id);
                            }}
                            className="p-1 rounded-full hover:bg-slate-800 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {deliveries.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between gap-2 bg-slate-900/80">
                <span>
                  Total paradas: <span className="text-slate-100 font-medium">{deliveries.length}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Tiempo estimado ruta: ~{deliveries.length * 0.7 + 0.5} h</span>
                </span>
              </div>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl relative overflow-hidden flex flex-col">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.15),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(52,211,153,0.15),_transparent_55%)] pointer-events-none" />
            <div className="relative flex-1 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/60">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-medium">Mapa de ruta</h2>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Conductor</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-sky-400" />
                    <span>Paradas</span>
                  </div>
                </div>
              </div>
              <div className="relative flex-1">
                <MapContainer
                  center={currentUserLoc || defaultCenter}
                  zoom={13}
                  style={{ width: "100%", height: "100%" }}
                  className="rounded-b-xl overflow-hidden"
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
                  />
                  {currentUserLoc && (
                    <Marker position={currentUserLoc} icon={driverIcon}>
                      <Tooltip direction="top" offset={[0, -8]} opacity={1} permanent>
                        <div className="text-[11px] font-medium">Tu ubicación</div>
                      </Tooltip>
                    </Marker>
                  )}
                  {deliveries.map((d, idx) => (
                    <Marker key={d.id} position={d.coordinates} icon={stopIcon}>
                      <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                        <div className="text-[11px]">
                          <div className="font-semibold mb-0.5">
                            #{idx + 1} · {d.recipient || "Parada"}
                          </div>
                          <div className="text-slate-300">{d.address}</div>
                        </div>
                      </Tooltip>
                    </Marker>
                  ))}
                  {polylinePositions.length > 1 && (
                    <Polyline
                      positions={polylinePositions}
                      color="#22c55e"
                      weight={3}
                      opacity={0.7}
                    />
                  )}
                </MapContainer>
                {isLocating && (
                  <div className="absolute inset-x-4 bottom-4 z-[500]">
                    <div className="px-3 py-2 rounded-full bg-slate-950/85 border border-slate-800 text-[11px] text-slate-300 flex items-center gap-2 justify-center">
                      <Clock className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                      <span>Buscando tu ubicación actual…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {isAdding && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-medium">Añadir nueva parada</h3>
                </div>
                <button
                  onClick={() => setIsAdding(false)}
                  className="p-1 rounded-full hover:bg-slate-800 text-slate-400"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleAddDelivery} className="px-4 py-3 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Nombre del cliente / referencia</label>
                  <input
                    value={newNameInput}
                    onChange={(e) => setNewNameInput(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Ej: Bar Pepe, Juan García, Oficina DHL..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Dirección aproximada</label>
                  <input
                    value={newAddressInput}
                    onChange={(e) => setNewAddressInput(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Calle, número, barrio… (opcional si usas coordenadas)"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-slate-300">Teléfono (opcional)</label>
                    <input
                      value={newPhoneInput}
                      onChange={(e) => setNewPhoneInput(e.target.value)}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Móvil del cliente"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-slate-300">Tipo</label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as DeliveryType)}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="dropoff">Entrega</option>
                      <option value="pickup">Recogida</option>
                      <option value="mixed">Mixto</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Coordenadas (lat,lng) opcional</label>
                  <input
                    value={newCoordsInput}
                    onChange={(e) => setNewCoordsInput(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="38.2699, -0.7126"
                  />
                  <p className="text-[11px] text-slate-500">
                    Si las rellenas, se usarán directamente en el mapa aunque la dirección sea
                    aproximada.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Concepto interno (opcional)</label>
                  <input
                    value={conceptInput}
                    onChange={(e) => setConceptInput(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Ej: ruta mañana, especial frío, prioridad alta..."
                  />
                </div>
                {parsingMessage && (
                  <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>{parsingMessage}</span>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="px-3 py-1.5 rounded-full text-xs bg-slate-800 text-slate-200 hover:bg-slate-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isParsing}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {isParsing ? "Analizando..." : "Guardar parada"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
