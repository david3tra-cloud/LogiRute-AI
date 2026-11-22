import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "deca-identities-user";
const TRANSPORTISTAS_KEY = `logiroute_transportistas_v1:${encodeURIComponent(TEST_USER_ID)}`;
const DECA_STORAGE_KEY = `transport_app_decas:${encodeURIComponent(TEST_USER_ID)}`;
const carrierStorageKey = (userId: string) =>
  `logiroute_transportistas_v1:${encodeURIComponent(userId)}`;
const carrierDeleteStorageKey = (userId: string) =>
  `logiroute_transportistas_pending_deletes_v1:${encodeURIComponent(userId)}`;
const carrierPendingSyncStorageKey = (userId: string) =>
  `logiroute_transportistas_pending_sync_v1:${encodeURIComponent(userId)}`;
const carrierUserStorageSnapshot = (userIds: string[]) =>
  Object.fromEntries(
    userIds.flatMap((userId) =>
      [
        carrierStorageKey(userId),
        carrierDeleteStorageKey(userId),
        carrierPendingSyncStorageKey(userId),
      ].map((key) => [key, window.localStorage.getItem(key)]),
    ),
  );
const carrierStorageWrites = (
  setItem: ReturnType<typeof vi.spyOn<Storage, "setItem">>,
) =>
  setItem.mock.calls
    .filter(([key]) => String(key).startsWith("logiroute_transportistas"))
    .map(([key]) => key);

