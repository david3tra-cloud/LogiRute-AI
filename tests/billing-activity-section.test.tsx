import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingRecord } from "../billingSupabaseService";
import BillingSection from "../BillingSection";
import type { Delivery } from "../types";
import { DeliveryStatus, DeliveryType } from "../types";

const mocks = vi.hoisted(() => ({
  listBillingRecords: vi.fn(),
  deleteBillingRecord: vi.fn(),
  downloadBillingActivityPdf: vi.fn(),
}));

vi.mock("../billingSupabaseService", () => ({
  listBillingRecords: mocks.listBillingRecords,
  deleteBillingRecord: mocks.deleteBillingRecord,
}));

vi.mock("../billingActivityPdf", () => ({
  downloadBillingActivityPdf: mocks.downloadBillingActivityPdf,
}));

const makeStop = (
  id: string,
  type: DeliveryType,
  status: DeliveryStatus,
  pesoKg?: number,
): Delivery => ({
  id,
  recipient: `Cliente ${id}`,
  address: `Calle ${id}`,
  concept: "Entrega diaria",
  status,
  type,
  ...(pesoKg === undefined ? {} : { pesoKg }),
});

const makeRecord = (
  id: string,
  workDate: string,
  deliveries: Delivery[],
  kilometerData: Partial<
    Pick<
      BillingRecord["snapshot"],
      "kilometrajeInicial" | "kilometrajeFinal" | "kilometrosRecorridos"
    >
  >,
): BillingRecord => ({
  id: `record-${id}`,
  user_id: "billing-user",
  source_jornada_id: id,
  source_fingerprint: `fingerprint-${id}`,
  work_date: workDate,
  source_closed_at: `${workDate}T18:00:00.000Z`,
  created_at: `${workDate}T18:01:00.000Z`,
  snapshot: {
    id,
    userId: "billing-user",
    fingerprint: `fingerprint-${id}`,
    fechaCierre: `${workDate}T18:00:00.000Z`,
    resumen: {
      totalStops: deliveries.length,
      completedStops: deliveries.filter(
        (stop) => stop.status === DeliveryStatus.COMPLETED,
      ).length,
      issueStops: deliveries.filter(
        (stop) => stop.status === DeliveryStatus.ISSUE,
      ).length,
      pendingStops: deliveries.filter(
        (stop) =>
          stop.status === DeliveryStatus.PENDING ||
          stop.status === DeliveryStatus.IN_PROGRESS,
      ).length,
      deliveriesCount: deliveries.filter(
        (stop) => stop.type === DeliveryType.DELIVERY,
      ).length,
      pickupsCount: deliveries.filter(
        (stop) => stop.type === DeliveryType.PICKUP,
      ).length,
    },
    deliveries,
    sequence: deliveries.map((stop) => stop.id),
    ...kilometerData,
  },
});

