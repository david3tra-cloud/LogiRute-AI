// useAppNavigation.ts
// Hook de navegación sincronizada con el historial del navegador para LogiRute AI.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AppModal,
  AppModule,
  DeCASubView,
  generateChainId,
  isLogiRouteNavState,
  LogiRouteNavState,
} from "./navigationHistory";

interface UseAppNavigationOptions {
  currentUserId: string | null;
  isAuthLoading: boolean;
  isBusy: () => boolean;
  onNotice?: (message: string) => void;
}

type ManagerSubView = Extract<DeCASubView, "companies" | "carriers">;

interface ManagerHistoryEntry {
  chainId: string;
  depth: number;
  subView: ManagerSubView;
  userId: string | null;
  returnState: LogiRouteNavState;
}

const managerEntryKey = (chainId: string, depth: number) =>
  `${chainId}:${depth}`;

const isManagerSubView = (
  subView: DeCASubView | undefined,
): subView is ManagerSubView =>
  subView === "companies" || subView === "carriers";

export function useAppNavigation({
  currentUserId,
  isAuthLoading,
  isBusy,
  onNotice,
}: UseAppNavigationOptions) {
  const [navState, setNavState] = useState<LogiRouteNavState>(() => {
    // Inicialización síncrona segura
    const raw = typeof window !== "undefined" ? window.history.state : null;
    if (isLogiRouteNavState(raw)) {
      return raw;
    }
    return {
      app: "logiroute",
      version: 1,
      chainId: generateChainId(),
      depth: 0,
      module: "home",
      userId: currentUserId,
    };
  });

  const navStateRef = useRef(navState);
  navStateRef.current = navState;

  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const isAuthLoadingRef = useRef(isAuthLoading);
  isAuthLoadingRef.current = isAuthLoading;

  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;

  const managerEntriesRef = useRef(new Map<string, ManagerHistoryEntry>());

  // Seguimiento explícito de la recuperación para no entrar en bucles
  const pendingRecoveryTargetRef = useRef<{ chainId: string; depth: number } | null>(null);

  // Inicialización de la primera entrada en el historial
  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.history.state;
    if (!isLogiRouteNavState(raw)) {
      const initial: LogiRouteNavState = {
        app: "logiroute",
        version: 1,
        chainId: generateChainId(),
        depth: 0,
        module: "home",
        userId: isAuthLoading ? null : currentUserId,
      };
      window.history.replaceState(initial, "");
      setNavState(initial);
    }
  }, []);

  // Validación de sesión una vez completada la autenticación
  useEffect(() => {
    if (isAuthLoading) return;

    const raw = window.history.state;
    if (isLogiRouteNavState(raw)) {
      // Si el estado pertenece a un usuario autenticado previo distinto del actual:
      if (raw.userId !== null && raw.userId !== currentUserId) {
        managerEntriesRef.current.clear();
        const resetState: LogiRouteNavState = {
          app: "logiroute",
          version: 1,
          chainId: generateChainId(),
          depth: 0,
          module: "home",
          userId: currentUserId,
        };
        window.history.replaceState(resetState, "");
        setNavState(resetState);
      } else if (raw.userId === null && currentUserId !== null && raw.depth === 0) {
        // Actualizar el userId en la raíz sin cambiar de pantalla
        const updatedRoot: LogiRouteNavState = {
          ...raw,
          userId: currentUserId,
        };
        window.history.replaceState(updatedRoot, "");
        setNavState(updatedRoot);
      }
    }
  }, [isAuthLoading, currentUserId]);

  // Manejador central del evento popstate del navegador
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      const incoming = event.state as unknown;

      // 1. Comprobación de recuperación pendiente
      if (pendingRecoveryTargetRef.current) {
        const target = pendingRecoveryTargetRef.current;
        if (
          isLogiRouteNavState(incoming) &&
          incoming.chainId === target.chainId &&
          incoming.depth === target.depth
        ) {
          // Se ha alcanzado exactamente la entrada esperada. Recuperación completada.
          pendingRecoveryTargetRef.current = null;
          return;
        }

        // Si no ha llegado a la entrada esperada (pulsaciones repetidas o salto intermedio):
        if (isLogiRouteNavState(incoming) && incoming.chainId === target.chainId) {
          const delta = target.depth - incoming.depth;
          if (delta !== 0) {
            window.history.go(delta);
            return;
          }
        }

        // Si la cadena se rompió o la entrada es ajena, limpiar recuperación
        pendingRecoveryTargetRef.current = null;
      }

      // 2. Comprobación de operaciones bloqueantes en curso
      if (isBusyRef.current()) {
        const current = navStateRef.current;
        if (
          isLogiRouteNavState(incoming) &&
          incoming.chainId === current.chainId &&
          incoming.userId === currentUserIdRef.current
        ) {
          const delta = current.depth - incoming.depth;
          if (delta !== 0) {
            pendingRecoveryTargetRef.current = {
              chainId: current.chainId,
              depth: current.depth,
            };
            onNoticeRef.current?.("Operación en curso. Espera a que termine.");
            window.history.go(delta);
            return;
          }
        }
        // Si no se puede calcular un desplazamiento seguro, no bloquear la salida
        return;
      }

      // 3. Validación de sesión y seguridad del estado entrante
      if (!isLogiRouteNavState(incoming)) {
        // Entrada inicial o externa al dominio
        if (navStateRef.current.depth === 0) {
          return; // Salida natural del navegador o PWA
        }
        // Normalización si el usuario quedó sin estado propio
        managerEntriesRef.current.clear();
        const normalized: LogiRouteNavState = {
          app: "logiroute",
          version: 1,
          chainId: generateChainId(),
          depth: 0,
          module: "home",
          userId: currentUserIdRef.current,
        };
        window.history.replaceState(normalized, "");
        setNavState(normalized);
        return;
      }

      // Impedir restaurar vistas de otra sesión tras cierre de sesión o cambio de cuenta
      if (!isAuthLoadingRef.current) {
        if (incoming.userId !== null && incoming.userId !== currentUserIdRef.current) {
          managerEntriesRef.current.clear();
          const safeState: LogiRouteNavState = {
            app: "logiroute",
            version: 1,
            chainId: generateChainId(),
            depth: 0,
            module: "home",
            userId: currentUserIdRef.current,
          };
          window.history.replaceState(safeState, "");
          setNavState(safeState);
          return;
        }
      }

      // 4. Estado válido aceptado
      setNavState(incoming);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Navegación hacia adelante entre módulos o subvistas
  const navigateTo = useCallback(
    (
      module: AppModule,
      subView?: DeCASubView,
      selectedId?: string,
    ) => {
      const current = navStateRef.current;
      const nextSubView = module === "decas" ? (subView ?? "list") : undefined;
      const nextSelectedId =
        module === "decas" && nextSubView === "detail" ? selectedId : undefined;

      // Evitar entradas duplicadas si ya estamos en ese estado exacto
      if (
        current.module === module &&
        current.subView === nextSubView &&
        current.selectedId === nextSelectedId &&
        !current.modal
      ) {
        return;
      }

      const nextDepth = current.depth + 1;
      for (const [key, entry] of managerEntriesRef.current) {
        if (entry.chainId === current.chainId && entry.depth > current.depth) {
          managerEntriesRef.current.delete(key);
        }
      }

      const nextState: LogiRouteNavState = {
        app: "logiroute",
        version: 1,
        chainId: current.chainId,
        depth: nextDepth,
        module,
        subView: nextSubView,
        selectedId: nextSelectedId,
        userId: currentUserIdRef.current,
      };

      window.history.pushState(nextState, "");
      if (module === "decas" && isManagerSubView(nextSubView)) {
        managerEntriesRef.current.set(
          managerEntryKey(nextState.chainId, nextState.depth),
          {
            chainId: nextState.chainId,
            depth: nextState.depth,
            subView: nextSubView,
            userId: nextState.userId,
            returnState: current,
          },
        );
      }
      setNavState(nextState);
    },
    [],
  );

  // Apertura de modal sobre la pantalla actual
  const openModal = useCallback((modal: AppModal, selectedId?: string) => {
    const current = navStateRef.current;
    if (current.modal === modal) return;

    const nextState: LogiRouteNavState = {
      ...current,
      modal,
      selectedId: selectedId ?? current.selectedId,
      depth: current.depth + 1,
      userId: currentUserIdRef.current,
    };

    window.history.pushState(nextState, "");
    setNavState(nextState);
  }, []);

  // Cierre de modal coherente (consume la entrada del historial si corresponde)
  const closeModal = useCallback((modalName?: AppModal) => {
    const current = navStateRef.current;
    if (current.modal && (!modalName || current.modal === modalName)) {
      window.history.back();
    }
  }, []);

  // Regreso jerárquico (botón Volver de la interfaz)
  const goBack = useCallback(() => {
    const current = navStateRef.current;
    if (current.depth > 0) {
      window.history.back();
    } else {
      navigateTo("home");
    }
  }, [navigateTo]);

  // Normalización segura si un documento o sub-vista ya no existe
  const normalize = useCallback(
    (updates: Partial<Pick<LogiRouteNavState, "module" | "subView" | "modal" | "selectedId">>) => {
      const current = navStateRef.current;
      const normalized: LogiRouteNavState = {
        ...current,
        ...updates,
      };
      window.history.replaceState(normalized, "");
      setNavState(normalized);
    },
    [],
  );

  // Cierra entradas internas; las restauradas o directas se reemplazan.
  const closeManager = useCallback(
    (returnView: DeCASubView) => {
      const current = navStateRef.current;
      const key = managerEntryKey(current.chainId, current.depth);
      const entry = managerEntriesRef.current.get(key);
      const canGoBack =
        current.module === "decas" &&
        isManagerSubView(current.subView) &&
        !current.modal &&
        entry?.chainId === current.chainId &&
        entry.depth === current.depth &&
        entry.subView === current.subView &&
        entry.userId === current.userId &&
        entry.returnState.chainId === current.chainId &&
        entry.returnState.depth + 1 === current.depth &&
        entry.returnState.module === "decas" &&
        entry.returnState.subView === returnView;

      if (canGoBack) {
        window.history.back();
        return;
      }

      managerEntriesRef.current.delete(key);
      normalize({
        module: "decas",
        subView: returnView,
        selectedId: undefined,
        modal: undefined,
      });
    },
    [normalize],
  );

  // Cierre de sesión explícito: sustituye la entrada actual para no dejar pantallas con datos
  const onSignOutReset = useCallback(() => {
    managerEntriesRef.current.clear();
    const resetState: LogiRouteNavState = {
      app: "logiroute",
      version: 1,
      chainId: generateChainId(),
      depth: 0,
      module: "home",
      userId: null,
    };
    window.history.replaceState(resetState, "");
    setNavState(resetState);
  }, []);

  return {
    navState,
    navigateTo,
    openModal,
    closeModal,
    goBack,
    normalize,
    closeManager,
    onSignOutReset,
  };
}
