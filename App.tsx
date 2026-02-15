
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Map as MapIcon, List, BrainCircuit, Loader2, X, Navigation, LayoutGrid, LogOut, CheckCircle2, ArrowDownLeft, ArrowUpRight, Clock, AlertTriangle, Truck, Phone, RotateCcw, Settings2, BarChart3, Package, Archive, Mic, MapPin, Power, RefreshCcw, User, Tag } from 'lucide-react';
import DeliveryCard from './DeliveryCard';import { Delivery, DeliveryStatus, DeliveryType } from './types';
import { parseAddress, optimizeRoute, buildSearchQuery } from './geminiService';
import MapView from './MapView';
const STORAGE_KEY = 'logiroute_deliveries_v3';
const VIEW_MODE_KEY = 'logiroute_viewmode_v1';
const SEQUENCE_KEY = 'logiroute_sequence_v1';

const App: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [manualSequence, setManualSequence] = useState<string[]>(() => {
    const saved = localStorage.getItem(SEQUENCE_KEY);
    return saved ? JSON.parse(saved) : [];
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
  const [currentUserLoc, setCurrentUserLoc] = useState<{latitude: number, longitude: number} | undefined>(undefined);
  
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (isAppClosed) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries));
    localStorage.setItem(SEQUENCE_KEY, JSON.stringify(manualSequence));
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [deliveries, manualSequence, viewMode, isAppClosed]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentUserLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.warn("GPS no disponible:", err.message),
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
          setNewNameInput(prev => prev ? `${prev} ${transcript}` : transcript);
        } else if (activeMicField === 'address') {
          setNewAddressInput(prev => prev ? `${prev} ${transcript}` : transcript);
        }
        setIsListening(false);
        setActiveMicField(null);
      };

      recognition.onerror = () => { setIsListening(false); setActiveMicField(null); };
      recognition.onend = () => { setIsListening(false); setActiveMicField(null); };
      recognitionRef.current = recognition;
    }
  }, [activeMicField]);

  const toggleListening = (field: 'name' | 'address') => {
    if (!recognitionRef.current) {
      alert("Tu navegador no soporta reconocimiento de voz.");
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
    const address = newAddressInput.trim();
    const coords = newCoordsInput.trim();

    if (!name && !address && !coords) {
      alert("Introduce algún dato de búsqueda.");
      return;
    }

    // Check for potential duplicate in existing list before calling API
    const exists = deliveries.find(d => 
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
const queries = buildSearchQuery(name, address);
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
      
      setDeliveries(prev => [...prev, newDelivery]);
      
      // Cleanup
      setConceptInput('');
      setNewNameInput('');
      setNewAddressInput('');
      setNewPhoneInput('');
      setNewCoordsInput('');
      setIsAdding(false);
      setSelectedId(newDelivery.id);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  const handleClearAll = () => {
    if (window.confirm("¿BORRAR Y CERRAR? Se eliminarán todas las paradas.")) {
      setIsAppClosed(true);
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleStatusChange = (id: string, status: DeliveryStatus) => {
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    if (status === DeliveryStatus.COMPLETED || status === DeliveryStatus.ISSUE) {
      setManualSequence(prev => prev.filter(sid => sid !== id));
    }
  };

  const handleMarkerClick = (id: string) => {
    setSelectedId(id);
    setManualSequence(prev => {
      if (prev.includes(id)) return prev.filter(sid => sid !== id);
      return [...prev, id];
    });
  };

  const handleOptimize = async () => {
    const pending = deliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS);
    if (pending.length < 2) return;
    setIsOptimizing(true);
    try {
      const start = currentUserLoc ? `${currentUserLoc.latitude},${currentUserLoc.longitude}` : "Mi ubicación";
      const resultIds = await optimizeRoute(pending, start);
      setManualSequence(resultIds);
    } catch (e: any) {
      alert("No se pudo optimizar en este momento.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const getSortedDeliveries = () => {
    const active = deliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS);
    const orderedActive = manualSequence.map(id => active.find(p => p.id === id)).filter((p): p is Delivery => !!p);
    const unorderedActive = active.filter(p => !manualSequence.includes(p.id));
    const issues = deliveries.filter(d => d.status === DeliveryStatus.ISSUE);
    const completed = deliveries.filter(d => d.status === DeliveryStatus.COMPLETED);
    return [...orderedActive, ...unorderedActive, ...issues, ...completed];
  };

  if (isAppClosed) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-center p-6 z-[200]">
        <Power size={80} className="text-white mb-8 animate-pulse" />
        <h1 className="text-4xl font-black text-white mb-4 tracking-tighter uppercase">Sesión Finalizada</h1>
        <button onClick={() => window.location.reload()} className="bg-blue-600 text-white px-10 py-5 rounded-3xl font-black shadow-xl hover:bg-blue-700 transition-all flex items-center gap-4 uppercase">
          <RefreshCcw size={24} /> Nueva Jornada
        </button>
      </div>
    );
  }

  const allSortedDeliveries = getSortedDeliveries();
  const pendingCount = deliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.IN_PROGRESS).length;
  const completedDeliveries = deliveries.filter(d => d.status === DeliveryStatus.COMPLETED && d.type === DeliveryType.DELIVERY).length;
  const completedPickups = deliveries.filter(d => d.status === DeliveryStatus.COMPLETED && d.type === DeliveryType.PICKUP).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 relative">
      <header className="bg-white border-b px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between z-30 shadow-sm gap-2">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="bg-blue-600 p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-white shadow-md">
            <Truck size={18} />
          </div>
          <h1 className="text-lg sm:text-2xl font-black tracking-tighter text-slate-800">LogiRoute <span className="text-blue-600">AI</span></h1>
        </div>

        <div className="flex bg-slate-100 rounded-xl sm:rounded-2xl p-1 shadow-inner overflow-x-auto no-scrollbar">
          {['list', 'map', 'split', 'control'].map((mode) => (
            <button 
              key={mode} 
              onClick={() => setViewMode(mode as any)} 
              className={`px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black tracking-tighter transition-all whitespace-nowrap ${viewMode === mode ? 'bg-white shadow-md text-blue-600' : 'text-slate-400'}`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white p-2 sm:px-5 sm:py-3 rounded-xl flex items-center gap-2 font-black shadow-lg hover:bg-blue-700 transition-all text-[10px] shrink-0 uppercase">
          <Plus size={16} /> <span className="hidden md:inline">Nueva Parada</span>
        </button>
      </header>

      <main className={`flex-1 flex overflow-hidden ${viewMode === 'split' ? 'flex-col md:flex-row' : 'flex-row'}`}>
        {viewMode === 'control' ? (
          <div className="flex-1 p-6 md:p-12 overflow-y-auto bg-slate-50">
             <div className="max-w-5xl mx-auto space-y-10">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <h2 className="text-4xl font-black text-slate-800 tracking-tighter uppercase">Panel de Control</h2>
                <button onClick={handleClearAll} className="bg-red-600 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-red-700 transition-all uppercase">
                  <LogOut size={20} /> Cerrar Sesión
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <Package size={32} className="text-green-500 mb-4" />
                  <span className="text-5xl font-black text-slate-800">{completedDeliveries + completedPickups}</span>
                  <div className="flex gap-6 mt-4 mb-2">
                    <div className="flex flex-col items-center">
                      <span className="text-xl font-black text-blue-600">{completedDeliveries}</span>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Entregas</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-xl font-black text-red-600">{completedPickups}</span>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Recogidas</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <AlertTriangle size={32} className="text-yellow-500 mb-4" />
                  <span className="text-5xl font-black text-slate-800">{deliveries.filter(d => d.status === DeliveryStatus.ISSUE).length}</span>
                  <p className="text-[10px] font-black text-slate-400 uppercase mt-2">Incidencias</p>
                </div>
                <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-xl flex flex-col items-center">
                  <Clock size={32} className="text-blue-500 mb-4" />
                  <span className="text-5xl font-black text-slate-800">{pendingCount}</span>
                  <p className="text-[10px] font-black text-slate-400 uppercase mt-2">Pendientes</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <aside className={`
              ${viewMode === 'map' ? 'hidden' : ''} 
              ${viewMode === 'list' ? 'w-full' : ''} 
              ${viewMode === 'split' ? 'w-full md:w-[440px] h-1/2 md:h-full' : ''}
              border-r bg-white flex flex-col overflow-hidden shadow-2xl z-20 transition-all
            `}>
              <div className="p-5 bg-slate-50 border-b flex justify-between items-center">
                <div className="flex flex-col">
                  <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-400">Hoja de Ruta</h2>
                  <span className="text-[10px] text-blue-500 font-bold uppercase">{pendingCount} pendientes</span>
                </div>
                <button onClick={handleOptimize} disabled={isOptimizing || pendingCount < 2} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 hover:bg-blue-700 disabled:opacity-30 transition-all shadow-lg">
                  {isOptimizing ? <Loader2 size={12} className="animate-spin" /> : <BrainCircuit size={14} />} OPTIMIZAR
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {allSortedDeliveries.map((d) => (
                  <DeliveryCard 
                    key={d.id} 
                    index={manualSequence.indexOf(d.id)} 
                    delivery={d} 
                    isSelected={selectedId === d.id} 
                    onClick={() => setSelectedId(d.id)} 
                    onStatusChange={handleStatusChange} 
                    onDelete={(id) => setDeliveries(prev => prev.filter(x => x.id !== id))} 
                    onRemoveFromSequence={(id) => setManualSequence(prev => prev.filter(x => x !== id))}
                    onDragStart={() => {}} onDragOver={() => {}} onDragEnd={() => {}}
                  />
                ))}
              </div>
            </aside>
            <section className={`
              ${viewMode === 'list' ? 'hidden' : ''} 
              ${viewMode === 'map' ? 'flex-1' : ''} 
              ${viewMode === 'split' ? 'flex-1 h-1/2 md:h-full' : ''}
              relative transition-all
            `}>
              <MapView 
                deliveries={deliveries} 
                manualSequence={manualSequence} 
                selectedId={selectedId} 
                onMarkerClick={handleMarkerClick} 
                viewMode={viewMode} 
              />
            </section>
          </>
        )}
      </main>

      <button onClick={() => setIsAdding(true)} className="fixed bottom-6 right-6 w-16 h-16 bg-blue-600 text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all z-40">
        <Plus size={32} />
      </button>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50/40">
              <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Nueva Parada</h3>
              <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-slate-200 rounded-xl"><X size={24} /></button>
            </div>
            <form onSubmit={handleAddDelivery} className="p-8 space-y-5 overflow-y-auto no-scrollbar">
              <div className="flex bg-slate-100 p-1.5 rounded-3xl">
                <button type="button" onClick={() => setNewType(DeliveryType.DELIVERY)} className={`flex-1 py-3 rounded-2xl text-[10px] font-black transition-all ${newType === DeliveryType.DELIVERY ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>ENTREGA</button>
                <button type="button" onClick={() => setNewType(DeliveryType.PICKUP)} className={`flex-1 py-3 rounded-2xl text-[10px] font-black transition-all ${newType === DeliveryType.PICKUP ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400'}`}>RECOGIDA</button>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Concepto (Ej: Paquete 4)</label>
                <div className="relative">
                  <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                  <input type="text" value={conceptInput} onChange={(e) => setConceptInput(e.target.value)} className="w-full pl-12 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Nombre / Comercio</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                  <input type="text" value={newNameInput} onChange={(e) => setNewNameInput(e.target.value)} className="w-full pl-12 pr-14 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold" placeholder="Ej: Pacal Shoes Elche" />
                  <button type="button" onClick={() => toggleListening('name')} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-xl ${isListening && activeMicField === 'name' ? 'bg-red-500 text-white animate-pulse' : 'text-slate-300'}`}><Mic size={18} /></button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Dirección o Referencia</label>
                <div className="relative">
                  <textarea value={newAddressInput} onChange={(e) => setNewAddressInput(e.target.value)} className="w-full h-20 p-6 border-2 border-slate-100 rounded-[30px] outline-none focus:border-blue-500 font-medium resize-none" placeholder="Opcional..." />
                  <button type="button" onClick={() => toggleListening('address')} className={`absolute right-4 bottom-4 p-4 rounded-2xl ${isListening && activeMicField === 'address' ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-400'}`}><Mic size={20} /></button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Teléfono</label>
                  <div className="relative"><Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} /><input type="tel" value={newPhoneInput} onChange={(e) => setNewPhoneInput(e.target.value)} className="w-full pl-10 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs" /></div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Coordenadas / Plus Code</label>
                  <div className="relative"><MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} /><input type="text" value={newCoordsInput} onChange={(e) => setNewCoordsInput(e.target.value)} className="w-full pl-10 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs" /></div>
                </div>
              </div>
              
              <button type="submit" disabled={isParsing || (!newNameInput.trim() && !newAddressInput.trim() && !newCoordsInput.trim())} className="w-full py-5 bg-blue-600 text-white rounded-[30px] font-black text-lg flex justify-center items-center gap-4 shadow-xl hover:bg-blue-700 disabled:opacity-50 uppercase mt-4">
                {isParsing ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="animate-spin" size={24} />
                    <span className="text-[10px] mt-1 font-bold">{parsingMessage}</span>
                  </div>
                ) : <Plus size={24} />} 
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
