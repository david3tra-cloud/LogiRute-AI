import React, { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, X, Truck, MapPin, Mic, Power, Phone, Tag } from 'lucide-react';
import MapView from './MapView';
import DeliveryCard from './DeliveryCard';
import { Delivery, DeliveryStatus, DeliveryType } from './types';
import { parseAddress } from './groqService';
import { geocodeAddress } from './geocodingService';
import { optimizeDeliveries } from './routeService';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

const STORAGE_KEY = 'logiroute_deliveries_v3';
const VIEW_MODE_KEY = 'logiroute_viewmode_v1';
const SEQUENCE_KEY = 'logiroute_sequence_v1';

const safeGetItem = (key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const App: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>(() => {
    const saved = safeGetItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [manualSequence, setManualSequence] = useState<string[]>(() => {
    const saved = safeGetItem(SEQUENCE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list' | 'control'>(() => {
    const saved = safeGetItem(VIEW_MODE_KEY);
    return (saved as any) || 'split';
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [conceptInput, setConceptInput] = useState('');
  const [unifiedInput, setUnifiedInput] = useState('');
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [newCoordsInput, setNewCoordsInput] = useState('');

  const [newType, setNewType] = useState<DeliveryType>(DeliveryType.DELIVERY);
  const [isParsing, setIsParsing] = useState(false);
  const [parsingMessage, setParsingMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isAppClosed, setIsAppClosed] = useState(false);
  const [currentUserLoc, setCurrentUserLoc] = useState<
    { latitude: number; longitude: number } | undefined
  >(undefined);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (isAppClosed) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries));
      localStorage.setItem(SEQUENCE_KEY, JSON.stringify(manualSequence));
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // ignorar errores de storage
    }
  }, [deliveries, manualSequence, viewMode, isAppClosed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setCurrentUserLoc({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        (err) => console.warn('GPS no disponible:', err.message),
        { enableHighAccuracy: true }
      );
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-ES';
      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setUnifiedInput((prev) => (prev ? `${prev} ${text}` : text));
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    } else {
      recognitionRef.current = null;
    }
  }, []);

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      alert('Tu navegador no soporta dictado de voz.');
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      setIsListening(true);
      recognition.start();
    }
  };

  const handleAddDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isParsing) return;

    const search = unifiedInput.trim();
    const coords = newCoordsInput.trim();

    if (!search && !coords) {
      alert('Introduce algún dato de búsqueda o coordenadas.');
      return;
    }

    setIsParsing(true);
    setParsingMessage('Localizando destino...');

    try {
      const parsed = await parseAddress(search, currentUserLoc, coords);

      const geocodingTarget = coords || parsed.address;

      const geo = await geocodeAddress(geocodingTarget);
      const lat = geo.lat;
      const lng = geo.lng;

      const newDelivery: Delivery = {
        id: Math.random().toString(36).substring(2, 9),
        concept: conceptInput.trim() || undefined,
        recipient: search,
        address: parsed.address,
        phone: newPhoneInput.trim() || parsed.phone || '',
        coordinates: [lat, lng],
        status: DeliveryStatus.PENDING,
        type: newType,
        sourceUrl: parsed.sourceUrl || coords || undefined,
        estimatedTime: `~${Math.floor(Math.random() * 3) + 1} h`,
      };

      setDeliveries((prev) => [...prev, newDelivery]);
      setConceptInput('');
      setUnifiedInput('');
      setNewPhoneInput('');
      setNewCoordsInput('');
      setIsAdding(false);
      setSelectedId(newDelivery.id);
    } catch (error: any) {
      alert('Error: ' + (error?.message || 'Error desconocido'));
    } finally {
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  const handleDeleteDelivery = (id: string) => {
    setDeliveries((prev) => prev.filter((d) => d.id !== id));
    setManualSequence((prev) => prev.filter((x) => x !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleStatusChange = (id: string, status: DeliveryStatus) => {
    // igual que en GitHub: reordena activas y completadas
    setDeliveries((prev) => {
      const updated = prev.map((d) =>
        d.id === id ? { ...d, status } : d
      );

      const active = updated.filter(
        (d) =>
          d.status === DeliveryStatus.PENDING ||
          d.status === DeliveryStatus.IN_PROGRESS
      );
      const done = updated.filter(
        (d) =>
          d.status === DeliveryStatus.COMPLETED ||
          d.status === DeliveryStatus.ISSUE
      );

      return [...active, ...done];
    });

    if (status === DeliveryStatus.COMPLETED || status === DeliveryStatus.ISSUE) {
      setManualSequence((prev) => prev.filter((sid) => sid !== id));
    }
  };

  const handleClearAll = () => {
    if (window.confirm('¿BORRAR Y CERRAR? Se eliminarán todas las paradas.')) {
      setIsAppClosed(true);
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignorar
      }
      window.location.reload();
    }
  };

  const handleOptimizeRoute = () => {
    if (!currentUserLoc) {
      alert('Activa primero tu ubicación (GPS del dispositivo).');
      return;
    }
    if (deliveries.length === 0) return;

    setIsOptimizing(true);
    setOptimizeMessage(null);

    try {
      const startPoint = {
        lat: currentUserLoc.latitude,
        lng: currentUserLoc.longitude,
      };

      const optimized = optimizeDeliveries(deliveries, startPoint);
      setDeliveries(optimized);
      setManualSequence(optimized.map((d) => d.id));
      setOptimizeMessage('Ruta optimizada, orden actualizado');
    } catch (e) {
      setOptimizeMessage('No se ha podido optimizar la ruta');
    } finally {
      setTimeout(() => {
        setIsOptimizing(false);
        setOptimizeMessage(null);
      }, 2000);
    }
  };

  const handleMarkerDragEnd = (id: string, coords: [number, number]) => {
    setDeliveries((prev) =>
      prev.map((d) => (d.id === id ? { ...d, coordinates: coords } : d))
    );
  };

  const handleMarkerSelectForSequence = (id: string) => {
    setManualSequence((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
    setSelectedId((prev) => (prev === id ? null : id));
  };

  if (isAppClosed) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-center p-6">
        <Power size={80} className="text-white mb-8 animate-pulse" />
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white px-10 py-5 rounded-3xl font-black shadow-xl uppercase"
        >
          Nueva Jornada
        </button>
      </div>
    );
  }

  const pendingCount = deliveries.filter(
    (d) =>
      d.status === DeliveryStatus.PENDING ||
      d.status === DeliveryStatus.IN_PROGRESS
  ).length;

  const sortedDeliveries: Delivery[] = React.useMemo(() => {
    const byId: Record<string, Delivery> = {};
    deliveries.forEach((d) => {
      byId[d.id] = d;
    });

    const inSequence: Delivery[] = [];
    manualSequence.forEach((id) => {
      if (byId[id]) {
        inSequence.push(byId[id]);
        delete byId[id];
      }
    });

    const remaining = Object.values(byId);

    return [...inSequence, ...remaining];
  }, [deliveries, manualSequence]);

  const handleDragEndList = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;

    const activeIndex = sortedDeliveries.findIndex((d) => d.id === active.id);
    const overIndex = sortedDeliveries.findIndex((d) => d.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;

    const newOrder = arrayMove(sortedDeliveries, activeIndex, overIndex);
    const newSequence = newOrder.map((d) => d.id);

    setManualSequence(newSequence);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      {optimizeMessage && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-slate-900 text-white text-[10px] sm:text-xs px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-black uppercase tracking-tight">
              {optimizeMessage}
            </span>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="bg-white border-b px-3 py-2 flex items-center justify-between gap-2 z-30 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="text-blue-600 shrink-0" size={22} />
          <h1 className="text-lg font-black tracking-tighter truncate">
            LOGIROUTE <span className="text-blue-600">AI</span>
          </h1>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex bg-slate-100 rounded-xl p-1 text-[9px] sm:text-[10px]">
            {['list', 'map', 'split', 'control'].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode as any)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg font-black uppercase ${
                  viewMode === mode ? 'bg-white shadow text-blue-600' : 'text-slate-400'
                }`}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={() => setIsAdding(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-2xl text-[10px] font-black uppercase flex items-center gap-1 shadow-md hover:bg-blue-700 transition"
            >
              <Plus size={14} /> Nueva parada
            </button>
            <button
              onClick={handleOptimizeRoute}
              disabled={isOptimizing || !currentUserLoc || deliveries.length === 0}
              className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase disabled:opacity-40 hover:bg-blue-50 transition"
            >
              {isOptimizing ? 'OPTIMIZANDO…' : 'OPTIMIZAR'}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 text-white text-[9px] sm:text-[10px] font-black uppercase shadow-lg"
            >
              <img
                src="/logiroute_icon.jpg"
                alt="LogiRoute PRO"
                className="w-5 h-5 rounded-xl shadow-sm"
              />
              <span>PRO</span>
            </button>
          </div>
        </div>
      </header>

      {/* barra acciones móvil */}
      <div className="sm:hidden bg-white border-b px-3 py-2 flex items-center justify-end gap-2">
        <button
          onClick={() => setIsAdding(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1 shadow-md"
        >
          <Plus size={14} /> Nueva
        </button>
        <button
          onClick={handleOptimizeRoute}
          disabled={isOptimizing || !currentUserLoc || deliveries.length === 0}
          className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-40"
        >
          {isOptimizing ? 'OPTIMIZANDO…' : 'OPTIMIZAR'}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 text-white text-[10px] font-black uppercase shadow-lg"
        >
          <img
            src="/logiroute_icon.jpg"
            alt="LogiRoute PRO"
            className="w-4 h-4 rounded-lg shadow-sm"
          />
          <span>PRO</span>
        </button>
      </div>

      {/* MAIN */}
      <main className="flex-1 flex flex-col sm:flex-row overflow-hidden">
        {viewMode === 'control' ? (
          <div className="flex-1 p-4 sm:p-6 md:p-12 overflow-y-auto bg-slate-50">
            <div className="max-w-5xl mx-auto space-y-10">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex flex-col">
                  <h2 className="text-3xl sm:text-4xl font-black text-slate-800 tracking-tighter uppercase">
                    Panel de Control
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Versión Groq 1.0
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    className="bg-slate-900 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-slate-800 transition-all uppercase text-xs"
                  >
                    REGISTRO
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="bg-red-600 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-red-700 transition-all uppercase text-xs"
                  >
                    <Power size={20} /> Cerrar Sesión
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
                <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Completadas
                  </span>
                  <span className="text-4xl sm:text-5xl font-black text-slate-800 mt-1">
                    {
                      deliveries.filter(
                        (d) => d.status === DeliveryStatus.COMPLETED
                      ).length
                    }
                  </span>
                  <div className="flex gap-6 mt-4 mb-2">
                    <div className="flex flex-col items-center">
                      <span className="text-lg sm:text-xl font-black text-blue-600">
                        {
                          deliveries.filter(
                            (d) =>
                              d.status === DeliveryStatus.COMPLETED &&
                              d.type === DeliveryType.DELIVERY
                          ).length
                        }
                      </span>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">
                        Entregas
                      </p>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-lg sm:text-xl font-black text-red-600">
                        {
                          deliveries.filter(
                            (d) =>
                              d.status === DeliveryStatus.COMPLETED &&
                              d.type === DeliveryType.PICKUP
                          ).length
                        }
                      </span>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">
                        Recogidas
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Incidencias
                  </span>
                  <span className="text-4xl sm:text-5xl font-black text-amber-500 mt-2">
                    {
                      deliveries.filter(
                        (d) => d.status === DeliveryStatus.ISSUE
                      ).length
                    }
                  </span>
                </div>

                <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Pendientes
                  </span>
                  <span className="text-4xl sm:text-5xl font-black text-blue-500 mt-2">
                    {pendingCount}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {viewMode !== 'list' && (
              <section
                className={
                  viewMode === 'split'
                    ? 'h-1/2 sm:h-auto sm:flex-1 relative'
                    : 'flex-1 relative'
                }
              >
                <MapView
                  deliveries={deliveries}
                  manualSequence={manualSequence}
                  selectedId={selectedId}
                  onMarkerClick={handleMarkerSelectForSequence}
                  viewMode={viewMode}
                  onMarkerDragEnd={handleMarkerDragEnd}
                />
              </section>
            )}

            {viewMode === 'split' && (
              <aside className="h-1/2 sm:h-auto sm:w-[440px] border-t sm:border-t-0 sm:border-l bg-white overflow-y-auto p-4 space-y-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEndList}
                >
                  <SortableContext
                    items={sortedDeliveries.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sortedDeliveries.map((d, index) => (
                      <DeliveryCard
                        key={d.id}
                        delivery={d}
                        index={index}
                        isSelected={selectedId === d.id}
                        onClick={() => setSelectedId(d.id)}
                        onStatusChange={(id, status) => handleStatusChange(id, status)}
                        onDelete={(id) => handleDeleteDelivery(id)}
                        onRemoveFromSequence={(id) =>
                          setManualSequence((prev) => prev.filter((x) => x !== id))
                        }
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </aside>
            )}

            {viewMode === 'list' && (
              <aside className="flex-1 bg-white overflow-y-auto p-4 space-y-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEndList}
                >
                  <SortableContext
                    items={sortedDeliveries.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sortedDeliveries.map((d, index) => (
                      <DeliveryCard
                        key={d.id}
                        delivery={d}
                        index={index}
                        isSelected={selectedId === d.id}
                        onClick={() => setSelectedId(d.id)}
                        onStatusChange={(id, status) => handleStatusChange(id, status)}
                        onDelete={(id) => handleDeleteDelivery(id)}
                        onRemoveFromSequence={(id) =>
                          setManualSequence((prev) => prev.filter((x) => x !== id))
                        }
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </aside>
            )}
          </>
        )}
      </main>

      {/* Modal Nueva Parada */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-xl shadow-2xl overflow-hidden">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50/40">
              <h3 className="text-2xl font-black uppercase tracking-tighter italic">
                Nueva Parada
              </h3>
              <button
                onClick={() => setIsAdding(false)}
                className="p-2 hover:bg-slate-200 rounded-xl"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleAddDelivery} className="p-8 space-y-6">
              <div className="flex bg-slate-100 p-1.5 rounded-3xl">
                <button
                  type="button"
                  onClick={() => setNewType(DeliveryType.DELIVERY)}
                  className={`flex-1 py-3 rounded-2xl text-[10px] font-black ${
                    newType === DeliveryType.DELIVERY
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'text-slate-400'
                  }`}
                >
                  ENTREGA
                </button>
                <button
                  type="button"
                  onClick={() => setNewType(DeliveryType.PICKUP)}
                  className={`flex-1 py-3 rounded-2xl text-[10px] font-black ${
                    newType === DeliveryType.PICKUP
                      ? 'bg-red-600 text-white shadow-lg'
                      : 'text-slate-400'
                  }`}
                >
                  RECOGIDA
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                  Nombre, Comercio o Dirección
                </label>
                <div className="relative">
                  <MapPin
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"
                    size={20}
                  />
                  <textarea
                    value={unifiedInput}
                    onChange={(e) => setUnifiedInput(e.target.value)}
                    className="w-full h-28 pl-12 pr-14 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm resize-none"
                    placeholder="Ej: Pacal Shoes Elche o Calle Mayor 10"
                  />
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute right-2 bottom-2 p-2.5 rounded-xl ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Mic size={18} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    Teléfono
                  </label>
                  <div className="relative">
                    <Phone
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"
                      size={16}
                    />
                    <input
                      type="tel"
                      value={newPhoneInput}
                      onChange={(e) => setNewPhoneInput(e.target.value)}
                      className="w-full pl-10 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    Coordenadas / Plus Code
                  </label>
                  <div className="relative">
                    <MapPin
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"
                      size={16}
                    />
                    <input
                      type="text"
                      value={newCoordsInput}
                      onChange={(e) => setNewCoordsInput(e.target.value)}
                      className="w-full pl-10 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs"
                      placeholder="Ej: 38.26,-0.70 o 76R3+5C Elche"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                  Concepto (Ej: Paquete 4)
                </label>
                <div className="relative">
                  <Tag
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"
                    size={20}
                  />
                  <input
                    type="text"
                    value={conceptInput}
                    onChange={(e) => setConceptInput(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isParsing || (!unifiedInput.trim() && !newCoordsInput.trim())}
                className="w-full py-5 bg-blue-600 text-white rounded-[30px] font-black text-lg flex justify-center items-center gap-4 shadow-xl hover:bg-blue-700 disabled:opacity-50 uppercase mt-4"
              >
                {isParsing ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="animate-spin" size={24} />
                    <span className="text-[10px] mt-1 font-bold">
                      {parsingMessage}
                    </span>
                  </div>
                ) : (
                  <Plus size={24} />
                )}
                Añadir Parada
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;