const mocks = vi.hoisted(() => {
  const unexpectedCalls: string[] = [];
  const unexpected = (name: string): never => {
    unexpectedCalls.push(name);
    throw new Error(`Unexpected service call: ${name}`);
  };
  const rows: Array<Record<string, unknown>> = [];
  let showTransportistaManagerHarness = false;
  const loadTransportistasWithTombstones = vi.fn<
    () => Promise<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>
  >(async () => ({ activeRows: [], deletedLocalIds: [] }));
  const getCurrentUserId = vi.fn(async () => "deca-identities-user");
  const listUserDecas = vi.fn(async () => rows);
  const insertUserDeca = vi.fn<
    (deca: Record<string, unknown>) => Promise<Record<string, unknown>>
  >(() => unexpected("insertUserDeca"));
  const getUserDecaById = vi.fn(() => unexpected("getUserDecaById"));
  const mapSupabaseDecaToLocal = vi.fn(
    (row: { __local: Record<string, unknown> }) => ({ ...row.__local }),
  );
  const authSubscription = { unsubscribe: vi.fn() };

  return {
    unexpectedCalls,
    rows,
    showTransportistaManagerHarness,
    loadTransportistasWithTombstones,
    getCurrentUserId,
    listUserDecas,
    insertUserDeca,
    getUserDecaById,
    mapSupabaseDecaToLocal,
    authSubscription,
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: authSubscription },
    })),
    companyService: {
      deleteUserEmpresaHabitual: vi.fn(() => unexpected("deleteUserEmpresaHabitual")),
      getEmpresaRowByIdForUser: vi.fn(() => unexpected("getEmpresaRowByIdForUser")),
      insertUserEmpresaHabitual: vi.fn(() => unexpected("insertUserEmpresaHabitual")),
      listUserEmpresasHabituales: vi.fn(() => unexpected("listUserEmpresasHabituales")),
      loadUserEmpresaHabitualForDeCA: vi.fn(() => unexpected("loadUserEmpresaHabitualForDeCA")),
      mapSupabaseEmpresaHabitualToLocal: vi.fn(() =>
        unexpected("mapSupabaseEmpresaHabitualToLocal"),
      ),
      payloadMatchesEmpresaRow: vi.fn(() => unexpected("payloadMatchesEmpresaRow")),
      updateUserEmpresaHabitual: vi.fn(() => unexpected("updateUserEmpresaHabitual")),
    },
    carrierService: {
      loadUserTransportistasWithTombstones:
        loadTransportistasWithTombstones,
      mapSupabaseTransportistaHabitualToLocal: vi.fn(
        (row: { __local: Record<string, unknown> }) => ({ ...row.__local }),
      ),
      migrateUserTransportistasHabituales: vi.fn(() =>
        unexpected("migrateUserTransportistasHabituales"),
      ),
      syncUserTransportistasHabituales: vi.fn(() =>
        unexpected("syncUserTransportistasHabituales"),
      ),
    },
    decaService: {
      getCurrentUserId,
      calculateBlobSha256: vi.fn(() => unexpected("calculateBlobSha256")),
      deleteUserDeca: vi.fn(() => unexpected("deleteUserDeca")),
      finalizeUserDecaEmission: vi.fn(() => unexpected("finalizeUserDecaEmission")),
      getOfficialDeCAPdfLocation: vi.fn(() =>
        unexpected("getOfficialDeCAPdfLocation"),
      ),
      getUserDecaById,
      insertUserDeca,
      listUserDecas,
      mapSupabaseDecaToLocal,
      recordUserDecaEmissionFailure: vi.fn(() =>
        unexpected("recordUserDecaEmissionFailure"),
      ),
      reserveUserDecaEmission: vi.fn(() => unexpected("reserveUserDecaEmission")),
      uploadOfficialDeCAPdf: vi.fn(() => unexpected("uploadOfficialDeCAPdf")),
      updateUserDeca: vi.fn(() => unexpected("updateUserDeca")),
    },
    deletionService: {
      retryPendingDecaDeletes: vi.fn(async () => ({
        completedIds: [],
        results: [],
      })),
      deleteDecaDocument: vi.fn(() => unexpected("deleteDecaDocument")),
      processCompletedInFlightInsert: vi.fn(async () => ({
        wasMarkedForDeletion: false,
      })),
    },
    driveService: {
      loadGoogleIdentityServices: vi.fn(() =>
        unexpected("loadGoogleIdentityServices"),
      ),
      requestDriveAccessToken: vi.fn(() => unexpected("requestDriveAccessToken")),
      uploadDeCAPdf: vi.fn(() => unexpected("uploadDeCAPdf")),
    },
    pdfService: {
      generateDeCAPdf: vi.fn(() => unexpected("generateDeCAPdf")),
      generateOfficialDeCAPdf: vi.fn(() =>
        unexpected("generateOfficialDeCAPdf"),
      ),
    },
    ocrService: {
      getImageDimensions: vi.fn(() => unexpected("getImageDimensions")),
      recognizeDachserRegions: vi.fn(() =>
        unexpected("recognizeDachserRegions"),
      ),
      detectDachserTemplateSignals: vi.fn(() =>
        unexpected("detectDachserTemplateSignals"),
      ),
    },
  };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { onAuthStateChange: mocks.onAuthStateChange },
  },
}));
vi.mock("../empresasHabitualesSupabaseService", () => ({
  ...mocks.companyService,
}));
vi.mock("../transportistasHabitualesSupabaseService", () => ({
  ...mocks.carrierService,
}));
vi.mock("../decaSupabaseService", () => ({
  ...mocks.decaService,
}));
vi.mock("../decaDeletionService", () => ({
  ...mocks.deletionService,
}));
vi.mock("../googleDriveService", () => ({
  DriveServiceError: class extends Error {},
  isGoogleDriveConfigured: () => false,
  ...mocks.driveService,
}));
vi.mock("../decaPdfService", () => ({
  ...mocks.pdfService,
}));
vi.mock("../decaOcr", () => ({
  DACHSER_SIGNAL_LABELS: {},
  ...mocks.ocrService,
}));
vi.mock("../DestinatariosManager", () => ({ default: () => null }));
vi.mock("../TransportistasManager", () => ({
  default: (props: {
    transportistas: TransportistaHabitual[];
    onChange: (items: TransportistaHabitual[]) => void;
  }) =>
    mocks.showTransportistaManagerHarness ? (
      <button
        type="button"
        onClick={() =>
          props.onChange(
            props.transportistas.map((item) => ({
              ...item,
              nombre: `${item.nombre} actualizado`,
            })),
          )
        }
      >
        Guardar cambio de catálogo simulado
      </button>
    ) : null,
}));

import DeCASection from "../DeCASection";
import type { EmpresaHabitual, TransportistaHabitual } from "../types";

