import React, { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, X, Truck, MapPin, Mic, Power } from 'lucide-react';
import MapView from './MapView';
import DeliveryCard from './DeliveryCard';
import { Delivery, DeliveryStatus, DeliveryType } from './types';
import { parseAddress } from './geminiService';

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

  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list'>(() => {
    const saved = safeGetItem(VIEW_MODE_KEY);
    return (saved as any) || 'split';
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // ESTADOS UNIFICADOS DEL FORM
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

  // Persistencia en localStorage
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

  // Geolocalización + SpeechRecognition
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
    if (isParsing || !unifiedInput.trim()) return;

    setIsParsing(true);
    setParsingMessage('Localizando destino...');

    try {
      const parsed = await parseAddress(
        unifiedInput,
        currentUserLoc,
        newCoordsInput.trim()
      );

      const newDelivery: Delivery = {
        id: Math.random().toString(36).substring(2, 9),
        concept: conceptInput.trim() || undefined,
        recipient: parsed.recipient,
        address: parsed.address,
        phone: newPhoneInput.trim() || parsed.phone || '',
        coordinates: [parsed.lat, parsed.lng],
        status: DeliveryStatus.PENDING,
        type: newType,
        sourceUrl: parsed.sourceUrl,
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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <Truck className="text-blue-600" size={24} />
          <h1 className="text-xl font-black tracking-tighter">
            LOGIROUTE <span className="text-blue-600">AI</span>
          </h1>
        </div>
        <div className="flex bg-slate-100 rounded-xl p-1">
          {['split', 'map', 'list'].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode as any)}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${
                viewMode === mode ? 'bg-white shadow text-blue-600' : 'text-slate-400'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {viewMode !== 'list' && (
          <section className="flex-1 relative">
            <MapView
              deliveries={deliveries}
              manualSequence={manualSequence}
              selectedId={selectedId}
              onMarkerClick={(id) => setSelectedId(id)}
              viewMode={viewMode}
            />
          </section>
        )}

        {viewMode !== 'map' && (
          <aside
            className={`${
              viewMode === 'split' ? 'w-[440px]' : 'w-full'
            } border-l bg-white overflow-y-auto p-4 space-y-3`}
          >
            {deliveries.map((d, index) => (
              <DeliveryCard
                key={d.id}
                delivery={d}
                isSelected={selectedId === d.id}
                onStatusChange={() => {}}
                onDelete={() => {}}
                onRemoveFromSequence={() => {}}
                onDragStart={() => {}}
                onDragOver={() => {}}
                onDragEnd={() => {}}
                index={index}
              />
            ))}
          </aside>
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
                  ¿A DÓNDE VAMOS? (NOMBRE Y/O DIRECCIÓN)
                </label>
                <div className="relative">
                  <MapPin
                    className="absolute left-4 top-5 text-slate-300"
                    size={20}
                  />
                  <textarea
                    value={unifiedInput}
                    onChange={(e) => setUnifiedInput(e.target.value)}
                    className="w-full h-32 pl-12 pr-14 py-5 border-2 border-slate-100 rounded-[30px] outline-none focus:border-blue-500 font-bold text-lg resize-none"
                    placeholder="Ej: Zapatillas Paredes Elche o Calle Mayor 10..."
                  />
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute right-4 bottom-4 p-4 rounded-2xl ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Mic size={20} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    CONCEPTO
                  </label>
                  <input
                    type="text"
                    value={conceptInput}
                    onChange={(e) => setConceptInput(e.target.value)}
                    className="w-full px-5 py-4 border-2 border-slate-100 rounded-2xl font-bold"
                    placeholder="Ej: Paquete 4"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    TELÉFONO
                  </label>
                  <input
                    type="tel"
                    value={newPhoneInput}
                    onChange={(e) => setNewPhoneInput(e.target.value)}
                    className="w-full px-5 py-4 border-2 border-slate-100 rounded-2xl font-bold"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isParsing || !unifiedInput.trim()}
                className="w-full py-6 bg-blue-600 text-white rounded-[30px] font-black text-xl shadow-xl flex items-center justify-center gap-4 uppercase"
              >
                {isParsing ? <Loader2 className="animate-spin" /> : <Plus size={24} />}
                {isParsing ? parsingMessage : 'Añadir Parada'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
