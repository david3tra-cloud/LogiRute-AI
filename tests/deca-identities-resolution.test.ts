import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDeCACsvIdentityGroups,
  resolveDeCACsvRows,
} from "../decaCsvIdentity";
import { previewDecasCsv } from "../decaCsvService";
import { loadUserEmpresaHabitualForDeCA } from "../empresasHabitualesSupabaseService";
import { mergeTransportistaCatalog } from "../decaTransportistaCatalog";
import type { EmpresaHabitual, TransportistaHabitual } from "../types";

const database = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, string]>,
  methods: [] as string[],
}));

vi.mock("../lib/supabase", () => {
  const query = {
    select: () => query,
    eq: (key: string, value: string) => {
      database.filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => {
      database.methods.push("maybeSingle");
      const id = database.filters.find(([key]) => key === "id")?.[1];
      return {
        data: database.rows.find((row) => row.id === id) ?? null,
        error: null,
      };
    },
    limit: async () => {
      database.methods.push("limit");
      const nif = database.filters.find(([key]) => key === "nif")?.[1];
      return {
        data: database.rows.filter((row) => row.nif === nif).slice(0, 2),
        error: null,
      };
    },
    order: () => {
      database.methods.push("order");
      return query;
    },
    range: async (from: number, to: number) => {
      database.methods.push("range");
      return { data: database.rows.slice(from, to + 1), error: null };
    },
  };
  return {
    supabase: {
      from: vi.fn(() => query),
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "identity-test-user" } },
          error: null,
        })),
      },
    },
  };
});

const makeCompany = (
  id: string,
  nombre: string,
  nif: string,
): EmpresaHabitual => ({
  id,
  nombre,
  nif,
  direccion: "Calle de prueba 1",
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

const makeCarrier = (id: string, defaultCarrier = false): TransportistaHabitual => ({
  ...makeCompany(id, `Transportista ${id}`, `NIF-${id}`),
  esPredeterminado: defaultCarrier,
});

const makeCsv = (headers: string, values: string) =>
  `fecha;cargador;destinatario;ciudad_destino;mercancia;${headers}\n2026-11-22;Cargador;Destino;Madrid;Cajas;${values}`;

describe("resolución de identidades de DECA", () => {
  beforeEach(() => {
    database.rows = [];
    database.filters = [];
    database.methods = [];
  });

  it("mantiene la compatibilidad con CSV antiguo sin destinatario_nif", () => {
    const preview = previewDecasCsv(
      makeCsv("", ""),
    );
    const loader = makeCompany("loader", "Cargador", "C-1");
    const groups = resolveDeCACsvIdentityGroups(preview, [loader], []);
    const rows = resolveDeCACsvRows(preview, groups);

    expect(preview.rows[0].deca?.destinatarioNif).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0].destinatarioNif).toBeUndefined();
  });

  it("lee destinatario_nif opcional y conserva la ficha única hasta las filas resueltas", () => {
    const preview = previewDecasCsv(makeCsv("destinatario_nif", "D-2"));
    const loader = makeCompany("loader", "Cargador", "C-1");
    const recipient = makeCompany("recipient", "Destino", "D-2");
    const groups = resolveDeCACsvIdentityGroups(
      preview,
      [loader, recipient],
      [],
    );
    const rows = resolveDeCACsvRows(preview, groups);

    expect(groups.find((group) => group.role === "destinatario")?.status).toBe(
      "resolved",
    );
    expect(rows[0].destinatarioNif).toBe("D-2");
  });

  it("resuelve por NIF aunque la ficha de destinatario requiera completar otros datos", () => {
    const preview = previewDecasCsv(makeCsv("destinatario_nif", "D-2"));
    const loader = makeCompany("loader", "Cargador", "C-1");
    const recipient = {
      ...makeCompany("recipient", "Destino", "D-2"),
      direccion: "",
      ciudad: "",
      codigoPostal: "",
    };
    const groups = resolveDeCACsvIdentityGroups(
      preview,
      [loader, recipient],
      [],
    );

    expect(groups.find((group) => group.role === "destinatario")?.status).toBe(
      "resolved",
    );
    expect(resolveDeCACsvRows(preview, groups)[0].destinatarioNif).toBe("D-2");
  });

  it("exige elegir destinatarios homónimos con NIF distinto y conserva el elegido", () => {
    const preview = previewDecasCsv(makeCsv("", ""));
    const loader = makeCompany("loader", "Cargador", "C-1");
    const recipientA = makeCompany("recipient-a", "Destino", "D-1");
    const recipientB = makeCompany("recipient-b", "Destino", "D-2");
    const companies = [loader, recipientA, recipientB];
    const unresolved = resolveDeCACsvIdentityGroups(preview, companies, []);
    const recipientGroup = unresolved.find(
      (group) => group.role === "destinatario",
    );

    expect(recipientGroup?.status).toBe("ambiguous");
    expect(resolveDeCACsvRows(preview, unresolved)).toHaveLength(0);

    const resolved = resolveDeCACsvIdentityGroups(preview, companies, [], {
      [recipientGroup!.key]: recipientB.id,
    });
    expect(resolveDeCACsvRows(preview, resolved)[0].destinatarioNif).toBe(
      recipientB.nif,
    );
  });

  it("bloquea destinatarios que comparten NIF porque el modelo no los distingue", () => {
    const preview = previewDecasCsv(makeCsv("destinatario_nif", "D-1"));
    const loader = makeCompany("loader", "Cargador", "C-1");
    const recipientA = makeCompany("recipient-a", "Destino", "D-1");
    const recipientB = makeCompany("recipient-b", "Destino", "D-1");
    const groups = resolveDeCACsvIdentityGroups(
      preview,
      [loader, recipientA, recipientB],
      [],
    );
    const recipientGroup = groups.find(
      (group) => group.role === "destinatario",
    );

    expect(recipientGroup?.status).toBe("indistinguishable");
    expect(recipientGroup?.selectableCandidates).toEqual([]);
    expect(resolveDeCACsvRows(preview, groups)).toHaveLength(0);
  });

  it("no resuelve un NIF repetido aunque solo una ficha coincida por nombre", () => {
    const preview = previewDecasCsv(makeCsv("destinatario_nif", "D-1"));
    const loader = makeCompany("loader", "Cargador", "C-1");
    const recipient = makeCompany("recipient", "Destino", "D-1");
    const duplicateNif = makeCompany("other", "Otra empresa", "D-1");
    const groups = resolveDeCACsvIdentityGroups(
      preview,
      [loader, recipient, duplicateNif],
      [],
    );
    const recipientGroup = groups.find(
      (group) => group.role === "destinatario",
    );

    expect(recipientGroup?.status).toBe("indistinguishable");
    expect(resolveDeCACsvRows(preview, groups)).toHaveLength(0);
  });

  it("prioriza el ID elegido y nunca vuelve a buscar por el nombre homónimo", async () => {
    const first = makeCompany("11111111-1111-4111-8111-111111111111", "Cargador", "C-1");
    const selected = makeCompany("22222222-2222-4222-8222-222222222222", "Cargador", "C-2");
    database.rows = [first, selected].map((company) => ({
      id: company.id,
      user_id: "identity-test-user",
      nombre: company.nombre,
      nif: company.nif,
      direccion: company.direccion,
      ciudad: company.ciudad,
      codigo_postal: company.codigoPostal,
      provincia: company.provincia,
      pais: company.pais,
      telefono: company.telefono,
      email: company.email,
      contacto: company.contacto,
      notas: company.notas,
      created_at: company.createdAt,
      updated_at: company.updatedAt,
    }));

    const result = await loadUserEmpresaHabitualForDeCA(
      selected.id,
      selected.nif,
      selected.nombre,
    );

    expect(result?.id).toBe(selected.id);
    expect(database.methods).toEqual(["maybeSingle"]);
  });

  it("marca la ambigüedad con el rol correcto", async () => {
    database.rows = [
      { id: "a", nombre: "Destino", nif: "D-1" },
      { id: "b", nombre: "Destino", nif: "D-2" },
    ];

    await expect(
      loadUserEmpresaHabitualForDeCA(
        undefined,
        undefined,
        "Destino",
        "destinatario",
      ),
    ).rejects.toThrow("Hay varias fichas de destinatario coincidentes");
    expect(database.methods).toContain("order");
  });

  it("rechaza un NIF compartido con un mensaje del rol correcto", async () => {
    database.rows = [
      { id: "a", nombre: "Destino", nif: "D-1" },
      { id: "b", nombre: "Otro destino", nif: " d-1 " },
    ];

    await expect(
      loadUserEmpresaHabitualForDeCA(
        undefined,
        "D-1",
        "Destino",
        "destinatario",
      ),
    ).rejects.toThrow("Hay varias fichas de destinatario coincidentes por NIF");
  });
});