const makeCompany = (
  id: string,
  nombre: string,
  nif: string,
): EmpresaHabitual => ({
  id,
  nombre,
  nif,
  direccion: `Calle ${id} 1`,
  ciudad: "Madrid",
  codigoPostal: "28001",
  provincia: "Madrid",
  pais: "España",
  telefono: "",
  email: "",
  contacto: "",
  notas: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const makeCarrier = (
  id: string,
  nombre = `Transportista ${id}`,
  isDefault = false,
): TransportistaHabitual => ({
  ...makeCompany(id, nombre, `NIF-${id}`),
  esPredeterminado: isDefault,
});

const remoteCarrierRow = (carrier: TransportistaHabitual) => ({
  __local: carrier,
});

const makeRemoteDeCA = (deca: Record<string, unknown>, id: string) => ({
  id,
  user_id: TEST_USER_ID,
  deleted_at: null,
  estado: "BORRADOR",
  __local: { ...deca, id, estado: "borrador" },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderSection = (
  subView: "form" | "list" | "detail" = "list",
  options: { userId?: string | null; selectedId?: string } = {},
) =>
  render(
    <DeCASection
      isDeCAInRoutes={() => false}
      onAddToRoutes={async () => ({ status: "in-progress" })}
      sessionUserId={
        options.userId === undefined ? TEST_USER_ID : options.userId
      }
      navSubView={subView}
      navSelectedId={options.selectedId}
    />,
  );

const fieldValue = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;

const changeField = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const seedCompanies = (companies: EmpresaHabitual[]) =>
  window.localStorage.setItem(
    "logiroute_empresas_v1",
    JSON.stringify(companies),
  );

const seedCarriers = (carriers: TransportistaHabitual[]) =>
  window.localStorage.setItem(TRANSPORTISTAS_KEY, JSON.stringify(carriers));

const seedCarrierCatalog = (
  userId: string,
  carriers: TransportistaHabitual[],
) =>
  window.localStorage.setItem(
    carrierStorageKey(userId),
    JSON.stringify(carriers),
  );

const openBulkForm = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: /DeCA masivo/i }),
  );
  await screen.findByRole("heading", { name: "Crear DeCAs en bloque" });
};

const fillBulkRequiredFields = () => {
  changeField("Matrícula", "1234-ABC");
  changeField("Ciudad de destino", "Sevilla");
  changeField("Mercancía", "Palés");
  changeField("Bultos", "0");
  changeField("Peso (kg)", "0");
};

const createBulk = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Crear DeCAs" }));
  await waitFor(() => {
    expect(mocks.insertUserDeca).toHaveBeenCalledTimes(1);
  });
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.unexpectedCalls.length = 0;
  mocks.showTransportistaManagerHarness = false;
  mocks.rows.length = 0;
  mocks.loadTransportistasWithTombstones.mockResolvedValue({
    activeRows: [],
    deletedLocalIds: [],
  });
  mocks.listUserDecas.mockResolvedValue([]);
  mocks.getCurrentUserId.mockResolvedValue(TEST_USER_ID);
  mocks.insertUserDeca.mockImplementation(async (deca) => {
    const row = makeRemoteDeCA(deca, `remote-deca-${mocks.rows.length + 1}`);
    mocks.rows.push(row);
    return row;
  });
  mocks.mapSupabaseDecaToLocal.mockImplementation(
    (row: { __local: Record<string, unknown> }) => ({ ...row.__local }),
  );
});

afterEach(() => {
  const unexpectedCalls = [...mocks.unexpectedCalls];
  vi.restoreAllMocks();
  expect(unexpectedCalls).toEqual([]);
});

