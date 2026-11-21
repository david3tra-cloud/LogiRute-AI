import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "transportista-integration-user";
const TRANSPORTISTAS_KEY = `logiroute_transportistas_v1:${encodeURIComponent(TEST_USER_ID)}`;

const mocks = vi.hoisted(() => {
  const unexpectedCalls: string[] = [];
  const failureRestorers: Array<() => void> = [];
  const unexpected = (name: string): never => {
      unexpectedCalls.push(name);
      throw new Error(`Unexpected service call: ${name}`);
  };
  const fail = (name: string) => {
    const implementation = () => unexpected(name);
    const mock = vi.fn(implementation);
    failureRestorers.push(() => mock.mockImplementation(implementation));
    return mock;
  };
  const onAuthStateChange = vi.fn<
    () => { data: { subscription: { unsubscribe: () => void } } }
  >(() => unexpected("supabase.auth.onAuthStateChange"));
  failureRestorers.push(() =>
    onAuthStateChange.mockImplementation(() =>
      unexpected("supabase.auth.onAuthStateChange"),
    ),
  );
  const getCurrentUserId = vi.fn<() => Promise<string | null>>(() =>
    unexpected("getCurrentUserId"),
  );
  failureRestorers.push(() =>
    getCurrentUserId.mockImplementation(() => unexpected("getCurrentUserId")),
  );
  const insertUserDeca = vi.fn<
    (deca: Record<string, unknown>) => Promise<Record<string, unknown>>
  >(() => unexpected("insertUserDeca"));
  failureRestorers.push(() =>
    insertUserDeca.mockImplementation(() => unexpected("insertUserDeca")),
  );
  const listUserDecas = vi.fn<
    () => Promise<Array<Record<string, unknown>>>
  >(() => unexpected("listUserDecas"));
  failureRestorers.push(() =>
    listUserDecas.mockImplementation(() => unexpected("listUserDecas")),
  );
  const mapSupabaseDecaToLocal = vi.fn<
    (row: { __local: Record<string, unknown> }) => Record<string, unknown>
  >(() => unexpected("mapSupabaseDecaToLocal"));
  failureRestorers.push(() =>
    mapSupabaseDecaToLocal.mockImplementation(() =>
      unexpected("mapSupabaseDecaToLocal"),
    ),
  );
  const updateUserDeca = vi.fn<
    (
      id: string,
      changes: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
  >(() => unexpected("updateUserDeca"));
  failureRestorers.push(() =>
    updateUserDeca.mockImplementation(() => unexpected("updateUserDeca")),
  );
  const retryPendingDecaDeletes = vi.fn<
    () => Promise<{ completedIds: string[]; results: unknown[] }>
  >(() => unexpected("retryPendingDecaDeletes"));
  failureRestorers.push(() =>
    retryPendingDecaDeletes.mockImplementation(() =>
      unexpected("retryPendingDecaDeletes"),
    ),
  );
  const processCompletedInFlightInsert = vi.fn<
    () => Promise<{ wasMarkedForDeletion: boolean }>
  >(() => unexpected("processCompletedInFlightInsert"));
  failureRestorers.push(() =>
    processCompletedInFlightInsert.mockImplementation(() =>
      unexpected("processCompletedInFlightInsert"),
    ),
  );

  return {
    unexpectedCalls,
    rows: [] as Array<Record<string, unknown>>,
    restoreFailures: () => {
      failureRestorers.forEach((restore) => restore());
    },
    authSubscription: {
      unsubscribe: vi.fn(),
    },
    onAuthStateChange,
    companyService: {
      deleteUserEmpresaHabitual: fail("deleteUserEmpresaHabitual"),
      getEmpresaRowByIdForUser: fail("getEmpresaRowByIdForUser"),
      insertUserEmpresaHabitual: fail("insertUserEmpresaHabitual"),
      listUserEmpresasHabituales: fail("listUserEmpresasHabituales"),
      loadUserEmpresaHabitualForDeCA: fail("loadUserEmpresaHabitualForDeCA"),
      mapSupabaseEmpresaHabitualToLocal: fail(
        "mapSupabaseEmpresaHabitualToLocal",
      ),
      payloadMatchesEmpresaRow: fail("payloadMatchesEmpresaRow"),
      updateUserEmpresaHabitual: fail("updateUserEmpresaHabitual"),
    },
    carrierService: {
      loadUserTransportistasWithTombstones: fail(
        "loadUserTransportistasWithTombstones",
      ),
      mapSupabaseTransportistaHabitualToLocal: fail(
        "mapSupabaseTransportistaHabitualToLocal",
      ),
      migrateUserTransportistasHabituales: fail(
        "migrateUserTransportistasHabituales",
      ),
      syncUserTransportistasHabituales: fail(
        "syncUserTransportistasHabituales",
      ),
    },
    decaService: {
      getCurrentUserId,
      calculateBlobSha256: fail("calculateBlobSha256"),
      deleteUserDeca: fail("deleteUserDeca"),
      finalizeUserDecaEmission: fail("finalizeUserDecaEmission"),
      getOfficialDeCAPdfLocation: fail("getOfficialDeCAPdfLocation"),
      getUserDecaById: fail("getUserDecaById"),
      insertUserDeca,
      listUserDecas,
      mapSupabaseDecaToLocal,
      recordUserDecaEmissionFailure: fail("recordUserDecaEmissionFailure"),
      reserveUserDecaEmission: fail("reserveUserDecaEmission"),
      uploadOfficialDeCAPdf: fail("uploadOfficialDeCAPdf"),
      updateUserDeca,
    },
    deletionService: {
      retryPendingDecaDeletes,
      deleteDecaDocument: fail("deleteDecaDocument"),
      processCompletedInFlightInsert,
    },
    driveService: {
      loadGoogleIdentityServices: fail("loadGoogleIdentityServices"),
      requestDriveAccessToken: fail("requestDriveAccessToken"),
      uploadDeCAPdf: fail("uploadDeCAPdf"),
    },
    pdfService: {
      generateDeCAPdf: fail("generateDeCAPdf"),
      generateOfficialDeCAPdf: fail("generateOfficialDeCAPdf"),
    },
    ocrService: {
      getImageDimensions: fail("getImageDimensions"),
      recognizeDachserRegions: fail("recognizeDachserRegions"),
      detectDachserTemplateSignals: fail("detectDachserTemplateSignals"),
    },
  };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}));

