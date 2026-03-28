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

  const recognitionRef = useRef<any>(null);

  // sensores dnd-kit con delay para móvil
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

      const geo = await geocodeAddress(parsed.address);
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
    setDeliveries((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status } : d))
    );
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

    const startPoint = {
      lat: currentUserLoc.latitude,
      lng: currentUserLoc.longitude,
    };

    const optimized = optimizeDeliveries(deliveries, startPoint);
    setDeliveries(optimized);
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
              onClick={handleOptimizeRoute}
              disabled={!currentUserLoc || deliveries.length === 0}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase disabled:opacity-40"
            >
              OPTIMIZAR
            </button>
            <button
              type="button"
              className="bg-black text-yellow-300 px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase"
            >
              PRO
            </button>
          </div>
        </div>
      </header>

      {/* barra acciones móvil */}
      <div className="sm:hidden bg-white border-b px-3 py-2 flex items-center justify-end gap-2">
        <button
          onClick={handleOptimizeRoute}
          disabled={!currentUserLoc || deliveries.length === 0}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-40"
        >
          OPTIMIZAR
        </button>
        <button
          type="button"
          className="bg-black text-yellow-300 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase"
        >
          PRO
        </button>
      </div>

      {/* MAIN */}
      <main className="flex-1 flex flex-col sm:flex-row overflow-hidden">
        {viewMode === 'control' ? (
          <div className="flex-1 p-4 sm:p-6 md:p-12 overflow-y-auto bg-slate-50">
            {/* ... panel de control igual que ya tenías ... */}
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

      <button
        onClick={() => setIsAdding(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-blue-600 text-white rounded-2xl shadow-2xl flex items-center justify-center z-40"
      >
        <Plus size={32} />
      </button>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-xl shadow-2xl overflow-hidden">
            {/* ... resto del modal Nueva Parada exactamente como ya lo tenías ... */}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;