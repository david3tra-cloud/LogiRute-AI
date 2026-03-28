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

  // SENSORES dnd-kit mejorados para móvil
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
    // ...todo el JSX que ya tienes a partir de aquí igual...
    // (no he tocado nada del layout ni del resto del componente)
    // pega desde tu return original hacia abajo.
  );
};

export default App;