vi.mock("../../empresasHabitualesSupabaseService", () => ({
  ...mocks.companyService,
}));

vi.mock("../../transportistasHabitualesSupabaseService", () => ({
  ...mocks.carrierService,
}));

vi.mock("../../decaSupabaseService", () => ({
  ...mocks.decaService,
}));

vi.mock("../../decaDeletionService", () => ({
  ...mocks.deletionService,
}));

vi.mock("../../googleDriveService", () => ({
  DriveServiceError: class extends Error {},
  isGoogleDriveConfigured: () => false,
  ...mocks.driveService,
}));

vi.mock("../../decaPdfService", () => ({
  ...mocks.pdfService,
}));

vi.mock("../../decaOcr", () => ({
  DACHSER_SIGNAL_LABELS: {},
  ...mocks.ocrService,
}));

vi.mock("../../DestinatariosManager", () => ({
  default: () => null,
}));

vi.mock("../../TransportistasManager", () => ({
  default: () => null,
}));

import DeCASection from "../../DeCASection";

const carrierA = {
  id: "carrier-alpha",
  nombre: "Transportista Alpha",
  nif: "A-12345",
  direccion: "Calle Alpha 1",
  ciudad: "Madrid",
  codigoPostal: "28001",
  provincia: "Madrid",
  pais: "España",
  telefono: "600000001",
  email: "alpha@example.test",
  notas: "Ficha Alpha",
  esPredeterminado: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const carrierB = {
  ...carrierA,
  id: "carrier-beta",
  nombre: "Transportista Beta",
  nif: "B-23456",
  direccion: "Calle Beta 2",
  telefono: "600000002",
  email: "beta@example.test",
  notas: "Ficha Beta",
};

const seedCarriers = () => {
  window.localStorage.setItem(
    TRANSPORTISTAS_KEY,
    JSON.stringify([carrierA, carrierB]),
  );
};

const renderSection = (subView: "form" | "list" = "form") =>
  render(
    <DeCASection
      isDeCAInRoutes={() => false}
      onAddToRoutes={async () => {
        mocks.unexpectedCalls.push("onAddToRoutes");
        throw new Error("Unexpected route operation");
      }}
      sessionUserId={TEST_USER_ID}
      navSubView={subView}
    />,
  );

const formValue = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;

const changeField = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  });
};