describe("BillingSection activity presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteBillingRecord.mockResolvedValue(true);
    mocks.downloadBillingActivityPdf.mockImplementation(() => undefined);
  });

  it("shows period totals, minimal day metrics, and downloads the same record from both access points", async () => {
    const record = makeRecord(
      "journey-a",
      "2026-10-31",
      [
        makeStop(
          "delivery-done",
          DeliveryType.DELIVERY,
          DeliveryStatus.COMPLETED,
          0,
        ),
        makeStop(
          "delivery-issue",
          DeliveryType.DELIVERY,
          DeliveryStatus.ISSUE,
        ),
        makeStop("pickup-pending", DeliveryType.PICKUP, DeliveryStatus.PENDING, 5),
      ],
      {
        kilometrajeInicial: 0,
        kilometrajeFinal: 0,
        kilometrosRecorridos: 0,
      },
    );
    const olderRecord = makeRecord(
      "journey-b",
      "2026-10-30",
      [],
      { kilometrosRecorridos: undefined },
    );
    mocks.listBillingRecords.mockResolvedValue([record, olderRecord]);

    render(<BillingSection userId="billing-user" />);
    const monthSelect = await screen.findByLabelText("Mes de trabajo");
    fireEvent.change(monthSelect, { target: { value: "2026-10" } });

    expect(await screen.findByText("3 paradas")).toBeTruthy();
    expect(screen.getByText("1 realizadas / 2 planificadas")).toBeTruthy();
    expect(screen.getByText("0 realizadas / 1 planificadas")).toBeTruthy();
    expect(
      screen.getByText(/0 km registrados; total parcial/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Faltan datos en 1 de 2 jornadas/),
    ).toBeTruthy();
    const totalsSection = screen.getByRole("region", {
      name: "Totales del mes",
    });
    expect(totalsSection.className).toContain("xl:grid-cols-6");
    expect(totalsSection.className).toContain("md:grid-cols-4");
    const weightCard = screen.getByRole("heading", { name: "Peso" })
      .parentElement;
    expect(weightCard?.textContent).toContain("Entregas");
    expect(weightCard?.textContent).toContain("Recogidas");
    expect(weightCard?.textContent).toContain("Realizado:");
    expect(weightCard?.textContent).toContain("Planificado:");
    expect(weightCard?.className).toContain("md:col-span-4");
    expect(weightCard?.className).toContain("xl:col-span-2");

    const day = screen.getAllByRole("article")[0];
    expect(day.firstElementChild?.className).toContain("xl:grid-cols-[");
    expect(day.textContent).toContain("Entregas");
    expect(day.textContent).toContain("Realizadas / planificadas");
    expect(day.textContent).toContain("0 km");
    expect(day.textContent).not.toContain("Cierre:");
    expect(day.querySelector("button button")).toBeNull();

    const cardDownload = screen.getAllByRole("button", {
      name: "Descargar PDF",
    })[0];
    expect(cardDownload.className).toContain("focus-visible:ring-2");
    fireEvent.click(cardDownload);
    expect(mocks.downloadBillingActivityPdf).toHaveBeenNthCalledWith(
      1,
      record,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Ver detalle" })[0]);
    expect(
      await screen.findByRole("button", { name: "Ocultar detalle" }),
    ).toBeTruthy();
    expect(screen.getByText(/Total: 3 · completadas: 1/)).toBeTruthy();
    expect(
      screen.getByText(/Peso asociado: 0 kg/),
    ).toBeTruthy();
    const detailDownloads = screen.getAllByRole("button", {
      name: "Descargar PDF",
    });
    fireEvent.click(detailDownloads[1]);
    expect(mocks.downloadBillingActivityPdf).toHaveBeenNthCalledWith(
      2,
      record,
    );
  });

  it("reports PDF generation failures without hiding the jornada", async () => {
    const record = makeRecord("journey-error", "2026-10-31", [], {
      kilometrosRecorridos: 0,
    });
    mocks.listBillingRecords.mockResolvedValue([record]);
    mocks.downloadBillingActivityPdf.mockImplementation(() => {
      throw new Error("fallo simulado");
    });

    render(<BillingSection userId="billing-user" />);
    fireEvent.change(await screen.findByLabelText("Mes de trabajo"), {
      target: { value: "2026-10" },
    });
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Descargar PDF" }))[0],
    );

    expect(
      await screen.findByText(
        "No se pudo generar o descargar el PDF: fallo simulado",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("0 km")).toBeTruthy();
    });
  });

  it("shows known activity totals as partial when another jornada lacks its stop list", async () => {
    const completeRecord = makeRecord(
      "journey-known",
      "2026-10-31",
      [
        makeStop(
          "known-delivery",
          DeliveryType.DELIVERY,
          DeliveryStatus.COMPLETED,
        ),
      ],
      { kilometrosRecorridos: 0 },
    );
    const legacyBase = makeRecord("journey-legacy", "2026-10-30", [], {
      kilometrosRecorridos: undefined,
    });
    const legacyRecord = {
      ...legacyBase,
      snapshot: {
        ...legacyBase.snapshot,
        deliveries: undefined,
      },
    };
    mocks.listBillingRecords.mockResolvedValue([completeRecord, legacyRecord]);

    render(<BillingSection userId="billing-user" />);
    fireEvent.change(await screen.findByLabelText("Mes de trabajo"), {
      target: { value: "2026-10" },
    });

    expect(
      await screen.findByText("1 realizadas / 1 planificadas; parcial"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Desglose de paradas ausente en 1 de 2 jornadas; los totales de entregas y recogidas son parciales.",
      ),
    ).toBeTruthy();
  });
});
