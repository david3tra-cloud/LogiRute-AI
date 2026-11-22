import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AddDeCAToRoutesResult, DeCA } from "../types";

const TEST_USER_ID = "deca-bulk-routes-react-user";

const mocks = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getCurrentUserId: vi.fn(),
  listUserDecas: vi.fn(),
  mapSupabaseDecaToLocal: vi.fn(),
  retryPendingDecaDeletes: vi.fn(),
  listUserEmpresasHabituales: vi.fn(),
  unused: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { onAuthStateChange: mocks.onAuthStateChange },
  },
}));

vi.mock("../empresasHabitualesSupabaseService", () => ({
  deleteUserEmpresaHabitual: mocks.unused,
  getEmpresaRowByIdForUser: mocks.unused,
  insertUserEmpresaHabitual: mocks.unused,
  listUserEmpresasHabituales: mocks.listUserEmpresasHabituales,
  loadUserEmpresaHabitualForDeCA: mocks.unused,
  mapSupabaseEmpresaHabitualToLocal: mocks.unused,
  payloadMatchesEmpresaRow: mocks.unused,
  updateUserEmpresaHabitual: mocks.unused,
}));

vi.mock("../transportistasHabitualesSupabaseService", () => ({
  loadUserTransportistasWithTombstones: mocks.unused,
  mapSupabaseTransportistaHabitualToLocal: mocks.unused,
  migrateUserTransportistasHabituales: mocks.unused,
  syncUserTransportistasHabituales: mocks.unused,
}));

vi.mock("../decaSupabaseService", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
  calculateBlobSha256: mocks.unused,
  deleteUserDeca: mocks.unused,
  finalizeUserDecaEmission: mocks.unused,
  getOfficialDeCAPdfLocation: mocks.unused,
  getUserDecaById: mocks.unused,
  insertUserDeca: mocks.unused,
  listUserDecas: mocks.listUserDecas,
  mapSupabaseDecaToLocal: mocks.mapSupabaseDecaToLocal,
  recordUserDecaEmissionFailure: mocks.unused,
  reserveUserDecaEmission: mocks.unused,
  uploadOfficialDeCAPdf: mocks.unused,
  updateUserDeca: mocks.unused,
}));

vi.mock("../decaDeletionService", () => ({
  retryPendingDecaDeletes: mocks.retryPendingDecaDeletes,
  deleteDecaDocument: mocks.unused,
  processCompletedInFlightInsert: mocks.unused,
}));

vi.mock("../googleDriveService", () => ({
  DriveServiceError: class extends Error {},
  isGoogleDriveConfigured: () => false,
  loadGoogleIdentityServices: mocks.unused,
  requestDriveAccessToken: mocks.unused,
  uploadDeCAPdf: mocks.unused,
}));

vi.mock("../decaPdfService", () => ({
  generateDeCAPdf: mocks.unused,
  generateOfficialDeCAPdf: mocks.unused,
}));

vi.mock("../decaOcr", () => ({
  DACHSER_SIGNAL_LABELS: {},
  getImageDimensions: mocks.unused,
  recognizeDachserRegions: mocks.unused,
  detectDachserTemplateSignals: mocks.unused,
}));

vi.mock("../DestinatariosManager", () => ({ default: () => null }));
vi.mock("../TransportistasManager", () => ({ default: () => null }));

import DeCASection from "../DeCASection";

const makeDeCA = (
  id: string,
  estado: DeCA["estado"] = "EMITIDO",
): DeCA => ({
  id,
  fecha: "2026-01-01",
  cargador: "Cargador",
  transportista: "Transportista",
  destinatario: `Destinatario ${id}`,
  direccionDestino: "Calle 1",
  ciudadDestino: "Madrid",
  mercancia: "Mercancía",
  referenciaAlbaran: "",
  matriculaVehiculo: "",
  notas: "",
  estado,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const renderRouteList = async (
  decas: DeCA[],
  routedIds: Set<string>,
  onAddToRoutes: (deca: DeCA) => Promise<AddDeCAToRoutesResult>,
) => {
  mocks.listUserDecas.mockResolvedValue(
    decas.map((deca) => ({
      id: deca.id,
      user_id: TEST_USER_ID,
      deleted_at: null,
      __local: deca,
    })),
  );
  render(
    <DeCASection
      isDeCAInRoutes={(id) => routedIds.has(id)}
      onAddToRoutes={onAddToRoutes}
      sessionUserId={TEST_USER_ID}
      navSubView="list"
    />,
  );
  return screen.findByRole("button", { name: /Pasar a ruta/ });
};

const selectionCheckbox = (id: string) =>
  screen.getByTestId(`deca-select-${id}`) as HTMLInputElement;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  mocks.getCurrentUserId.mockResolvedValue(TEST_USER_ID);
  mocks.listUserDecas.mockResolvedValue([]);
  mocks.mapSupabaseDecaToLocal.mockImplementation(
    (row: { __local: DeCA }) => row.__local,
  );
  mocks.retryPendingDecaDeletes.mockResolvedValue({
    completedIds: [],
    results: [],
  });
  mocks.listUserEmpresasHabituales.mockResolvedValue([]);
});

