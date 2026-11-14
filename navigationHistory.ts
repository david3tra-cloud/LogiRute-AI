// navigationHistory.ts
// Gestión centralizada de historial de navegación, popstate y botón Atrás para LogiRute AI.

export type AppModule = "home" | "routes" | "decas" | "billing";
export type DeCASubView = "list" | "form" | "detail" | "companies" | "carriers";
export type AppModal =
  | "registro"
  | "csvRoute"
  | "addDelivery"
  | "decaQr"
  | "decaCsv"
  | "decaBulk"
  | "plates";

export interface LogiRouteNavState {
  app: "logiroute";
  version: 1;
  chainId: string;
  depth: number;
  module: AppModule;
  subView?: DeCASubView;
  modal?: AppModal;
  selectedId?: string;
  userId: string | null;
}

export function generateChainId(): string {
  return `chain_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isLogiRouteNavState(state: unknown): state is LogiRouteNavState {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  return (
    s.app === "logiroute" &&
    s.version === 1 &&
    typeof s.chainId === "string" &&
    typeof s.depth === "number" &&
    (s.module === "home" ||
      s.module === "routes" ||
      s.module === "decas" ||
      s.module === "billing")
  );
}

export function areStatesEquivalent(
  a: LogiRouteNavState | null | undefined,
  b: LogiRouteNavState | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.module === b.module &&
    a.subView === b.subView &&
    a.modal === b.modal &&
    a.selectedId === b.selectedId &&
    a.userId === b.userId
  );
}
