
import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Map as MapIcon,
  List,
  BrainCircuit,
  Loader2,
  X,
  Navigation,
  LayoutGrid,
  LogOut,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  Truck,
  Phone,
  RotateCcw,
  Settings2,
  BarChart3,
  Package,
  Archive,
  Mic,
  MapPin,
  Power,
  RefreshCcw,
  User,
  Tag,
} from 'lucide-react';
import DeliveryCard from './DeliveryCard';
import { Delivery, DeliveryStatus, DeliveryType } from './types';
import { parseAddress, optimizeRoute, buildSearchQuery } from './geminiService';
import MapView from './MapView';

const STORAGE_KEY = 'logiroute_deliveries_v3';
const VIEW_MODE_KEY = 'logiroute_viewmode_v1';
const SEQUENCE_KEY = 'logiroute_sequence_v1';

const safeParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const App: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return safeParse<Delivery[]>(saved, []);
  });

  const [manualSequence, setManualSequence] = useState<string[]>(() => {
    const saved = localStorage.getItem(SEQUENCE_KEY);
    return safeParse<string[]>(saved, []);
  });

  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list' | 'control'>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return (saved as any) || 'split';
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [conceptInput, setConceptInput] = useState('');
  const [newNameInput, setNewNameInput] = useState('');
  const [newAddressInput, setNewAddressInput] = useState('');
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [newCoordsInput, setNewCoordsInput] = useState('');

  const [newType, setNewType] = useState<DeliveryType>(DeliveryType.DELIVERY);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsingMessage, setParsingMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [activeMicField, setActiveMicField] = useState<'name' | 'address' | null>(null);
  const [isAppClosed, setIsAppClosed] = useState(false);
  const [currentUserLoc, setCurrentUserLoc] = useState<{ latitude: number; longitude: number } | undefined>(
    undefined
  );

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (isAppClosed) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries));
      localStorage.setItem(SEQUENCE_KEY, JSON.stringify(manualSequence));
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch (e) {
      console.warn('No se pudo guardar en localStorage', e);
    }
  }, [deliveries, manualSequence, viewMode, isAppClosed]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentUserLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.warn('GPS no disponible:', err.message),
        { enableHighAccuracy: true }
      );
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-ES';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (activeMicField === 'name') {
          setNewNameInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        } else if (activeMicField === 'address') {
          setNewAddressInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
        setActiveMicField(null);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setActiveMicField(null);
      };
      recognition.onend = () => {
        setIsListening(false);
        setActiveMicField(null);
      };
      recognitionRef.current = recognition;
    }
  }, [activeMicField]);

  const toggleListening = (field: 'name' | 'address') => {
    if (!recognitionRef.current) {
      alert('Tu navegador no soporta reconocimiento de voz.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setActiveMicField(field);
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  const handleAddDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isParsing) return;

    const name = newNameInput.trim();
    let address = newAddressInput.trim();
    const coords = newCoordsInput.trim();

    if (!name && !address && !coords) {
      alert('Introduce algún dato de búsqueda.');
      return;
    }

    if (!address && name) {
      address = name;
    }

    const baseContext = 'Elx, Comunitat Valenciana, España';
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
    setParsingMessage('Búsqueda inteligente...');

    try {
      const queries = buildSearchQuery(name, fullAddress);
      const searchQuery = queries[0];
      const parsed = await parseAddress(searchQuery, currentUserLoc, coords, (msg) => setParsingMessage(msg));

      const newDelivery: Delivery = {
        id: Math.random().toString(36).substring(2, 9),
        concept: conceptInput.trim() || undefined,
        recipient: name || parsed.recipient,
        address: parsed.address,
        phone: newPhoneInput.trim() || parsed.phone || '',
        coordinates: [parsed.lat, parsed.lng],
        status: DeliveryStatus.PENDING,
        type: newType,
        sourceUrl: parsed.sourceUrl,
        estimatedTime: `~${Math.floor(Math.random() * 3) + 1} h`,
      };

      console.log('Nueva parada creada', {
        input: { name, fullAddress, coords },
        parsed,
        savedCoordinates: newDelivery.coordinates,
      });

      setDeliveries((prev) => [...prev, newDelivery]);

      setConceptInput('');
      setNewNameInput('');
      setNewAddressInput('');
      setNewPhoneInput('');
      setNewCoordsInput('');
      setIsAdding(false);
      setSelectedId(newDelivery.id);
    } catch (error: any) {
      console.error('Error al añadir parada', error);
      const msg =
        (error && error.message) ||
        'No se pudo interpretar la dirección. Intenta ser más específico o añade coordenadas.';
      alert(msg);
    } finally {
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  const handleClearAll = () => {
    if (window.confirm('¿BORRAR Y CERRAR? Se eliminarán todas las paradas.')) {
      setIsAppClosed(true);
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleStatusChange = (id: string, status: DeliveryStatus) => {
    setDeliveries((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    if (status === DeliveryStatus.COMPLETED || status === DeliveryStatus.ISSUE) {
      setManualSequence((prev) => prev.filter((sid) => sid !== id));
    }
  };

  const handleMarkerClick = (id: string) => {
    setSelectedId(id);
    setManualSequence((prev) => {
      if (prev.includes(id)) return prev.filter((sid) => sid !== id);
      return [...prev, id];
    });
  };

  const handleOptimize = async () => {
    const pending = deliveries.filter(
      (d) => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS
    );
    if (pending.length < 2) return;
    setIsOptimizing(true);
    try {
      const start = currentUserLoc ? `${currentUserLoc.latitude},${currentUserLoc.longitude}` : 'Mi ubicación';
      const resultIds = await optimizeRoute(pending, start);
      setManualSequence(resultIds);
    } catch (e: any) {
      alert('No se pudo optimizar en este momento.');
    } finally {
      setIsOptimizing(false);
    }
  };

  const getSortedDeliveries = () => {
    const active = deliveries.filter(
      (d) => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS
    );
    const orderedActive = manualSequence
      .map((id) => active.find((p) => p.id === id))
      .filter((p): p is Delivery => !!p);
    const unorderedActive = active.filter((p) => !manualSequence.includes(p.id));
    const issues = deliveries.filter((d) => d.status === DeliveryStatus.ISSUE);
    const completed = deliveries.filter((d) => d.status === DeliveryStatus.COMPLETED);
    return [...orderedActive, ...unorderedActive, ...issues, ...completed];
  };

  if (isAppClosed) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-center p-6 z-[200]">
        <Power size={80} className="text-white mb-8 animate-pulse" />
        <h1 className="text-4xl font-black text-white mb-4 tracking-tighter uppercase">Sesión Finalizada</h1>
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white px-10 py-5 rounded-3xl font-black shadow-xl hover:bg-blue-700 transition-all flex items-center gap-4 uppercase"
        >
          <RefreshCcw size={24} /> Nueva Jornada
        </button>
      </div>
    );
  }

  const allSortedDeliveries = getSortedDeliveries();
  const pendingCount = deliveries.filter(
    (d) => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS
  ).length;
  const completedDeliveries = deliveries.filter(
    (d) => d.status === DeliveryStatus.COMPLETED && d.type === DeliveryType.DELIVERY
  ).length;
  const completedPickups = deliveries.filter(
    (d) => d.status === DeliveryStatus.COMPLETED && d.type === DeliveryType.PICKUP
  ).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 relative">
      {/* header y resto igual que antes */}
      {/* ... (puedes mantener todo lo que ya tenías desde aquí hacia abajo sin cambios) */}
      {/* Para ahorrar espacio, no repito el JSX de header, main, modal, etc.,
          ya que no hemos tocado esa parte. Solo sustituye hasta el return de arriba
          y pega tu JSX original a partir del <header> si prefieres. */}
    </div>
  );
};

export default App;