describe("identidades y carga del transportista en DeCASection", () => {
  it("conserva el ID/NIF del cargador y el NIF del destinatario elegidos entre homónimos", async () => {
    const loaderA = makeCompany("loader-a", "Cargador Compartido", "C-1");
    const loaderB = makeCompany("loader-b", "Cargador Compartido", "C-2");
    const recipientA = makeCompany("recipient-a", "Destino Compartido", "D-1");
    const recipientB = makeCompany("recipient-b", "Destino Compartido", "D-2");
    seedCompanies([loaderA, loaderB, recipientA, recipientB]);
    renderSection();
    await openBulkForm();

    changeField("Cargador común", loaderA.nombre);
    fireEvent.click(
      await screen.findByRole("option", {
        name: /Cargador Compartido.*NIF C-2/,
      }),
    );
    changeField("Destinatario de la línea 1", recipientA.nombre);
    fireEvent.click(
      await screen.findByRole("option", {
        name: /Destino Compartido.*NIF D-2/,
      }),
    );
    fillBulkRequiredFields();
    await createBulk();

    expect(mocks.insertUserDeca).toHaveBeenCalledWith(
      expect.objectContaining({
        cargador: loaderB.nombre,
        cargadorId: loaderB.id,
        cargadorNif: loaderB.nif,
        destinatario: recipientB.nombre,
        destinatarioNif: recipientB.nif,
      }),
    );
  });

  it("bloquea nombres ambiguos sin selección y muestra el rol correcto", async () => {
    seedCompanies([
      makeCompany("loader-a", "Cargador Compartido", "C-1"),
      makeCompany("loader-b", "Cargador Compartido", "C-2"),
      makeCompany("recipient-a", "Destino Compartido", "D-1"),
      makeCompany("recipient-b", "Destino Compartido", "D-2"),
    ]);
    renderSection();
    await openBulkForm();
    changeField("Cargador común", "Cargador Compartido");
    changeField("Destinatario de la línea 1", "Destino Compartido");

    expect(
      screen.getByText(
        "Hay varias fichas de cargador coincidentes; selecciona una ficha concreta.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Hay varias fichas de destinatario coincidentes; selecciona una ficha concreta.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Crear DeCAs" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.insertUserDeca).not.toHaveBeenCalled();
  });

  it("invalida las identidades masivas al editar manualmente los nombres", async () => {
    const loader = makeCompany("loader", "Cargador Elegido", "C-1");
    const recipient = makeCompany("recipient", "Destino Elegido", "D-1");
    seedCompanies([loader, recipient]);
    renderSection();
    await openBulkForm();

    changeField("Cargador común", loader.nombre);
    fireEvent.click(
      await screen.findByRole("option", { name: /Cargador Elegido.*NIF C-1/ }),
    );
    changeField("Destinatario de la línea 1", recipient.nombre);
    fireEvent.click(
      await screen.findByRole("option", { name: /Destino Elegido.*NIF D-1/ }),
    );
    changeField("Cargador común", "Cargador escrito a mano");
    changeField("Destinatario de la línea 1", "Destino escrito a mano");
    fillBulkRequiredFields();
    await createBulk();

    expect(mocks.insertUserDeca).toHaveBeenCalledWith(
      expect.objectContaining({
        cargadorId: undefined,
        cargadorNif: undefined,
        destinatarioNif: undefined,
      }),
    );
  });

  it("usa el predeterminado local al abrir directamente creación individual y masiva", async () => {
    const localDefault = makeCarrier("local-default", "Predeterminado local", true);
    seedCarriers([localDefault]);

    const individual = renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    expect(fieldValue("Nombre")).toBe(localDefault.nombre);
    individual.unmount();

    renderSection();
    await openBulkForm();
    expect(fieldValue("Transportista común, opcional")).toBe(
      localDefault.nombre,
    );
  });

  it("aplica el predeterminado remoto al formulario nuevo sin visitar Transportistas ni escribir el catálogo", async () => {
    const remoteDefault = makeCarrier(
      "remote-default",
      "Predeterminado remoto",
      true,
    );
    const load = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones.mockReturnValueOnce(load.promise);
    const view = renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    expect(fieldValue("Nombre")).toBe("");

    load.resolve({
      activeRows: [remoteCarrierRow(remoteDefault)],
      deletedLocalIds: [],
    });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(remoteDefault.nombre);
    });
    expect(window.localStorage.getItem(TRANSPORTISTAS_KEY)).toBeNull();
    expect(
      mocks.carrierService.migrateUserTransportistasHabituales,
    ).not.toHaveBeenCalled();
    expect(
      mocks.carrierService.syncUserTransportistasHabituales,
    ).not.toHaveBeenCalled();
    view.unmount();
  });

  it("aplica un predeterminado remoto a la creación masiva abierta durante la carga", async () => {
    const remoteDefault = makeCarrier(
      "remote-default",
      "Predeterminado remoto",
      true,
    );
    const load = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones.mockReturnValueOnce(load.promise);
    renderSection();
    await openBulkForm();
    expect(fieldValue("Transportista común, opcional")).toBe("");

    load.resolve({
      activeRows: [remoteCarrierRow(remoteDefault)],
      deletedLocalIds: [],
    });
    await waitFor(() => {
      expect(fieldValue("Transportista común, opcional")).toBe(
        remoteDefault.nombre,
      );
    });
  });

  it("no sobrescribe un transportista elegido o editado antes de terminar la carga", async () => {
    const localCarrier = makeCarrier("local-carrier", "Transportista local");
    const remoteDefault = makeCarrier(
      "remote-default",
      "Predeterminado remoto",
      true,
    );
    seedCarriers([localCarrier]);
    const load = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones.mockReturnValueOnce(load.promise);
    const view = renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    const search = screen.getByRole("textbox", {
      name: "Buscar transportista habitual",
    });
    fireEvent.change(search, { target: { value: localCarrier.nif } });
    fireEvent.click(
      await screen.findByRole("option", {
        name: new RegExp(localCarrier.nombre),
      }),
    );

    load.resolve({
      activeRows: [remoteCarrierRow(remoteDefault)],
      deletedLocalIds: [],
    });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(localCarrier.nombre);
    });
    expect(fieldValue("NIF")).toBe(localCarrier.nif);
    view.unmount();

    const secondLoad = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones.mockReturnValueOnce(secondLoad.promise);
    renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    changeField("Nombre", "Transportista escrito a mano");
    secondLoad.resolve({
      activeRows: [remoteCarrierRow(remoteDefault)],
      deletedLocalIds: [],
    });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe("Transportista escrito a mano");
    });
  });

  it("mantiene el catálogo local de B y descarta la respuesta remota pendiente de A", async () => {
    const userA = "previous-user";
    const userB = "current-user";
    const carrierA = makeCarrier("carrier-a", "Transportista A", true);
    const carrierB = makeCarrier("carrier-b", "Transportista B", true);
    seedCarrierCatalog(userA, [carrierA]);
    seedCarrierCatalog(userB, [carrierB]);
    const previousLoad = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    const currentLoad = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones
      .mockReturnValueOnce(previousLoad.promise)
      .mockReturnValueOnce(currentLoad.promise);
    const view = renderSection("form", { userId: userA });
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    expect(fieldValue("Nombre")).toBe(carrierA.nombre);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const storageBefore = carrierUserStorageSnapshot([userA, userB]);

    view.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={userB}
        navSubView="form"
      />,
    );
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierB.nombre);
    });
    expect(carrierStorageWrites(setItem)).toEqual([]);

    previousLoad.resolve({
      activeRows: [remoteCarrierRow(makeCarrier("old-user", "Transportista anterior", true))],
      deletedLocalIds: [],
    });
    currentLoad.resolve({
      activeRows: [],
      deletedLocalIds: [],
    });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierB.nombre);
    });
    expect(carrierUserStorageSnapshot([userA, userB])).toEqual(storageBefore);
    expect(carrierStorageWrites(setItem)).toEqual([]);
  });

  it("no reutiliza ni persiste el catálogo de A cuando B no tiene catálogo local", async () => {
    const userA = "catalog-owner-a";
    const userB = "catalog-owner-b-empty";
    const carrierA = makeCarrier("carrier-a", "Transportista A", true);
    seedCarrierCatalog(userA, [carrierA]);
    const view = renderSection("form", { userId: userA });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierA.nombre);
    });

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const storageBefore = carrierUserStorageSnapshot([userA, userB]);
    view.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={userB}
        navSubView="form"
      />,
    );

    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe("");
    });
    expect(carrierUserStorageSnapshot([userA, userB])).toEqual(storageBefore);
    expect(carrierStorageWrites(setItem)).toEqual([]);
  });

  it("no escribe el catálogo de A al cerrar sesión", async () => {
    const userA = "catalog-owner-a";
    const carrierA = makeCarrier("carrier-a", "Transportista A", true);
    seedCarrierCatalog(userA, [carrierA]);
    const view = renderSection("form", { userId: userA });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierA.nombre);
    });

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const storageBefore = carrierUserStorageSnapshot([userA]);
    const anonymousKeyBefore = window.localStorage.getItem(
      "logiroute_transportistas_v1",
    );
    view.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={null}
        navSubView="form"
      />,
    );

    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe("");
    });
    expect(carrierUserStorageSnapshot([userA])).toEqual(storageBefore);
    expect(window.localStorage.getItem("logiroute_transportistas_v1")).toBe(
      anonymousKeyBefore,
    );
    expect(carrierStorageWrites(setItem)).toEqual([]);
  });

  it("reemplaza el transportista en formularios individuales y masivos al cambiar de usuario", async () => {
    const userA = "form-owner-a";
    const userB = "form-owner-b";
    const carrierA = makeCarrier("carrier-a", "Transportista A", true);
    const carrierB = makeCarrier("carrier-b", "Transportista B", true);
    seedCarrierCatalog(userA, [carrierA]);
    seedCarrierCatalog(userB, [carrierB]);

    const individual = renderSection("form", { userId: userA });
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierA.nombre);
    });
    individual.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={userB}
        navSubView="form"
      />,
    );
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierB.nombre);
    });
    individual.unmount();

    const bulk = renderSection("list", { userId: userA });
    await openBulkForm();
    await waitFor(() => {
      expect(fieldValue("Transportista común, opcional")).toBe(
        carrierA.nombre,
      );
    });
    bulk.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={userB}
        navSubView="list"
        navModal="decaBulk"
      />,
    );
    await waitFor(() => {
      expect(fieldValue("Transportista común, opcional")).toBe(
        carrierB.nombre,
      );
    });
  });

  it("guarda una modificación legítima solo en el catálogo local de B", async () => {
    const userA = "catalog-owner-a";
    const userB = "catalog-owner-b";
    const carrierA = makeCarrier("carrier-a", "Transportista A", true);
    const carrierB = makeCarrier("carrier-b", "Transportista B", true);
    seedCarrierCatalog(userA, [carrierA]);
    seedCarrierCatalog(userB, [carrierB]);
    mocks.showTransportistaManagerHarness = true;

    const view = renderSection("form", { userId: userA });
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    view.rerender(
      <DeCASection
        isDeCAInRoutes={() => false}
        onAddToRoutes={async () => ({ status: "in-progress" })}
        sessionUserId={userB}
        navSubView="form"
      />,
    );
    await waitFor(() => {
      expect(fieldValue("Nombre")).toBe(carrierB.nombre);
    });

    const keyB = carrierStorageKey(userB);
    const storageBeforeA = carrierUserStorageSnapshot([userA]);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(
      screen.getByRole("button", { name: /Gestionar transportistas/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Guardar cambio de catálogo simulado",
      }),
    );

    const savedB = JSON.parse(window.localStorage.getItem(keyB) ?? "[]") as
      TransportistaHabitual[];
    expect(savedB[0].nombre).toBe(`${carrierB.nombre} actualizado`);
      expect(carrierUserStorageSnapshot([userA])).toEqual(storageBeforeA);
      expect(carrierStorageWrites(setItem)).toEqual([
        keyB,
        carrierDeleteStorageKey(userB),
      ]);
    expect(mocks.carrierService.syncUserTransportistasHabituales)
      .not.toHaveBeenCalled();
    expect(mocks.carrierService.migrateUserTransportistasHabituales)
      .not.toHaveBeenCalled();
  });

  it("conserva datos locales si falla la lectura y no inventa un predeterminado", async () => {
    const localDefault = makeCarrier("local-default", "Predeterminado local", true);
    seedCarriers([localDefault]);
    mocks.loadTransportistasWithTombstones.mockRejectedValueOnce(
      new Error("Fallo remoto simulado"),
    );
    const localView = renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    await screen.findByText(/Se conserva el catálogo local/);
    expect(fieldValue("Nombre")).toBe(localDefault.nombre);
    localView.unmount();

    window.localStorage.removeItem(TRANSPORTISTAS_KEY);
    mocks.loadTransportistasWithTombstones.mockRejectedValueOnce(
      new Error("Fallo remoto simulado"),
    );
    const emptyView = renderSection("form");
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    await screen.findByText(/Se conserva el catálogo local/);
    expect(fieldValue("Nombre")).toBe("");
    expect(
      (screen.getByRole("textbox", {
        name: "Buscar transportista habitual",
      }) as HTMLInputElement).disabled,
    ).toBe(false);
    emptyView.unmount();
  });

  it("bloquea la emisión mientras se resuelve el catálogo inicial", async () => {
    const pendingLoad = deferred<{
      activeRows: Array<Record<string, unknown>>;
      deletedLocalIds: string[];
    }>();
    mocks.loadTransportistasWithTombstones.mockReturnValueOnce(
      pendingLoad.promise,
    );
    const draft = {
      id: "local-draft",
      fecha: "2026-11-22",
      cargador: "Cargador",
      transportista: "Transportista",
      destinatario: "Destino",
      direccionDestino: "Calle 1",
      ciudadDestino: "Madrid",
      mercancia: "Cajas",
      matriculaVehiculo: "1234-ABC",
      notas: "",
      estado: "borrador" as const,
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      referenciaAlbaran: "",
    };
    window.localStorage.setItem(DECA_STORAGE_KEY, JSON.stringify([draft]));
    const remoteDraft = makeRemoteDeCA(draft, draft.id);
    mocks.rows.push(remoteDraft);
    mocks.listUserDecas.mockResolvedValue([remoteDraft]);
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir DeCA de Destino",
      }),
    );

    const emitButton = await screen.findByRole("button", {
      name: "Emitir DeCA",
    });
    expect((emitButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(emitButton);
    expect(mocks.getUserDecaById).not.toHaveBeenCalled();
    expect(mocks.decaService.reserveUserDecaEmission).not.toHaveBeenCalled();
  });
});