describe("DeCASection bulk route addition", () => {
  it("counts only selected emitted DeCAs that are not already routed", async () => {
    const routedIds = new Set(["already-routed"]);
    const decas = [
      makeDeCA("eligible-one"),
      makeDeCA("eligible-two"),
      makeDeCA("draft", "borrador"),
      makeDeCA("already-routed"),
      makeDeCA("emitting", "EMITIENDO"),
    ];
    const onAddToRoutes = vi.fn(async () => ({
      status: "added" as const,
      coordinatesAvailable: true,
    }));

    const routeButton = await renderRouteList(
      decas,
      routedIds,
      onAddToRoutes,
    );
    expect((routeButton as HTMLButtonElement).disabled).toBe(true);
    expect(routeButton.textContent).toContain("Pasar a ruta (0)");
    expect(selectionCheckbox("emitting").disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar todo" }));

    expect((routeButton as HTMLButtonElement).disabled).toBe(false);
    expect(routeButton.textContent).toContain("Pasar a ruta (2)");
  });

  it("blocks incompatible actions, reports partial results, and retains only failures", async () => {
    const routedIds = new Set(["already-routed"]);
    const decas = [
      makeDeCA("added"),
      makeDeCA("without-coordinates"),
      makeDeCA("failed"),
      makeDeCA("draft", "borrador"),
      makeDeCA("already-routed"),
    ];
    let resolveFirst:
      | ((result: AddDeCAToRoutesResult) => void)
      | undefined;
    let failFirstAttempt = true;
    const onAddToRoutes = vi.fn(
      (deca: DeCA): Promise<AddDeCAToRoutesResult> => {
        if (deca.id === "added") {
          return new Promise((resolve) => {
            resolveFirst = (result) => {
              routedIds.add(deca.id);
              resolve(result);
            };
          });
        }
        if (deca.id === "without-coordinates") {
          routedIds.add(deca.id);
          return Promise.resolve({
            status: "added",
            coordinatesAvailable: false,
          });
        }
        if (deca.id === "failed" && failFirstAttempt) {
          failFirstAttempt = false;
          return Promise.reject(new Error("fallo temporal"));
        }
        routedIds.add(deca.id);
        return Promise.resolve({
          status: "added",
          coordinatesAvailable: true,
        });
      },
    );

    const routeButton = await renderRouteList(
      decas,
      routedIds,
      onAddToRoutes,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar todo" }));
    expect(routeButton.textContent).toContain("Pasar a ruta (3)");
    fireEvent.click(routeButton);

    await waitFor(() => expect(onAddToRoutes).toHaveBeenCalledTimes(1));
    expect((routeButton as HTMLButtonElement).disabled).toBe(true);
    expect(routeButton.textContent).toContain("Pasando a ruta…");
    expect(
      screen.getByRole("button", { name: "Limpiar selección" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /Emitir borradores seleccionados/ }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /Eliminar seleccionados/ }),
    ).toHaveProperty("disabled", true);
    expect(selectionCheckbox("added").disabled).toBe(true);

    await act(async () => {
      resolveFirst?.({ status: "added", coordinatesAvailable: true });
    });

    expect(
      await screen.findByText("Añadidos: 2; omitidos: 2; errores: 1."),
    ).toBeTruthy();
    expect(
      screen.getByRole("alert"),
    ).toHaveProperty(
      "textContent",
      expect.stringContaining("without-coordinates se añadieron sin coordenadas"),
    );
    expect(screen.getByText("failed: fallo temporal")).toBeTruthy();
    expect(selectionCheckbox("added").checked).toBe(false);
    expect(selectionCheckbox("without-coordinates").checked).toBe(false);
    expect(selectionCheckbox("draft").checked).toBe(false);
    expect(selectionCheckbox("already-routed").checked).toBe(false);
    expect(selectionCheckbox("failed").checked).toBe(true);
    expect(routeButton.textContent).toContain("Pasar a ruta (1)");

    fireEvent.click(routeButton);
    await waitFor(() =>
      expect(
        screen.getByText("Añadidos: 1; omitidos: 0; errores: 0."),
      ).toBeTruthy(),
    );

    expect(onAddToRoutes.mock.calls.map(([deca]) => deca.id)).toEqual([
      "added",
      "without-coordinates",
      "failed",
      "failed",
    ]);
    expect(selectionCheckbox("failed").checked).toBe(false);
    expect(routedIds).toEqual(
      new Set(["already-routed", "added", "without-coordinates", "failed"]),
    );
  });
});
