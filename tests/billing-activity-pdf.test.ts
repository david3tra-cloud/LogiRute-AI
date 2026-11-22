import { describe, expect, it } from "vitest";
import {
  aggregateTotalParadas,
  formatBillingWorkDate,
} from "../billingActivity.js";
import { createBillingActivityPdf } from "../billingActivityPdf";
import type { BillingRecord } from "../billingSupabaseService";
import { DeliveryStatus, DeliveryType, type Delivery } from "../types";

const makeStop = (overrides: Partial<Delivery> = {}): Delivery => ({
  id: "stop-1",
  recipient: "Cliente",
  address: "Calle Mayor 1",
  status: DeliveryStatus.COMPLETED,
  type: DeliveryType.DELIVERY,
  ...overrides,
});

const makeRecord = (
  overrides: Partial<BillingRecord["snapshot"]> = {},
): BillingRecord => ({
  id: "billing-record-1",
  user_id: "user-1",
  source_jornada_id: "journey-1",
  source_fingerprint: "fingerprint-1",
  work_date: "2026-03-31",
  source_closed_at: "2026-03-31T20:30:00.000Z",
  created_at: "2026-03-31T20:31:00.000Z",
  snapshot: {
    id: "journey-1",
    userId: "user-1",
    fingerprint: "fingerprint-1",
    fechaCierre: "2026-03-31T20:30:00.000Z",
    resumen: {
      totalStops: 1,
      completedStops: 1,
      issueStops: 0,
      pendingStops: 0,
      deliveriesCount: 1,
      pickupsCount: 0,
    },
    deliveries: [makeStop()],
    sequence: ["stop-1"],
    ...overrides,
  },
});

describe("billing activity PDF", () => {
  it("uses only saved stop totals and distinguishes zero from missing totals", () => {
    expect(
      aggregateTotalParadas([
        { snapshot: { resumen: { totalStops: 0 } } },
        { snapshot: { resumen: { totalStops: 4 } } },
      ]),
    ).toEqual({ total: 4, missing: 0, count: 2 });
    expect(
      aggregateTotalParadas([
        { snapshot: { resumen: { totalStops: 2 } } },
        { snapshot: {} },
      ]),
    ).toEqual({ total: 2, missing: 1, count: 2 });
    expect(formatBillingWorkDate("2026-03-31")).toContain("31");
    expect(formatBillingWorkDate("invalid-date")).toBe("Sin datos");
  });

  it("prints zero readings and weights as values, without shifting work_date", () => {
    const record = makeRecord({
      kilometrajeInicial: 0,
      kilometrajeFinal: 0,
      kilometrosRecorridos: 0,
      deliveries: [makeStop({ pesoKg: 0 })],
    });

    const pdf = createBillingActivityPdf(record);
    const content = pdf.output();

    expect(content).toContain("Resumen de actividad diaria");
    expect(content).toContain("Fecha de trabajo: 2026-03-31");
    expect(content).toContain("Kilómetros recorridos: 0 km");
    expect(content).toContain("Lectura inicial: 0 km");
    expect(content).toContain("0 kg");
    expect(content).not.toContain("€");
  });

  it("shows absent metrics and incomplete legacy snapshots as missing", () => {
    const record = makeRecord({
      kilometrajeInicial: undefined,
      kilometrajeFinal: undefined,
      kilometrosRecorridos: undefined,
      deliveries: [
        makeStop({
          status: DeliveryStatus.PENDING,
          type: DeliveryType.PICKUP,
          pesoKg: undefined,
        }),
      ],
    });

    const content = createBillingActivityPdf(record).output();
    expect(content).toContain("Kilómetros recorridos: Sin datos");
    expect(content).toContain("Lectura inicial: Sin datos");
    expect(content).toContain("Peso asociado: Sin datos");
    expect(content).toContain("1 sin dato de peso");
  });

  it("does not turn a legacy snapshot without a stop list into zero activity", () => {
    const record = makeRecord({
      resumen: undefined,
      deliveries: undefined,
      sequence: undefined,
      kilometrajeInicial: undefined,
      kilometrajeFinal: undefined,
      kilometrosRecorridos: undefined,
    });

    const content = createBillingActivityPdf(record).output();
    expect(content).toContain("Paradas: Sin datos");
    expect(content).toContain(
      "Entregas y recogidas: sin datos; falta el desglose de paradas.",
    );
    expect(content).toContain(
      "Sin datos: la instantánea no contiene la lista de paradas.",
    );
  });

  it("fits an ordinary detailed jornada on one page", () => {
    const stops = Array.from({ length: 12 }, (_, index) =>
      makeStop({
        id: `stop-${index + 1}`,
        recipient: `Cliente ${index + 1}`,
        address: `Calle Mayor ${index + 1}, número ${index + 10}`,
        concept: "Entrega diaria",
        estimatedTime: "10:30",
        phone: "600 123 456",
        pesoKg: 1.25,
        notes: "Entregar en recepción.",
      }),
    );
    const record = makeRecord({
      resumen: {
        totalStops: stops.length,
        completedStops: stops.length,
        issueStops: 0,
        pendingStops: 0,
        deliveriesCount: stops.length,
        pickupsCount: 0,
      },
      deliveries: stops,
      sequence: stops.map((stop) => stop.id),
    });

    const pdf = createBillingActivityPdf(record);
    const content = pdf.output();

    expect(pdf.getNumberOfPages()).toBe(1);
    expect(content).toContain("Cliente 12");
    expect(content).toContain("Dirección: Calle Mayor 12, número 21");
    expect(content).toContain("Concepto: Entrega diaria");
    expect(content).toContain("Hora estimada: 10:30");
    expect(content).toContain("Teléfono: 600 123 456");
    expect(content).toContain("Peso asociado:");
    expect(content).toContain("1,25 kg");
    expect(content).toContain("Observaciones: Entregar en recepción.");
  });

  it("wraps long stop rows, repeats headers, and retains all content across pages", () => {
    const longText = `${"observacion extensa con muchos detalles ".repeat(160)}FIN-TEXTO-PRESERVADO`;
    const stops = Array.from({ length: 6 }, (_, index) =>
      makeStop({
        id: `stop-${index + 1}`,
        recipient: `Cliente ${index + 1}`,
        address: `Dirección ${index + 1}`,
        notes: index === 2 ? longText : "Observación corta.",
      }),
    );
    const record = makeRecord({
      resumen: {
        totalStops: stops.length,
        completedStops: stops.length,
        issueStops: 0,
        pendingStops: 0,
        deliveriesCount: stops.length,
        pickupsCount: 0,
      },
      deliveries: stops,
      sequence: stops.map((stop) => stop.id),
    });

    const pdf = createBillingActivityPdf(record);
    const content = pdf.output();
    const repeatedDateCount = content.match(/Fecha de trabajo: 2026-03-31/g)?.length ?? 0;
    const repeatedTableHeaderCount = content.match(/Datos de la parada/g)?.length ?? 0;

    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    expect(content).toContain("Cliente 6");
    expect(content).toContain("FIN-TEXTO-PRESERVADO");
    expect(content).toContain("Continúa");
    expect(repeatedDateCount).toBe(pdf.getNumberOfPages());
    expect(repeatedTableHeaderCount).toBe(pdf.getNumberOfPages());
    expect(content).toContain("Página 1 de");
    expect(content).toContain(`Página ${pdf.getNumberOfPages()} de`);
  });
});
