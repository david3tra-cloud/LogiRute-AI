import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from "react";
import { useAppNavigation } from "./useAppNavigation";
import { AppModule } from "./navigationHistory";
import {
  Plus,
  Loader2,
  X,
  Truck,
  MapPin,
  Mic,
  Power,
  LogOut,
  Phone,
  Tag,
  Map,
  FileText,
  Receipt,
  Download,
  Lock,
  Unlock,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import MapView from "./MapView";
import DeliveryCard from "./DeliveryCard";
import Auth from "./lib/Auth";
import { supabase } from "./lib/supabase";
import {
  AddDeCAToRoutesResult,
  DeCA,
  Delivery,
  DeliveryStatus,
  DeliveryType,
} from "./types";
import DeCASection from "./DeCASection";
import BillingSection from "./BillingSection";
import { geocodeAddress } from "./geocodingService";
import { optimizeDeliveries } from "./routeService";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import {
  extractDestinationFromMapsUrl,
  isGoogleMapsUrl,
  isMapsShortUrl,
  resolveGoogleMapsUrl,
  validateMapsUrl,
} from "./mapsUrlService";
import { userStorageKey } from "./destinatariosService";
import { RouteCloudPanel } from "./RouteCloudPanel";
import { loadRouteSnapshot, saveRouteSnapshot } from "./routeSnapshotStorage";
import { computeRouteFingerprint } from "./registroJornadasService";
import type { RemoteRoute } from "./rutasSupabaseService";
import { RegistroNubeModal as RegistroModal } from "./RegistroNubeModal";
import { parseLecturaKm, validateLecturasKm } from "./jornadaMetricas.mjs";
import { RouteCsvImportModal } from "./RouteCsvImportModal";
import {
  appendImportedRouteStops,
  type RouteCsvRow,
} from "./routeCsvService";

const STORAGE_KEY = "logiroute_deliveries_v3";
const VIEW_MODE_KEY = "logiroute_viewmode_v1";
const SEQUENCE_KEY = "logiroute_sequence_v1";
const PASSWORD_RECOVERY_PENDING_STORAGE_KEY =
  "logiroute_password_recovery_pending_v1";

type ParsedLocationInput =
  | { kind: "empty" }
  | { kind: "coordinates"; value: [number, number] }
  | { kind: "plus-code"; value: string }
  | { kind: "maps-short-url"; url: string }
  | { kind: "maps-long-url"; url: string; coordinates: [number, number] }
  | { kind: "invalid"; message: string };

const parseLocationInput = (input: string): ParsedLocationInput => {
  const value = input.trim();
  if (!value) return { kind: "empty" };

  const coordinateMatch = value.match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/,
  );
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lng = Number(coordinateMatch[2]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return { kind: "coordinates", value: [lat, lng] };
    }
    return {
      kind: "invalid",
      message:
        "Las coordenadas deben estar dentro de los rangos válidos: latitud -90 a 90 y longitud -180 a 180.",
    };
  }

  const plusCodeMatch = value.match(/^([A-Z0-9]+\+[A-Z0-9]+)(?:\s+(.+))?$/i);
  if (plusCodeMatch) {
    const code = plusCodeMatch[1].toUpperCase();
    const locality = plusCodeMatch[2]?.trim();
    const [prefix, suffix] = code.split("+");
    const separatorPosition = prefix.length;
    const validSeparator = [2, 4, 6, 8].includes(separatorPosition);
    const validPrefix =
      /^[23456789CFGHJMPQRVWX]+$/i.test(prefix) ||
      (separatorPosition === 8 &&
        /^([23456789CFGHJMPQRVWX]{2,})(0{2}|0{4}|0{6})$/i.test(prefix));
    const validSuffix =
      suffix.length >= 2 &&
      suffix.length <= 7 &&
      /^[23456789CFGHJMPQRVWX]+$/i.test(suffix);
    const isFullCode = separatorPosition === 8;

    if (
      !validSeparator ||
      !validPrefix ||
      !validSuffix ||
      (!isFullCode && !locality)
    ) {
      return {
        kind: "invalid",
        message: isFullCode
          ? "El Plus Code no tiene un formato válido."
          : "Introduce un Plus Code válido y añade la localidad si es corto.",
      };
    }

    return {
      kind: "plus-code",
      value: locality ? `${code} ${locality}` : code,
    };
  }

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    /^maps\.app\.goo\.gl/i.test(value) ||
    isGoogleMapsUrl(value)
  ) {
    try {
      const validated = validateMapsUrl(value);
      const normalizedUrl = validated.toString();
      if (isMapsShortUrl(normalizedUrl)) {
        return { kind: "maps-short-url", url: normalizedUrl };
      }
      const dest = extractDestinationFromMapsUrl(normalizedUrl);
      if (dest.kind === "coordinates") {
        return {
          kind: "maps-long-url",
          url: normalizedUrl,
          coordinates: dest.coordinates,
        };
      }
      return { kind: "invalid", message: dest.message };
    } catch (err) {
      return {
        kind: "invalid",
        message:
          err instanceof Error
            ? err.message
            : "Enlace de Google Maps no válido.",
      };
    }
  }

  return {
    kind: "invalid",
    message:
      "Introduce coordenadas como latitud, longitud, un Plus Code válido o un enlace de Google Maps.",
  };
};

const isValidCoordinates = (
  lat: number,
  lng: number,
): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