describe("fusión local/remota del catálogo de transportistas", () => {
  it("respeta tombstones y borrados pendientes sin inventar un predeterminado", () => {
    const local = makeCarrier("local", true);
    const deleted = makeCarrier("deleted", false);
    const pending = makeCarrier("pending", false);
    const remote = makeCarrier("remote", false);

    const merged = mergeTransportistaCatalog(
      [local, deleted, pending],
      [remote],
      ["deleted"],
      ["pending"],
      false,
    );

    expect(merged.map((item) => item.id)).toEqual(["remote", "local"]);
    expect(merged.find((item) => item.id === "local")?.esPredeterminado).toBe(
      true,
    );
    expect(
      mergeTransportistaCatalog([], [remote], [], [], true).some(
        (item) => item.esPredeterminado,
      ),
    ).toBe(false);
  });

  it("combina por fecha y conserva la precedencia local cuando la sincronización está desactivada", () => {
    const local = {
      ...makeCarrier("same"),
      nombre: "Copia local",
      updatedAt: "2026-01-03T00:00:00.000Z",
    };
    const remoteOlder = {
      ...local,
      nombre: "Copia remota antigua",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const remoteNewer = {
      ...local,
      nombre: "Copia remota nueva",
      updatedAt: "2026-01-04T00:00:00.000Z",
    };

    expect(
      mergeTransportistaCatalog([local], [remoteOlder], [], [], true)[0].nombre,
    ).toBe("Copia local");
    expect(
      mergeTransportistaCatalog([local], [remoteNewer], [], [], true)[0].nombre,
    ).toBe("Copia remota nueva");
    expect(
      mergeTransportistaCatalog(
        [{ ...local, updatedAt: remoteOlder.updatedAt }],
        [remoteOlder],
        [],
        [],
        false,
      )[0].nombre,
    ).toBe("Copia local");
  });
});