const searchAndSelectCarrier = async (query: string, name: string) => {
  const search = screen.getByRole("textbox", {
    name: "Buscar transportista habitual",
  });
  fireEvent.change(search, { target: { value: query } });
  fireEvent.click(
    await screen.findByRole("option", {
      name: new RegExp(name),
    }),
  );
};

const fillDraftRequirements = () => {
  changeField("Destinatario o empresa", "Destino de integración");
  changeField("Dirección de destino", "Calle Destino 1");
  changeField("Ciudad de destino", "Valencia");
  changeField("Mercancía", "Cajas");
  changeField("Matrícula del vehículo", "1234-ABC");
};

const makeRemoteRow = (deca: Record<string, unknown>, id: string) => ({
  id,
  user_id: TEST_USER_ID,
  deleted_at: null,
  estado: "BORRADOR",
  transportista_habitual_id: deca.transportistaId || null,
  __local: {
    ...deca,
    id,
    estado: "borrador",
  },
});

const configureInsert = () => {
  mocks.decaService.insertUserDeca.mockImplementation(
    async (deca: Record<string, unknown>) => {
      const row = makeRemoteRow(
        deca,
        `remote-deca-${mocks.rows.length + 1}`,
      );
      mocks.rows.push(row);
      return row;
    },
  );
  mocks.deletionService.processCompletedInFlightInsert.mockResolvedValue({
    wasMarkedForDeletion: false,
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.restoreFailures();
  mocks.rows.length = 0;
  mocks.onAuthStateChange.mockReturnValue({
    data: {
      subscription: mocks.authSubscription,
    },
  });
  mocks.decaService.getCurrentUserId.mockResolvedValue(TEST_USER_ID);
  mocks.decaService.listUserDecas.mockImplementation(
    async () => mocks.rows,
  );
  mocks.decaService.mapSupabaseDecaToLocal.mockImplementation(
    (row: { __local: Record<string, unknown> }) => ({ ...row.__local }),
  );
  mocks.deletionService.retryPendingDecaDeletes.mockResolvedValue({
    completedIds: [],
    results: [],
  });
  seedCarriers();
});

afterEach(() => {
  expect(mocks.unexpectedCalls).toEqual([]);
});

describe("DeCASection: identidad del transportista en interacción React", () => {
  it.each([
    ["nombre", carrierB.nombre],
    ["NIF", carrierB.nif],
  ])(
    "buscar por %s y cancelar conserva el formulario y el vínculo previo",
    async (_kind, query) => {
      configureInsert();
      renderSection();
      await screen.findByRole("heading", { name: "Nuevo DeCA" });
      await searchAndSelectCarrier(carrierA.nif, carrierA.nombre);

      const before = {
        nombre: formValue("Nombre"),
        nif: formValue("NIF"),
        direccion: formValue("Dirección"),
      };
      const search = screen.getByRole("textbox", {
        name: "Buscar transportista habitual",
      });
      fireEvent.change(search, { target: { value: query } });
      await screen.findByRole("option", { name: new RegExp(carrierB.nombre) });
      fireEvent.keyDown(search, { key: "Escape" });

      expect(screen.queryByRole("option")).toBeNull();
      expect((search as HTMLInputElement).value).toBe(query);
      expect(formValue("Nombre")).toBe(before.nombre);
      expect(formValue("NIF")).toBe(before.nif);
      expect(formValue("Dirección")).toBe(before.direccion);

      fillDraftRequirements();
      fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
      await waitFor(() => {
        expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
      });
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledWith(
        expect.objectContaining({ transportistaId: carrierA.id }),
      );
    },
  );

  it("seleccionar un resultado visible conserva su ID en el guardado", async () => {
    configureInsert();
    renderSection();
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    await searchAndSelectCarrier(carrierB.nif, carrierB.nombre);

    expect(formValue("Nombre")).toBe(carrierB.nombre);
    expect(formValue("NIF")).toBe(carrierB.nif);
    expect(formValue("Dirección")).toBe(carrierB.direccion);

    fillDraftRequirements();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => {
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
    });
    expect(mocks.decaService.insertUserDeca).toHaveBeenCalledWith(
      expect.objectContaining({ transportistaId: carrierB.id }),
    );
  });

  it.each([
    ["Nombre", "Transportista editado"],
    ["NIF", "EDIT-98765"],
  ])(
    "editar realmente %s invalida la ficha y su payload",
    async (field, value) => {
      configureInsert();
      renderSection();
      await screen.findByRole("heading", { name: "Nuevo DeCA" });
      await searchAndSelectCarrier(carrierA.nif, carrierA.nombre);

      changeField(field, value);
      expect(formValue(field)).toBe(value);
      expect(formValue("Dirección")).toBe("");
      if (field === "NIF") {
        expect(formValue("Nombre")).toBe(carrierA.nombre);
      } else {
        expect(formValue("NIF")).toBe("");
      }

      fillDraftRequirements();
      fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
      await waitFor(() => {
        expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
      });
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledWith(
        expect.objectContaining({ transportistaId: "" }),
      );
    },
  );

  it("conserva el país editado manualmente al invalidar la identidad", async () => {
    configureInsert();
    renderSection();
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    await searchAndSelectCarrier(carrierA.nif, carrierA.nombre);

    changeField("País", "Portugal");
    changeField("País", carrierA.pais);
    changeField("Nombre", "Transportista con país manual");

    expect(formValue("Nombre")).toBe("Transportista con país manual");
    expect(formValue("País")).toBe(carrierA.pais);
    expect(formValue("Dirección")).toBe("");

    fillDraftRequirements();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => {
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
    });
    expect(mocks.decaService.insertUserDeca).toHaveBeenCalledWith(
      expect.objectContaining({
        transportistaId: "",
        transportistaPais: carrierA.pais,
      }),
    );
  });

  it("guarda, recarga y edita el borrador sin perder el vínculo", async () => {
    configureInsert();
    const firstRender = renderSection();
    await screen.findByRole("heading", { name: "Nuevo DeCA" });
    await searchAndSelectCarrier(carrierB.nif, carrierB.nombre);
    fillDraftRequirements();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() => {
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
    });
    expect(mocks.rows[0].transportista_habitual_id).toBe(carrierB.id);
    firstRender.unmount();

    renderSection("list");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Abrir DeCA de Destino de integración",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Editar DeCA" }));

    expect(formValue("Nombre")).toBe(carrierB.nombre);
    expect(formValue("NIF")).toBe(carrierB.nif);

    mocks.decaService.updateUserDeca.mockImplementation(
      async (_id: string, changes: Record<string, unknown>) => {
        const row = mocks.rows[0] as {
          __local: Record<string, unknown>;
        };
        return {
          ...row.__local,
          ...changes,
          transportistaId:
            row.__local.transportistaId ?? carrierB.id,
        };
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      expect(mocks.decaService.updateUserDeca).toHaveBeenCalledTimes(1);
    });

    const changes = mocks.decaService.updateUserDeca.mock.calls[0][1] as
      Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(
        changes,
        "transportista_habitual_id",
      ),
    ).toBe(false);
  });

  it("propaga al servicio la ficha elegida en el formulario masivo", async () => {
    configureInsert();
    renderSection("list");
    fireEvent.click(
      await screen.findByRole("button", { name: /DeCA masivo/ }),
    );
    await screen.findByRole("heading", { name: "Crear DeCAs en bloque" });

    changeField("Cargador común", "Cargador de prueba");
    changeField("Matrícula", "1234-ABC");
    changeField("Destinatario de la línea 1", "Destino masivo");
    changeField("Ciudad de destino", "Sevilla");
    changeField("Mercancía", "Palés");
    changeField("Bultos", "0");
    changeField("Peso (kg)", "0");

    const carrierSearch = screen.getByRole("textbox", {
      name: "Transportista común, opcional",
    });
    fireEvent.change(carrierSearch, { target: { value: carrierB.nif } });
    fireEvent.click(
      await screen.findByRole("option", { name: new RegExp(carrierB.nombre) }),
    );
    expect((carrierSearch as HTMLInputElement).value).toBe(carrierB.nombre);

    const createButton = screen.getByRole("button", { name: "Crear DeCAs" });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mocks.decaService.insertUserDeca).toHaveBeenCalledTimes(1);
    });
    expect(mocks.decaService.insertUserDeca).toHaveBeenCalledWith(
      expect.objectContaining({ transportistaId: carrierB.id }),
    );
  });
});