const formatCoordinate = (value: number): string => {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;

  const [coefficient, exponentText] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsignedCoefficient = sign ? coefficient.slice(1) : coefficient;
  const decimalPosition =
    (unsignedCoefficient.indexOf(".") < 0
      ? unsignedCoefficient.length
      : unsignedCoefficient.indexOf(".")) + exponent;
  const digits = unsignedCoefficient.replace(".", "");

  if (decimalPosition <= 0) {
    return `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

const PWA_INSTALL_DISMISSED_KEY = "logiroute_pwa_install_dismissed_at_v1";
const PWA_INSTALL_DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const getPwaInstallDismissedAt = () => {
  try {
    const value = localStorage.getItem(PWA_INSTALL_DISMISSED_KEY);
    if (value === null) return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
};

const isPwaInstallDismissedRecently = () => {
  const dismissedAt = getPwaInstallDismissedAt();
  const elapsed = dismissedAt === null ? -1 : Date.now() - dismissedAt;
  return elapsed >= 0 && elapsed < PWA_INSTALL_DISMISS_DURATION_MS;
};

const detectPwaInstalled = () => {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia?.(
    "(display-mode: standalone)",
  ).matches;
  const isIosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(isStandalone || isIosStandalone);
};

const isSafariOnIos = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent;
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/i.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser)/i.test(userAgent);
  return isIosDevice && isSafari;
};

const safeGetItem = (key: string) => {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// Almacenamiento de la jornada (paradas y secuencia) con ámbito por usuario.
// Las claves globales heredadas no se leen ni se escriben: quedan como
// reserva intocada hasta decidir su recuperación.
export const deliveriesStorageKey = (userId?: string) =>
  userStorageKey(STORAGE_KEY, userId);

export const sequenceStorageKey = (userId?: string) =>
  userStorageKey(SEQUENCE_KEY, userId);

export const loadDeliveriesForUser = (userId?: string): Delivery[] => {
  if (!userId) return [];
  try {
    const saved = safeGetItem(deliveriesStorageKey(userId));
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? (parsed as Delivery[]) : [];
  } catch {
    return [];
  }
};

export const loadSequenceForUser = (userId?: string): string[] => {
  if (!userId) return [];
  try {
    const saved = safeGetItem(sequenceStorageKey(userId));
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

export const persistUserScopedJornada = (
  userId: string,
  userDeliveries: Delivery[],
  userSequence: string[],
): boolean => {
  const delivKey = deliveriesStorageKey(userId);
  const seqKey = sequenceStorageKey(userId);
  const backupDeliveries = safeGetItem(delivKey);

  try {
    localStorage.setItem(delivKey, JSON.stringify(userDeliveries));
  } catch {
    return false;
  }

  try {
    localStorage.setItem(seqKey, JSON.stringify(userSequence));
    return true;
  } catch {
    try {
      if (backupDeliveries !== null) {
        localStorage.setItem(delivKey, backupDeliveries);
      } else {
        localStorage.removeItem(delivKey);
      }
    } catch {
      // ignorar fallo de rollback
    }
    return false;
  }
};

export const persistUserScopedJornadaWithRollback = (
  userId: string,
  userDeliveries: Delivery[],
  userSequence: string[],
): { ok: boolean; rollbackOk: boolean } => {
  const delivKey = deliveriesStorageKey(userId);
  const seqKey = sequenceStorageKey(userId);
  const backupDeliveries = safeGetItem(delivKey);

  try {
    localStorage.setItem(delivKey, JSON.stringify(userDeliveries));
  } catch {
    return { ok: false, rollbackOk: true }; // Nada mutó
  }

  try {
    localStorage.setItem(seqKey, JSON.stringify(userSequence));
    return { ok: true, rollbackOk: true };
  } catch {
    // Falló la segunda escritura; intentar restaurar la primera
    try {
      if (backupDeliveries !== null) {
        localStorage.setItem(delivKey, backupDeliveries);
      } else {
        localStorage.removeItem(delivKey);
      }
      return { ok: false, rollbackOk: true };
    } catch {
      // El rollback también falló (ej. almacenamiento saturado o bloqueado)
      return { ok: false, rollbackOk: false };
    }
  }
};

// Gate de persistencia: solo se escribe la jornada cuando el estado en
// memoria pertenece ya al usuario autenticado (hidratación completada),
// de forma que durante un cambio de sesión nunca se escriben los datos
// de A bajo la clave de B.
export const canPersistForCurrentSession = (
  currentUser: { id: string } | null,
  hydratedUserId: string | null,
): boolean => Boolean(currentUser && hydratedUserId === currentUser.id);

const hasPasswordRecoveryPending = () => {
  try {
    return (
      window.sessionStorage.getItem(
        PASSWORD_RECOVERY_PENDING_STORAGE_KEY,
      ) === "1"
    );
  } catch {
    return false;
  }
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(
    hasPasswordRecoveryPending,
  );
  const decaBusyRef = useRef(false);
  const isNavigationBusy = useCallback(() => {
    return (
      deliverySaveInProgressRef.current ||
      mapsResolutionInProgressRef.current ||
      csvImportInProgressRef.current ||
      isClosingJornadaRef.current ||
      decaBusyRef.current
    );
  }, []);

  const {
    navState,
    navigateTo,
    openModal,
    closeModal,
    goBack,
    normalize,
    closeManager,
    onSignOutReset,
  } = useAppNavigation({
    currentUserId: user?.id ?? null,
    isAuthLoading,
    isBusy: isNavigationBusy,
    onNotice: (msg) => setRouteNotice(msg),
  });

  const activeModule = navState.module;
  const isRegistroOpen = navState.modal === "registro";
  const isCsvImportOpen = navState.modal === "csvRoute";
  const isAdding = navState.modal === "addDelivery";
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);
  const [isInstallDismissedRecently, setIsInstallDismissedRecently] =
    useState(false);
  const [isSafariIos, setIsSafariIos] = useState(false);
  const [isInstallPrompting, setIsInstallPrompting] = useState(false);
  const [isInstallAccepted, setIsInstallAccepted] = useState(false);
  const [isInstallPromptDeclined, setIsInstallPromptDeclined] =
    useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const deliveriesRef = useRef(deliveries);
  deliveriesRef.current = deliveries;
  const importingDeCAIdsRef = useRef(new Set<string>());
  const csvImportInProgressRef = useRef(false);

  const [manualSequence, setManualSequence] = useState<string[]>([]);
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null);
  const hydratedUserIdRef = useRef(hydratedUserId);
  hydratedUserIdRef.current = hydratedUserId;
  const [routeStorageError, setRouteStorageError] = useState<string | null>(null);
  const [kilometrajeInicial, setKilometrajeInicial] = useState("");
  const [kilometrajeFinal, setKilometrajeFinal] = useState("");
  const [kilometrajeAsociacionPendiente, setKilometrajeAsociacionPendiente] = useState(false);
  const [kilometrajeNotice, setKilometrajeNotice] = useState("");
  const kilometrajeInicialRef = useRef<HTMLInputElement>(null);
  const kilometrajeFinalRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<
    "split" | "map" | "list" | "control"
  >(() => {
    const saved = safeGetItem(VIEW_MODE_KEY);
    return (saved as any) || "split";
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [editingLocked, setEditingLocked] = useState(false);
  const editingLockedRef = useRef(false);

  // La ref se sincroniza en un layout effect (antes de los efectos pasivos
  // de MapView); nunca se escribe ref.current durante el render.
  useLayoutEffect(() => {
    editingLockedRef.current = editingLocked;
  }, [editingLocked]);

  const [conceptInput, setConceptInput] = useState("");
  const [unifiedInput, setUnifiedInput] = useState("");
  const [editAddressInput, setEditAddressInput] = useState("");
  const [newPhoneInput, setNewPhoneInput] = useState("");
  const [newCoordsInput, setNewCoordsInput] = useState("");
  const [editNotesInput, setEditNotesInput] = useState("");
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [isResolvingMapsUrl, setIsResolvingMapsUrl] = useState(false);
  const [mapsSourceUrl, setMapsSourceUrl] = useState<string | undefined>();

  const [newType, setNewType] = useState<DeliveryType>(DeliveryType.DELIVERY);
  const [isParsing, setIsParsing] = useState(false);
  const deliverySaveInProgressRef = useRef(false);
  const mapsResolveRequestRef = useRef(0);
  const mapsResolutionInProgressRef = useRef(false);
  const initialLocationInputRef = useRef("");
  const [parsingMessage, setParsingMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isAppClosed, setIsAppClosed] = useState(false);
  const isAppClosedRef = useRef(isAppClosed);
  isAppClosedRef.current = isAppClosed;
  const [isClosingJornada, setIsClosingJornada] = useState(false);
  const isClosingJornadaRef = useRef(false);
  const cloudCloseRef = useRef<(() => Promise<void>) | null>(null);
  const sessionUserRef = useRef<string | null>(null);
  sessionUserRef.current = user?.id ?? null;
  const routeContextVersionRef = useRef(0);
  useLayoutEffect(() => {
    routeContextVersionRef.current += 1;
  }, [user?.id, hydratedUserId]);
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
    }),
  );

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(
      ({ data: { session } }) => {
        if (!isMounted) return;
        setUser(session?.user ?? null);
        setIsAuthLoading(false);
      },
      () => {
        if (isMounted) setIsAuthLoading(false);
      },
    );

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryPending(true);
      }
      if (event === "SIGNED_OUT") {
        setPasswordRecoveryPending(false);
        onSignOutReset();
      }
      setUser(session?.user ?? null);
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const updateInstalledState = () =>
      setIsPwaInstalled(detectPwaInstalled());
    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      if (detectPwaInstalled()) {
        setIsPwaInstalled(true);
        return;
      }
      if (isPwaInstallDismissedRecently()) {
        setIsInstallDismissedRecently(true);
        return;
      }
      setIsInstallDismissedRecently(false);
      setIsInstallAccepted(false);
      setIsInstallPromptDeclined(false);
      setInstallError(null);
      setDeferredInstallPrompt(installEvent);
    };
    const handleAppInstalled = () => {
      setIsPwaInstalled(true);
      setDeferredInstallPrompt(null);
      setIsInstallAccepted(false);
      setIsInstallPromptDeclined(false);
      setIsInstallDismissedRecently(false);
      try {
        localStorage.removeItem(PWA_INSTALL_DISMISSED_KEY);
      } catch {
        // El almacenamiento es opcional para ocultar el aviso.
      }
    };

    updateInstalledState();
    setIsSafariIos(isSafariOnIos());
    setIsInstallDismissedRecently(isPwaInstallDismissedRecently());
    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt,
    );
    window.addEventListener("appinstalled", handleAppInstalled);
    window.matchMedia("(display-mode: standalone)").addEventListener(
      "change",
      updateInstalledState,
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      window
        .matchMedia("(display-mode: standalone)")
        .removeEventListener("change", updateInstalledState);
    };
  }, []);

  // Hidratación por usuario: al cambiar o cerrar sesión se vacía primero el
  // estado en memoria y se recarga desde la clave del nuevo usuario. Los
  // guards de respuestas antiguas viven en el gate de persistencia y en el
  // key por usuario del montaje de DeCASection.
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setDeliveries([]);
      setManualSequence([]);
      setKilometrajeInicial("");
      setKilometrajeFinal("");
      setKilometrajeAsociacionPendiente(false);
      setKilometrajeNotice("");
      setHydratedUserId(null);
      return;
    }
    try {
      const snapshot = loadRouteSnapshot(userId, () => ({
        deliveries: JSON.parse(localStorage.getItem(deliveriesStorageKey(userId)) ?? "[]"),
        sequence: JSON.parse(localStorage.getItem(sequenceStorageKey(userId)) ?? "[]"),
      }));
      setDeliveries(snapshot.deliveries);
      setManualSequence(snapshot.sequence);
      setKilometrajeInicial(snapshot.kilometrajeInicial ?? "");
      setKilometrajeFinal(snapshot.kilometrajeFinal ?? "");
      setKilometrajeAsociacionPendiente(snapshot.kilometrajeAsociacionPendiente ?? false);
      setKilometrajeNotice("");
      setRouteStorageError(null);
      setHydratedUserId(userId);
    } catch (error) {
      setDeliveries([]);
      setManualSequence([]);
      setHydratedUserId(null);
      setRouteStorageError(`No se pudo recuperar la ruta local: ${error instanceof Error ? error.message : String(error)}. No borres el almacenamiento.`);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isAppClosed) return;
    try {
      // Los datos de paradas y secuencia solo se persisten bajo la clave del
      // usuario autenticado y cuando el estado en memoria corresponde ya a su
      // hidratación; así nunca se escribe el estado de A bajo la clave de B.
      if (user && canPersistForCurrentSession(user, hydratedUserId)) {
        const ok = saveRouteSnapshot(user.id, deliveries, manualSequence, {
          kilometrajeInicial,
          kilometrajeFinal,
          kilometrajeAsociacionPendiente,
        });
        setRouteStorageError(ok ? null : "No se pudo guardar la ruta local. Conserva la aplicación abierta y revisa el almacenamiento antes de continuar.");
      }
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // ignorar errores de storage
    }
  }, [deliveries, manualSequence, viewMode, isAppClosed, user, hydratedUserId, kilometrajeInicial, kilometrajeFinal, kilometrajeAsociacionPendiente]);

  const handleKilometrajeChange = (kind: "inicial" | "final", value: string) => {
    setKilometrajeNotice("");
    if (kind === "inicial") setKilometrajeInicial(value);
    else setKilometrajeFinal(value);
  };

  const confirmKilometrajeLocal = () => {
    if (user?.id && hydratedUserId === user.id) setKilometrajeNotice("Lecturas guardadas en este dispositivo. Se asociarán al ID de jornada al confirmar el cierre en nube.");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setCurrentUserLoc({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        (err) => console.warn("GPS no disponible:", err.message),
        { enableHighAccuracy: true },
      );
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "es-ES";
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
      alert("Tu navegador no soporta dictado de voz.");
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      setIsListening(true);
      recognition.start();
    }
  };

  const handleSignOut = async () => {
    onSignOutReset();
    const { error } = await supabase.auth.signOut();
    if (error) alert("No se pudo cerrar la sesión. Inténtalo de nuevo.");
  };

  const invalidateMapsResolution = () => {
    mapsResolveRequestRef.current++;
    mapsResolutionInProgressRef.current = false;
    setIsResolvingMapsUrl(false);
    setMapsSourceUrl(undefined);
  };

  const openAddDelivery = () => {
    invalidateMapsResolution();
    setEditingDelivery(null);
    setConceptInput("");
    setUnifiedInput("");
    setEditAddressInput("");
    setNewPhoneInput("");
    setNewCoordsInput("");
    initialLocationInputRef.current = "";
    setEditNotesInput("");
    setNewType(DeliveryType.DELIVERY);
    setRouteNotice(null);
    openModal("addDelivery");
  };

  const openEditDelivery = (delivery: Delivery) => {
    if (editingLockedRef.current) return;
    invalidateMapsResolution();
    setEditingDelivery(delivery);
    setMapsSourceUrl(delivery.sourceUrl);
    setConceptInput(delivery.concept ?? "");
    setUnifiedInput(delivery.recipient);
    setEditAddressInput(delivery.address);
    setNewPhoneInput(delivery.phone ?? "");
    const [lat, lng] = delivery.coordinates ?? [];
    const initialLocationInput =
      typeof lat === "number" &&
      typeof lng === "number" &&
      isValidCoordinates(lat, lng)
        ? `${formatCoordinate(lat)}, ${formatCoordinate(lng)}`
        : "";
    setNewCoordsInput(initialLocationInput);
    initialLocationInputRef.current = initialLocationInput;
    setEditNotesInput(delivery.notes ?? "");
    setNewType(delivery.type);
    setRouteNotice(null);
    openModal("addDelivery", delivery.id);
  };

  const closeDeliveryForm = () => {
    invalidateMapsResolution();
    setEditingDelivery(null);
    initialLocationInputRef.current = "";
    closeModal("addDelivery");
  };

  const handleToggleEditingLocked = () => {
    // Req. 8: no alternar el bloqueo con el modal de añadir/editar abierto.
    if (isAdding || editingDelivery) return;
    setEditingLocked((prev) => !prev);
  };

  const handleResolveMapsInput = async () => {
    const input = newCoordsInput.trim();
    if (!input || mapsResolutionInProgressRef.current) {
      if (!input) setRouteNotice("Introduce un enlace de Google Maps para resolver.");
      return;
    }

    const requestId = ++mapsResolveRequestRef.current;
    mapsResolutionInProgressRef.current = true;
    try {
      setIsResolvingMapsUrl(true);
      setRouteNotice(null);
      const validated = validateMapsUrl(input);
      let targetUrl = validated.toString();
      if (isMapsShortUrl(targetUrl)) {
        targetUrl = await resolveGoogleMapsUrl(targetUrl);
      }
      if (requestId !== mapsResolveRequestRef.current) return;
      const dest = extractDestinationFromMapsUrl(targetUrl);
      if (dest.kind === "coordinates") {
        const [lat, lng] = dest.coordinates;
        setNewCoordsInput(`${formatCoordinate(lat)}, ${formatCoordinate(lng)}`);
        setMapsSourceUrl(input);
        setRouteNotice(
          `Ubicación resuelta: ${formatCoordinate(lat)}, ${formatCoordinate(lng)}. Revisa los datos y guarda.`
        );
      } else {
        setRouteNotice(dest.message);
      }
    } catch (err) {
      if (requestId !== mapsResolveRequestRef.current) return;
      setRouteNotice(
        err instanceof Error
          ? err.message
          : "No se pudo resolver el enlace de Google Maps."
      );
    } finally {
      if (requestId === mapsResolveRequestRef.current) {
        mapsResolutionInProgressRef.current = false;
        setIsResolvingMapsUrl(false);
      }
    }
  };

  const handleSaveDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !editingDelivery ||
      deliverySaveInProgressRef.current ||
      mapsResolutionInProgressRef.current
    ) return;

    const recipient = unifiedInput.trim();
    const address = editAddressInput.trim();
    const locationInput = newCoordsInput.trim();
    const locationInputChanged =
      locationInput !== initialLocationInputRef.current;
    const addressChanged = address !== editingDelivery.address.trim();
    const concept = conceptInput.trim() || undefined;
    const phone = newPhoneInput.trim() || undefined;
    const notes = editNotesInput.trim() || undefined;
    const type = newType;
    let coordinates: [number, number] | undefined;
    let geocodingWarning: string | undefined;
    let updateCoordinates = false;
    let sourceUrl = mapsSourceUrl;

    deliverySaveInProgressRef.current = true;
    setIsParsing(true);
    setParsingMessage("Actualizando parada...");

    try {
      if (locationInputChanged && locationInput) {
        const parsedLocation = parseLocationInput(locationInput);
        if (parsedLocation.kind === "invalid") {
          setRouteNotice(parsedLocation.message);
          return;
        }

        if (parsedLocation.kind === "coordinates") {
          coordinates = parsedLocation.value;
        } else if (parsedLocation.kind === "maps-long-url") {
          coordinates = parsedLocation.coordinates;
          sourceUrl = locationInput;
        } else if (parsedLocation.kind === "maps-short-url") {
          sourceUrl = locationInput;
          setParsingMessage("Resolviendo enlace de Google Maps...");
          try {
            const resolvedUrl = await resolveGoogleMapsUrl(parsedLocation.url);
            const dest = extractDestinationFromMapsUrl(resolvedUrl);
            if (dest.kind === "coordinates") {
              coordinates = dest.coordinates;
            } else {
              setRouteNotice(dest.message);
              return;
            }
          } catch (err: unknown) {
            setRouteNotice(
              err instanceof Error
                ? err.message
                : "No se pudo resolver el enlace de Google Maps.",
            );
            return;
          }
        } else if (parsedLocation.kind === "plus-code") {
          sourceUrl = undefined;
          try {
            const geocoded = await geocodeAddress(parsedLocation.value);
            if (isValidCoordinates(geocoded.lat, geocoded.lng)) {
              coordinates = [geocoded.lat, geocoded.lng];
            } else {
              setRouteNotice("Google no devolvió coordenadas válidas para el Plus Code.");
              return;
            }
          } catch {
            setRouteNotice("No se pudo resolver el Plus Code. No se guardaron los cambios.");
            return;
          }
        }
        updateCoordinates = true;
      } else if (
        addressChanged ||
        (locationInputChanged && !locationInput && initialLocationInputRef.current)
      ) {
        sourceUrl = undefined;
        updateCoordinates = true;
        if (address) {
          if (isGoogleMapsUrl(address)) {
            setRouteNotice(
              "Pega los enlaces de Google Maps en el campo de Coordenadas / Enlace de Maps, no en la dirección.",
            );
            return;
          }
          try {
            const geocoded = await geocodeAddress(address);
            if (isValidCoordinates(geocoded.lat, geocoded.lng)) {
              coordinates = [geocoded.lat, geocoded.lng];
            } else {
              geocodingWarning =
                "La parada se guardó, pero no se pudo localizar en el mapa.";
            }
          } catch {
            geocodingWarning =
              "La parada se guardó, pero no se pudo localizar en el mapa.";
          }
        } else {
          geocodingWarning =
            "La parada se guardó sin ubicación porque la dirección está vacía.";
        }
      }

      setDeliveries((prev) =>
        prev.map((delivery) =>
          delivery.id === editingDelivery.id
            ? {
                ...delivery,
                concept,
                recipient,
                address,
                phone,
                notes,
                type,
                ...(updateCoordinates && { coordinates }),
                ...((updateCoordinates || sourceUrl !== editingDelivery.sourceUrl) && {
                  sourceUrl,
                }),
              }
            : delivery,
        ),
      );

      setRouteNotice(geocodingWarning ?? null);
      closeDeliveryForm();
    } finally {
      deliverySaveInProgressRef.current = false;
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  const handleAddDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mapsResolutionInProgressRef.current) return;
    if (editingDelivery) {
      await handleSaveDelivery(e);
      return;
    }
    if (deliverySaveInProgressRef.current) return;

    const recipient = unifiedInput.trim();
    if (!recipient) {
      setRouteNotice("Introduce el destinatario.");
      return;
    }

    const address = editAddressInput.trim();
    if (address && isGoogleMapsUrl(address)) {
      setRouteNotice(
        "Pega los enlaces de Google Maps en el campo de Coordenadas / Enlace de Maps, no en la dirección.",
      );
      return;
    }

    const coords = newCoordsInput.trim();
    const parsedLocation = parseLocationInput(coords);
    if (parsedLocation.kind === "invalid") {
      setRouteNotice(parsedLocation.message);
      return;
    }

    if (parsedLocation.kind === "empty" && !address) {
      setRouteNotice(
        "Introduce una dirección o unas coordenadas / Plus Code válidos.",
      );
      return;
    }

    deliverySaveInProgressRef.current = true;
    setIsParsing(true);
    setParsingMessage("Creando parada...");

    try {
      let coordinates: [number, number] | undefined;
      let geocodingWarning: string | undefined;
      let sourceUrl = mapsSourceUrl;

      if (parsedLocation.kind === "coordinates") {
        coordinates = parsedLocation.value;
      } else if (parsedLocation.kind === "maps-long-url") {
        coordinates = parsedLocation.coordinates;
        sourceUrl = coords;
      } else if (parsedLocation.kind === "maps-short-url") {
        sourceUrl = coords;
        setParsingMessage("Resolviendo enlace de Google Maps...");
        try {
          const resolvedUrl = await resolveGoogleMapsUrl(parsedLocation.url);
          const dest = extractDestinationFromMapsUrl(resolvedUrl);
          if (dest.kind === "coordinates") {
            coordinates = dest.coordinates;
          } else {
            setRouteNotice(dest.message);
            return;
          }
        } catch (err: unknown) {
          setRouteNotice(
            err instanceof Error
              ? err.message
              : "No se pudo resolver el enlace de Google Maps.",
          );
          return;
        }
      } else if (parsedLocation.kind === "plus-code") {
        sourceUrl = undefined;
        try {
          const geocoded = await geocodeAddress(parsedLocation.value);
          if (isValidCoordinates(geocoded.lat, geocoded.lng)) {
            coordinates = [geocoded.lat, geocoded.lng];
          } else {
            setRouteNotice("Google no devolvió coordenadas válidas para el Plus Code.");
            return;
          }
        } catch {
          setRouteNotice(
            "No se pudo resolver el Plus Code. Revisa el código y la localidad; no se creó la parada.",
          );
          return;
        }
      } else if (address) {
        sourceUrl = undefined;
        try {
          const geocodedAddress = await geocodeAddress(address);
          if (isValidCoordinates(geocodedAddress.lat, geocodedAddress.lng)) {
            coordinates = [geocodedAddress.lat, geocodedAddress.lng];
          } else {
            geocodingWarning =
              "La parada se ha creado, pero no se pudo localizar en el mapa.";
          }
        } catch {
          geocodingWarning =
            "La parada se ha creado, pero no se pudo localizar en el mapa.";
        }
      }

      const newDelivery: Delivery = {
        id: Math.random().toString(36).substring(2, 9),
        concept: conceptInput.trim() || undefined,
        recipient,
        address,
        phone: newPhoneInput.trim() || "",
        coordinates,
        status: DeliveryStatus.PENDING,
        type: newType,
        sourceUrl,
        estimatedTime: `~${Math.floor(Math.random() * 3) + 1} h`,
        notes: editNotesInput.trim() || undefined,
      };

      setDeliveries((prev) => [...prev, newDelivery]);
      setRouteNotice(geocodingWarning || null);
      setConceptInput("");
      setUnifiedInput("");
      setEditAddressInput("");
      setNewPhoneInput("");
      setNewCoordsInput("");
      setEditNotesInput("");
      closeDeliveryForm();
      setSelectedId(newDelivery.id);
    } finally {
      deliverySaveInProgressRef.current = false;
      setIsParsing(false);
      setParsingMessage(null);
    }
  };

  const handleDeleteDelivery = (id: string) => {
    if (editingLockedRef.current) return;
    setDeliveries((prev) => prev.filter((d) => d.id !== id));
    setManualSequence((prev) => prev.filter((x) => x !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleRemoveFromSequence = (id: string) => {
    if (editingLockedRef.current) return;
    setManualSequence((prev) => prev.filter((x) => x !== id));
  };

  const handleAddDeCAToRoutes = async (
    deca: DeCA,
  ): Promise<AddDeCAToRoutesResult> => {
    if (deca.estado !== "EMITIDO") {
      throw new Error("Solo se pueden añadir DeCAs emitidos a Rutas.");
    }

    if (
      deliveries.some((delivery) => delivery.decaId === deca.id) ||
      deliveriesRef.current.some((delivery) => delivery.decaId === deca.id)
    ) {
      return { status: "already-in-routes" };
    }

    if (importingDeCAIdsRef.current.has(deca.id)) {
      return { status: "in-progress" };
    }
    importingDeCAIdsRef.current.add(deca.id);

    try {
      const safeText = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const displayAddress = [
        safeText(deca.direccionDestino),
        safeText(deca.ciudadDestino),
      ].filter(Boolean);
      const address = displayAddress.join(", ");
      const geocodingQuery = [
        safeText(deca.destinatario),
        safeText(deca.direccionDestino),
        safeText(deca.ciudadDestino),
      ]
        .filter(Boolean)
        .join(", ");
      let coordinates: [number, number] | undefined;
      let geocodingError: string | undefined;

      if (geocodingQuery) {
        try {
          const geocoded = await geocodeAddress(geocodingQuery);
          if (
            Number.isFinite(geocoded.lat) &&
            Number.isFinite(geocoded.lng)
          ) {
            coordinates = [geocoded.lat, geocoded.lng];
          } else {
            geocodingError =
              "Google Geocoding no devolvió coordenadas válidas.";
          }
        } catch (error) {
          geocodingError =
            error instanceof Error
              ? error.message
              : "No se pudo geocodificar la dirección.";
        }
      } else {
        geocodingError =
          "El DeCA no contiene datos de ubicación para geocodificar.";
      }

      if (deliveriesRef.current.some((delivery) => delivery.decaId === deca.id)) {
        return { status: "already-in-routes" };
      }

      const randomUUID = globalThis.crypto?.randomUUID;
      if (!randomUUID) {
        throw new Error("No se pudo generar un identificador seguro.");
      }

      const notes = [
        safeText(deca.fecha) && `Fecha: ${safeText(deca.fecha)}`,
        safeText(deca.mercancia) &&
          `Mercancía: ${safeText(deca.mercancia)}`,
        safeText(deca.numeroBultos) &&
          `Bultos: ${safeText(deca.numeroBultos)}`,
        safeText(deca.pesoKg) && `Peso: ${safeText(deca.pesoKg)} kg`,
        safeText(deca.matriculaVehiculo) &&
          `Matrícula: ${safeText(deca.matriculaVehiculo)}`,
        safeText(deca.referenciaAlbaran) &&
          `Referencia: ${safeText(deca.referenciaAlbaran)}`,
      ].filter(Boolean).join(" · ");

      const newDelivery: Delivery = {
        id: `deca-${randomUUID.call(globalThis.crypto)}`,
        decaId: deca.id,
        sourceType: "DECA",
        concept:
          safeText(deca.referenciaAlbaran) ||
          safeText(deca.mercancia) ||
          "DeCA emitido",
        recipient: safeText(deca.destinatario),
        address,
        coordinates,
        status: DeliveryStatus.PENDING,
        type: DeliveryType.DELIVERY,
        notes: notes || undefined,
        pesoKg: parseLecturaKm(deca.pesoKg ?? ""),
      };

      deliveriesRef.current = [...deliveriesRef.current, newDelivery];
      setDeliveries((prev) =>
        prev.some((delivery) => delivery.decaId === deca.id)
          ? prev
          : [...prev, newDelivery],
      );
      return {
        status: "added",
        coordinatesAvailable: coordinates !== undefined,
        ...(geocodingError && { geocodingError }),
      };
    } finally {
      importingDeCAIdsRef.current.delete(deca.id);
    }
  };

  // ---------------------------------------------------------------------------
  // CSV import handler
  // ---------------------------------------------------------------------------
  const handleCsvImport = async (
    rows: Extract<RouteCsvRow, { kind: "valid" }>[],
  ) => {
    if (rows.length === 0) return;
    if (csvImportInProgressRef.current) {
      throw new Error("Ya hay una importación CSV en curso.");
    }
    const ownerId = sessionUserRef.current;
    const contextVersion = routeContextVersionRef.current;
    const isImportContextCurrent = () =>
      sessionUserRef.current === ownerId &&
      hydratedUserIdRef.current === ownerId &&
      routeContextVersionRef.current === contextVersion &&
      !isClosingJornadaRef.current &&
      !isAppClosedRef.current;
    if (
      !ownerId ||
      hydratedUserIdRef.current !== ownerId ||
      !isImportContextCurrent()
    ) {
      throw new Error("La sesión o jornada ya no está disponible para importar.");
    }

    csvImportInProgressRef.current = true;
    try {
      const newStops: Delivery[] = [];
      const geocodingErrors: string[] = [];

      for (const row of rows) {
        const { geocodeQuery, ...deliveryBase } = row.delivery;
        let coordinates: [number, number] | undefined;

        if (geocodeQuery) {
          try {
            const geocoded = await geocodeAddress(geocodeQuery);
            if (Number.isFinite(geocoded.lat) && Number.isFinite(geocoded.lng)) {
              coordinates = [geocoded.lat, geocoded.lng];
            } else {
              geocodingErrors.push(`Fila ${row.rowNumber}: no se pudo localizar en el mapa.`);
            }
          } catch {
            geocodingErrors.push(`Fila ${row.rowNumber}: error al geocodificar.`);
          }
        }

        newStops.push({ ...deliveryBase, coordinates });
      }

      if (!isImportContextCurrent()) {
        throw new Error("La sesión o jornada cambió durante la importación. No se añadieron las paradas.");
      }

      setDeliveries((prev) => appendImportedRouteStops(prev, newStops));

      if (geocodingErrors.length > 0) {
        setRouteNotice(
          `${newStops.length} parada${newStops.length !== 1 ? "s" : ""} importada${newStops.length !== 1 ? "s" : ""}. Sin ubicación en mapa: ${geocodingErrors.length}.`,
        );
      } else {
        setRouteNotice(
          `${newStops.length} parada${newStops.length !== 1 ? "s" : ""} importada${newStops.length !== 1 ? "s" : ""} correctamente.`,
        );
      }
      closeModal("csvRoute");
    } finally {
      csvImportInProgressRef.current = false;
    }
  };

  const handleStatusChange = (id: string, status: DeliveryStatus) => {
    // Req. reparto: el bloqueo de edición no impide registrar el resultado
    // operativo (Entregado/Incidencia), pero sí impide reabrir la tarea
    // (volver a PENDING) y el resto de ediciones.
    if (
      editingLockedRef.current &&
      status !== DeliveryStatus.COMPLETED &&
      status !== DeliveryStatus.ISSUE
    ) {
      return;
    }
    // igual que en GitHub: reordena activas y completadas
    setDeliveries((prev) => {
      const updated = prev.map((d) => (d.id === id ? { ...d, status } : d));

      const active = updated.filter(
        (d) =>
          d.status === DeliveryStatus.PENDING ||
          d.status === DeliveryStatus.IN_PROGRESS,
      );
      const done = updated.filter(
        (d) =>
          d.status === DeliveryStatus.COMPLETED ||
          d.status === DeliveryStatus.ISSUE,
      );

      return [...active, ...done];
    });

    if (
      status === DeliveryStatus.COMPLETED ||
      status === DeliveryStatus.ISSUE
    ) {
      setManualSequence((prev) => prev.filter((sid) => sid !== id));
    }
  };

  const handleClearAll = async () => {
    if (isClosingJornadaRef.current) return;
    if (kilometrajeAsociacionPendiente) {
      setRouteNotice("Las lecturas locales pertenecen a una ruta distinta. Confirma que corresponden a la ruta actual o descártalas y vuelve a introducirlas antes de cerrar.");
      setViewMode("control");
      return;
    }
    const readings = validateLecturasKm(kilometrajeInicial, kilometrajeFinal);
    if ("reason" in readings) {
      setRouteNotice(`${readings.reason} Completa las lecturas en Control de la jornada antes de cerrar.`);
      setViewMode("control");
      window.setTimeout(() => {
        if (!kilometrajeInicial.trim() || parseLecturaKm(kilometrajeInicial) === null) kilometrajeInicialRef.current?.focus();
        else kilometrajeFinalRef.current?.focus();
      }, 0);
      return;
    }
    if (!user?.id || hydratedUserId !== user.id || !cloudCloseRef.current) {
      alert("Espera a que la sesión y el servicio de nube estén preparados.");
      return;
    }
    isClosingJornadaRef.current = true;
    routeContextVersionRef.current += 1;
    setIsClosingJornada(true);
    try { await cloudCloseRef.current(); }
    finally { isClosingJornadaRef.current = false; setIsClosingJornada(false); }
  };

  const handleOptimizeRoute = () => {
    if (!currentUserLoc) {
      alert("Activa primero tu ubicación (GPS del dispositivo).");
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
      setOptimizeMessage("Ruta optimizada, orden actualizado");
    } catch (e) {
      setOptimizeMessage("No se ha podido optimizar la ruta");
    } finally {
      setTimeout(() => {
        setIsOptimizing(false);
        setOptimizeMessage(null);
      }, 2000);
    }
  };

  // Callbacks estables para MapView: leen el bloqueo actual vía ref, así
  // que alternar SOLO el bloqueo no cambia su identidad y no recrea
  // marcadores. Deps [] legítimas: solo capturan setters y una ref estables.
  const handleMarkerDragEnd = useCallback(
    (id: string, coords: [number, number]) => {
      if (editingLockedRef.current) return;
      setDeliveries((prev) =>
        prev.map((d) => (d.id === id ? { ...d, coordinates: coords } : d)),
      );
    },
    [],
  );

  const handleMarkerSelectForSequence = useCallback((id: string) => {
    if (!editingLockedRef.current) {
      setManualSequence((prev) => {
        if (prev.includes(id)) {
          return prev.filter((x) => x !== id);
        }
        return [...prev, id];
      });
    }
    // La selección/consulta se mantiene con el bloqueo activo.
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const pendingCount = deliveries.filter(
    (d) =>
      d.status === DeliveryStatus.PENDING ||
      d.status === DeliveryStatus.IN_PROGRESS,
  ).length;
  const kilometrajeValidation = validateLecturasKm(kilometrajeInicial, kilometrajeFinal);

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

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Cargando...
      </div>
    );
  }

  if (!user || passwordRecoveryPending) return <Auth />;

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

  const handleDragEndList = (event: DragEndEvent) => {
    if (editingLockedRef.current) return;
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;

    const activeIndex = sortedDeliveries.findIndex((d) => d.id === active.id);
    const overIndex = sortedDeliveries.findIndex((d) => d.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;

    const newOrder = arrayMove(sortedDeliveries, activeIndex, overIndex);
    const newSequence = newOrder.map((d) => d.id);

    setManualSequence(newSequence);
  };

  const navigationModules: { id: AppModule; label: string }[] = [
    { id: "home", label: "Inicio" },
    { id: "routes", label: "Rutas" },
    { id: "decas", label: "DeCAs" },
    { id: "billing", label: "Facturación" },
  ];

  const handleDismissInstallPrompt = () => {
    setIsInstallDismissedRecently(true);
    setDeferredInstallPrompt(null);
    try {
      localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Sin almacenamiento disponible, el aviso volverá a aparecer al visitar de nuevo.
    }
  };

  const handleInstallPwa = async () => {
    if (!deferredInstallPrompt || isInstallPrompting) return;

    const installPrompt = deferredInstallPrompt;
    setIsInstallPrompting(true);
    setInstallError(null);
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      setDeferredInstallPrompt(null);
      if (outcome === "accepted") {
        setIsInstallAccepted(true);
      } else {
        setIsInstallPromptDeclined(true);
      }
    } catch {
      setDeferredInstallPrompt(null);
      setInstallError(
        "No se pudo abrir la instalación. Puedes intentarlo desde el menú del navegador.",
      );
    } finally {
      setIsInstallPrompting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      {routeStorageError && <div role="alert" className="shrink-0 border-b border-red-300 bg-red-50 p-3 text-sm text-red-900">{routeStorageError}</div>}
      <header className="z-50 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:flex-nowrap sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Truck className="shrink-0 text-blue-600" size={22} />
          <span className="truncate text-sm font-black text-slate-800 sm:text-base">
            LOGIROUTE <span className="text-blue-600">AI</span>
          </span>
        </div>
        <nav
          aria-label="Secciones principales"
          className="order-3 flex w-full shrink-0 items-center justify-center gap-1 rounded-xl bg-slate-100 p-1 sm:order-none sm:w-auto"
        >
          {navigationModules.map((module) => (
            <button
              key={module.id}
              type="button"
              aria-current={activeModule === module.id ? "page" : undefined}
              onClick={() => navigateTo(module.id)}
              className={`rounded-lg px-2 py-2 text-[10px] font-black transition sm:px-4 sm:text-xs ${
                activeModule === module.id
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {module.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 max-w-[55%] items-center justify-end gap-2 sm:max-w-[40%] sm:gap-3">
          <span
            className="min-w-0 truncate text-right text-[10px] font-semibold text-slate-600 sm:text-xs"
            title={user?.email ? `Sesión: ${user.email}` : "Sesión iniciada"}
          >
            {user?.email ? `Sesión: ${user.email}` : "Sesión iniciada"}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100 sm:text-xs"
          >
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </div>
      </header>

      <section
        className={`min-h-0 flex-1 overflow-y-auto ${activeModule === "home" ? "block" : "hidden"}`}
      >
        <main className="min-h-full bg-slate-100 px-4 py-8 sm:px-8 sm:py-12">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-8 sm:mb-10">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                LOGIROUTE AI
              </p>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Bienvenido a LogiRute
              </h1>
              <p className="mt-2 text-sm text-slate-600 sm:text-base">
                Selecciona el área desde la que quieres trabajar.
              </p>
            </div>

            {!isPwaInstalled &&
              !isInstallDismissedRecently &&
              !isInstallAccepted &&
              (deferredInstallPrompt ||
                isSafariIos ||
                isInstallPromptDeclined ||
                installError) && (
                <aside
                  aria-labelledby="pwa-install-title"
                  className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                      <Download size={20} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2
                        id="pwa-install-title"
                        className="font-black text-slate-900"
                      >
                        Instala LogiRute
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        {isSafariIos
                          ? "Para instalarla, pulsa Compartir en Safari y selecciona “Añadir a pantalla de inicio”."
                          : installError ??
                            (isInstallPromptDeclined
                              ? "Has pospuesto la instalación. Puedes instalar LogiRute desde el menú del navegador."
                              : null) ??
                            "Accede más rápido desde el escritorio o la pantalla de inicio."}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    {deferredInstallPrompt && (
                      <button
                        type="button"
                        onClick={handleInstallPwa}
                        disabled={isInstallPrompting}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isInstallPrompting
                          ? "Abriendo instalación..."
                          : "Instalar LogiRute"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDismissInstallPrompt}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
                    >
                      Ahora no
                    </button>
                  </div>
                </aside>
              )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
              {[
                {
                  id: "routes",
                  title: "Rutas",
                  description:
                    "Planifica y controla las paradas de la jornada.",
                  icon: Map,
                  accent: "border-t-blue-500 text-blue-700 bg-blue-50",
                },
                {
                  id: "decas",
                  title: "DeCAs",
                  description:
                    "Crea, importa, emite y consulta documentos de transporte.",
                  icon: FileText,
                  accent: "border-t-indigo-500 text-indigo-700 bg-indigo-50",
                },
                {
                  id: "billing",
                  title: "Facturación",
                  description:
                    "Gestiona la facturación y documentación económica.",
                  icon: Receipt,
                  accent: "border-t-emerald-500 text-emerald-700 bg-emerald-50",
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => navigateTo(card.id as AppModule)}
                    className="group flex min-h-52 w-full flex-col rounded-2xl border border-slate-200 border-t-4 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 sm:min-h-56 sm:p-6"
                  >
                    <span
                      className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl ${card.accent}`}
                    >
                      <Icon size={24} strokeWidth={2.2} />
                    </span>
                    <span className="text-lg font-black text-slate-900 sm:text-xl">
                      {card.title}
                    </span>
                    <span className="mt-2 text-sm leading-relaxed text-slate-600">
                      {card.description}
                    </span>
                    <span className="mt-auto pt-5 text-xs font-bold text-slate-500 transition group-hover:text-slate-800">
                      Abrir área
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      </section>

      <div
        className={`min-h-0 flex-1 ${activeModule === "routes" ? "block" : "hidden"}`}
      >
        <div className="flex h-full flex-col overflow-hidden bg-slate-50">
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
          <header className="bg-white border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-30 shadow-sm">
            <button
              type="button"
              onClick={handleToggleEditingLocked}
              disabled={isAdding || editingDelivery !== null}
              aria-pressed={editingLocked}
              title={
                editingLocked
                  ? "Desbloquear edición de la ruta"
                  : "Bloquear edición de la ruta"
              }
              className={`px-2.5 py-2 rounded-2xl text-[10px] font-black uppercase flex items-center gap-1 whitespace-nowrap shadow-md transition disabled:opacity-40 shrink-0 ${
                editingLocked
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {editingLocked ? <Lock size={14} /> : <Unlock size={14} />}
              <span className="sm:hidden">
                {editingLocked ? "Desbloquear" : "Bloquear"}
              </span>
              <span className="hidden sm:inline">
                {editingLocked ? "Desbloquear edición" : "Bloquear edición"}
              </span>
            </button>
            <div className="flex flex-col items-end gap-1 ml-auto">
              <div className="flex bg-slate-100 rounded-xl p-1 text-[9px] sm:text-[10px]">
                {["list", "map", "split", "control"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode as any)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-lg font-black uppercase ${
                      viewMode === mode
                        ? "bg-white shadow text-blue-600"
                        : "text-slate-400"
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="hidden sm:flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => openModal("csvRoute")}
                  disabled={isAdding || editingDelivery !== null}
                  className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase disabled:opacity-40 hover:bg-blue-50 transition flex items-center gap-1"
                >
                  <FileText size={13} /> Importar CSV
                </button>
                <button
                  onClick={openAddDelivery}
                  className="bg-blue-600 text-white px-4 py-2 rounded-2xl text-[10px] font-black uppercase flex items-center gap-1 shadow-md hover:bg-blue-700 transition"
                >
                  <Plus size={14} /> Nueva parada
                </button>
                <button
                  onClick={handleOptimizeRoute}
                  disabled={
                    isOptimizing || !currentUserLoc || deliveries.length === 0
                  }
                  className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase disabled:opacity-40 hover:bg-blue-50 transition"
                >
                  {isOptimizing ? "OPTIMIZANDO…" : "OPTIMIZAR"}
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
          <div className="sm:hidden bg-white border-b px-3 py-2 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openModal("csvRoute")}
              disabled={isAdding || editingDelivery !== null}
              className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40 flex items-center gap-1"
            >
              <FileText size={13} /> CSV
            </button>
            <button
              onClick={openAddDelivery}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1 whitespace-nowrap shadow-md"
            >
              <Plus size={14} /> Nueva
            </button>
            <button
              onClick={handleOptimizeRoute}
              disabled={
                isOptimizing || !currentUserLoc || deliveries.length === 0
              }
              className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40"
            >
              {isOptimizing ? "OPTIMIZANDO…" : "OPTIMIZAR"}
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

          {routeNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-800"
            >
              <span>{routeNotice}</span>
              <button
                type="button"
                onClick={() => setRouteNotice(null)}
                className="shrink-0 rounded-lg p-1 hover:bg-amber-100"
                aria-label="Cerrar aviso"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <RouteCloudPanel
            key={user.id}
            userId={user.id}
            hydratedUserId={hydratedUserId}
            suspendAuto={isAdding || isParsing || isResolvingMapsUrl || isOptimizing}
            deliveries={deliveries}
            sequence={manualSequence}
            kilometrajeInicial={kilometrajeInicial}
            kilometrajeFinal={kilometrajeFinal}
            kilometrajeAsociacionConfirmada={!kilometrajeAsociacionPendiente}
            onKilometrajeJornadaCerrada={() => {
              setKilometrajeInicial("");
              setKilometrajeFinal("");
              setKilometrajeAsociacionPendiente(false);
              setKilometrajeNotice("Jornada cerrada. Introduce las lecturas del nuevo día.");
            }}
            registerClose={(close) => {
              cloudCloseRef.current = close;
              return () => {
                if (cloudCloseRef.current === close) {
                  cloudCloseRef.current = null;
                }
              };
            }}
            applyRoute={(ownerId: string, route: RemoteRoute) => {
              if (sessionUserRef.current !== ownerId || hydratedUserId !== ownerId) return false;
              const localIds = deliveries.map((delivery) => delivery.id);
              const remoteIds = route.deliveries.map((delivery) => delivery.id);
              const sharesActiveStops = localIds.length === 0 || remoteIds.some((id) => localIds.includes(id));
              const replacesActiveRoute = !sharesActiveStops;
              const hasOdometerDraft = Boolean(kilometrajeInicial.trim() || kilometrajeFinal.trim());
              const requiresOdometerReview = replacesActiveRoute && hasOdometerDraft;
              const odometer = replacesActiveRoute
                ? {
                    kilometrajeInicial: hasOdometerDraft ? kilometrajeInicial : "",
                    kilometrajeFinal: hasOdometerDraft ? kilometrajeFinal : "",
                    kilometrajeAsociacionPendiente: requiresOdometerReview,
                  }
                : { kilometrajeAsociacionPendiente };
              if (!saveRouteSnapshot(ownerId, route.deliveries, route.sequence, odometer)) return false;
              routeContextVersionRef.current += 1;
              setDeliveries(route.deliveries);
              setManualSequence(route.sequence);
              if (requiresOdometerReview) {
                setKilometrajeAsociacionPendiente(true);
                setKilometrajeNotice("La ruta cargada es distinta. Las lecturas anteriores se conservaron para que confirmes a qué ruta corresponden.");
              } else if (replacesActiveRoute) {
                setKilometrajeAsociacionPendiente(false);
                setKilometrajeInicial("");
                setKilometrajeFinal("");
                setKilometrajeNotice("La ruta cargada es distinta; introduce las lecturas de su jornada.");
              }
              setSelectedId(null);
              return true;
            }}
          />
          {/* MAIN */}
          <main className="flex-1 flex flex-col sm:flex-row overflow-hidden">
            {viewMode === "control" ? (
              <div className="flex-1 p-4 sm:p-6 md:p-12 overflow-y-auto bg-slate-50">
                <div className="max-w-5xl mx-auto space-y-10">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex flex-col">
                      <h2 className="text-3xl sm:text-4xl font-black text-slate-800 tracking-tighter uppercase">
                        Panel de Control
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Rutas · Sincronización automática
                        </p>
                      </div>
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
                            (d) => d.status === DeliveryStatus.COMPLETED,
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
                                  d.type === DeliveryType.DELIVERY,
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
                                  d.type === DeliveryType.PICKUP,
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
                            (d) => d.status === DeliveryStatus.ISSUE,
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

                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="odometer-heading">
                    <h3 id="odometer-heading" className="text-sm font-black text-slate-800">Kilometraje del vehículo</h3>
                    <p className="mt-1 text-xs text-slate-500">Lecturas del cuentakilómetros, no distancias calculadas por GPS. Se guardan localmente al introducirlas y se asociarán al ID de jornada al cerrar en nube.</p>
                    {kilometrajeAsociacionPendiente && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p>Se cargó una ruta distinta de la que acompañaba estas lecturas. Revísalas antes de asociarlas.</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => { setKilometrajeAsociacionPendiente(false); setKilometrajeNotice("Asociación confirmada para la ruta actual."); }} className="rounded-lg border border-amber-400 bg-white px-3 py-2 font-bold">Confirmar que corresponden a esta ruta</button>
                        <button type="button" onClick={() => { setKilometrajeInicial(""); setKilometrajeFinal(""); setKilometrajeAsociacionPendiente(false); setKilometrajeNotice("Lecturas descartadas. Introduce las de la ruta actual."); }} className="rounded-lg border border-amber-400 bg-white px-3 py-2 font-bold">Descartar y volver a introducir</button>
                      </div>
                    </div>}
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-bold text-slate-700">Kilometraje inicial
                        <input ref={kilometrajeInicialRef} type="text" inputMode="decimal" autoComplete="off" value={kilometrajeInicial} disabled={isClosingJornada} onChange={(event) => handleKilometrajeChange("inicial", event.target.value)} onBlur={confirmKilometrajeLocal} aria-invalid={Boolean(kilometrajeInicial.trim() && parseLecturaKm(kilometrajeInicial) === null)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Lectura al comenzar el día" />
                      </label>
                      <label className="text-xs font-bold text-slate-700">Kilometraje final
                        <input ref={kilometrajeFinalRef} type="text" inputMode="decimal" autoComplete="off" value={kilometrajeFinal} disabled={isClosingJornada} onChange={(event) => handleKilometrajeChange("final", event.target.value)} onBlur={confirmKilometrajeLocal} aria-invalid={Boolean(kilometrajeFinal.trim() && parseLecturaKm(kilometrajeFinal) === null)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Lectura al terminar el día" />
                      </label>
                    </div>
                    {kilometrajeInicial.trim() && parseLecturaKm(kilometrajeInicial) === null && <p className="mt-2 text-xs text-red-700">El kilometraje inicial debe ser un número válido no negativo.</p>}
                    {kilometrajeFinal.trim() && parseLecturaKm(kilometrajeFinal) === null && <p className="mt-2 text-xs text-red-700">El kilometraje final debe ser un número válido no negativo.</p>}
                    {kilometrajeInicial.trim() && kilometrajeFinal.trim() && "reason" in kilometrajeValidation && parseLecturaKm(kilometrajeInicial) !== null && parseLecturaKm(kilometrajeFinal) !== null && <p className="mt-2 text-xs text-red-700">{kilometrajeValidation.reason}</p>}
                    {"distance" in kilometrajeValidation && <p className="mt-2 text-xs font-bold text-slate-700">Kilómetros recorridos: {kilometrajeValidation.distance}</p>}
                    {kilometrajeNotice && <p role="status" className="mt-2 text-xs text-slate-600">{kilometrajeNotice}</p>}
                  </section>

                  <div className="flex flex-wrap gap-4">
                    <button
                      type="button"
                      onClick={() => openModal("registro")}
                      className="bg-slate-900 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-slate-800 transition-all uppercase text-xs"
                    >
                      REGISTRO
                    </button>
                    <button
                      onClick={handleClearAll}
                      className="bg-red-600 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-red-700 transition-all uppercase text-xs"
                    >
                      <Power size={20} /> Cerrar jornada
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {viewMode !== "list" && (
                  <section
                    className={
                      viewMode === "split"
                        ? "h-1/2 sm:h-auto sm:flex-1 relative"
                        : "flex-1 relative"
                    }
                  >
                    <MapView
                      deliveries={deliveries}
                      manualSequence={manualSequence}
                      selectedId={selectedId}
                      onMarkerClick={handleMarkerSelectForSequence}
                      viewMode={viewMode}
                      onMarkerDragEnd={handleMarkerDragEnd}
                      editingLocked={editingLocked}
                    />
                  </section>
                )}

                {viewMode === "split" && (
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
                            onEdit={openEditDelivery}
                            onStatusChange={(id, status) =>
                              handleStatusChange(id, status)
                            }
                            onDelete={(id) => handleDeleteDelivery(id)}
                            onRemoveFromSequence={handleRemoveFromSequence}
                            editingLocked={editingLocked}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </aside>
                )}

                {viewMode === "list" && (
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
                            onEdit={openEditDelivery}
                            onStatusChange={(id, status) =>
                              handleStatusChange(id, status)
                            }
                            onDelete={(id) => handleDeleteDelivery(id)}
                            onRemoveFromSequence={handleRemoveFromSequence}
                            editingLocked={editingLocked}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </aside>
                )}
              </>
            )}
          </main>

          {/* Modal Nueva Parada / Editar Parada */}
          {isCsvImportOpen && (
            <RouteCsvImportModal
              onClose={() => closeModal("csvRoute")}
              onImport={handleCsvImport}
              disabled={isAdding || editingDelivery !== null}
            />
          )}
          {isAdding && (
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-[40px] w-full max-w-xl max-h-[90vh] shadow-2xl overflow-hidden">
                <div className="p-8 border-b flex justify-between items-center bg-slate-50/40">
                  <h3 className="text-2xl font-black uppercase tracking-tighter italic">
                    {editingDelivery ? "Editar Parada" : "Nueva Parada"}
                  </h3>
                  <button
                    type="button"
                    onClick={closeDeliveryForm}
                    disabled={isParsing}
                    className="p-2 hover:bg-slate-200 rounded-xl disabled:opacity-50"
                  >
                    <X size={24} />
                  </button>
                </div>

                <form
                  onSubmit={handleAddDelivery}
                  className="p-8 space-y-6 max-h-[calc(90vh-100px)] overflow-y-auto"
                >
                  <div className="flex bg-slate-100 p-1.5 rounded-3xl">
                    <button
                      type="button"
                      onClick={() => setNewType(DeliveryType.DELIVERY)}
                      disabled={isParsing}
                      className={`flex-1 py-3 rounded-2xl text-[10px] font-black ${
                        newType === DeliveryType.DELIVERY
                          ? "bg-blue-600 text-white shadow-lg"
                          : "text-slate-400"
                      }`}
                    >
                      ENTREGA
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewType(DeliveryType.PICKUP)}
                      disabled={isParsing}
                      className={`flex-1 py-3 rounded-2xl text-[10px] font-black ${
                        newType === DeliveryType.PICKUP
                          ? "bg-red-600 text-white shadow-lg"
                          : "text-slate-400"
                      }`}
                    >
                      RECOGIDA
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                      Destinatario
                    </label>
                    <div className="relative">
                      <textarea
                        value={unifiedInput}
                        onChange={(e) => setUnifiedInput(e.target.value)}
                        disabled={isParsing}
                        className="w-full h-20 px-4 pr-14 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm resize-none"
                      />
                      <button
                        type="button"
                        onClick={toggleListening}
                        disabled={isParsing}
                        className={`absolute right-2 bottom-2 p-2.5 rounded-xl ${
                          isListening
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-slate-100 text-slate-400"
                        }`}
                        aria-label="Dictar destinatario"
                      >
                        <Mic size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                      Dirección
                    </label>
                    <textarea
                      value={editAddressInput}
                      onChange={(e) => setEditAddressInput(e.target.value)}
                      disabled={isParsing}
                      className="w-full h-24 px-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold text-sm resize-none"
                    />
                    <p className="px-2 text-[10px] leading-relaxed text-slate-500">
                      La dirección es opcional si introduces coordenadas válidas o un Plus Code que pueda localizarse.
                    </p>
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
                          disabled={isParsing}
                          className="w-full pl-10 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between ml-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Coordenadas / Plus Code / Enlace de Maps
                        </label>
                        {isGoogleMapsUrl(newCoordsInput) && (
                          <button
                            type="button"
                            onClick={handleResolveMapsInput}
                            disabled={isParsing || isResolvingMapsUrl}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          >
                            {isResolvingMapsUrl ? "Resolviendo..." : "Resolver enlace"}
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={newCoordsInput}
                        onChange={(e) => {
                          setNewCoordsInput(e.target.value);
                          setMapsSourceUrl(undefined);
                        }}
                        disabled={isParsing || isResolvingMapsUrl}
                        className="w-full px-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-xs disabled:bg-slate-50"
                        placeholder="38.3452, -0.4810, Plus Code o enlace de Maps"
                      />
                      <p className="px-2 text-[10px] leading-relaxed text-slate-500">
                        Opcional. Coordenadas: latitud, longitud. Plus Code o enlace de Google Maps (maps.app.goo.gl).
                      </p>
                      {editingDelivery && (
                        <p className="px-2 text-[10px] leading-relaxed text-slate-500">
                          Si borras una ubicación guardada, se volverá a
                          localizar la parada por dirección.
                        </p>
                      )}
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
                        disabled={isParsing}
                        className="w-full pl-12 pr-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                      Notas
                    </label>
                    <textarea
                      value={editNotesInput}
                      onChange={(e) => setEditNotesInput(e.target.value)}
                      disabled={isParsing}
                      className="w-full h-24 px-4 py-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-blue-500 text-sm resize-none"
                    />
                  </div>

                  {routeNotice && (
                    <div
                      role="status"
                      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                    >
                      {routeNotice}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={closeDeliveryForm}
                    disabled={isParsing}
                    className="w-full py-4 bg-slate-100 text-slate-700 rounded-[30px] font-black uppercase hover:bg-slate-200 disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={isParsing || isResolvingMapsUrl}
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
                      editingDelivery ? null : <Plus size={24} />
                    )}
                    {editingDelivery ? "Guardar cambios" : "Crear parada"}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
      <section
        className={`min-h-0 flex-1 overflow-y-auto ${activeModule === "decas" ? "block" : "hidden"}`}
      >
        <DeCASection
          key={user?.id ?? "anon"}
          sessionUserId={user?.id ?? null}
          isDeCAInRoutes={(decaId) =>
            deliveries.some((delivery) => delivery.decaId === decaId)
          }
          onAddToRoutes={handleAddDeCAToRoutes}
          navSubView={navState.module === "decas" ? navState.subView : undefined}
          navSelectedId={navState.module === "decas" ? navState.selectedId : undefined}
          navModal={navState.module === "decas" ? navState.modal : undefined}
          onNavigate={(subView, selectedId) => navigateTo("decas", subView, selectedId)}
          onOpenModal={(modal, selectedId) => openModal(modal, selectedId)}
          onCloseModal={(modal) => closeModal(modal)}
          onCloseManager={closeManager}
          onGoBack={goBack}
          onNormalize={normalize}
          onBusyChange={(busy) => {
            decaBusyRef.current = busy;
          }}
        />
      </section>
      <section
        className={`min-h-0 flex-1 overflow-y-auto ${activeModule === "billing" ? "block" : "hidden"}`}
      >
        <BillingSection userId={user?.id} />
      </section>
      <RegistroModal
        isOpen={isRegistroOpen}
        onClose={() => closeModal("registro")}
        userId={user?.id}
      />
    </div>
  );
};

export default App;
