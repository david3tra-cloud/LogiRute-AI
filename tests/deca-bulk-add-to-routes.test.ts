import { describe, expect, it, vi } from "vitest";
import {
  DeCABulkRouteAddGate,
  getDeCAIdsToRetry,
  runDeCABulkAddToRoutes,
  selectEligibleDeCAsForRoutes,
} from "../decaBulkAddToRoutes";
import type { DeCA } from "../types";

const makeDeCA = (id: string, estado: DeCA["estado"] = "EMITIDO"): DeCA => ({
  id,
  fecha: "2026-01-01",
  cargador: "Cargador",
  transportista: "Transportista",
  destinatario: "Destinatario",
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

describe("bulk DeCA route addition", () => {
  it("only selects emitted, selected DeCAs that are not already routed", () => {
    const decas = [
      makeDeCA("emitted"),
      makeDeCA("draft", "borrador"),
      makeDeCA("emitting", "EMITIENDO"),
      makeDeCA("already-routed"),
      makeDeCA("unselected"),
    ];

    expect(
      selectEligibleDeCAsForRoutes(
        decas,
        new Set(["emitted", "draft", "emitting", "already-routed"]),
        (id) => id === "already-routed",
      ).map(({ id }) => id),
    ).toEqual(["emitted"]);
  });

  it("counts duplicate and in-progress results as omitted", async () => {
    const gate = new DeCABulkRouteAddGate();
    const addToRoutes = vi
      .fn()
      .mockResolvedValueOnce({ status: "already-in-routes" as const })
      .mockResolvedValueOnce({ status: "in-progress" as const });

    const result = await runDeCABulkAddToRoutes(
      [makeDeCA("duplicate"), makeDeCA("busy")],
      addToRoutes,
      gate,
    );

    expect(result?.omittedIds).toEqual(["duplicate", "busy"]);
    expect(result?.addedIds).toEqual([]);
    expect(result?.errors).toEqual([]);
  });

  it("preserves partial successes and identifies missing coordinates as a warning", async () => {
    const addToRoutes = vi
      .fn()
      .mockResolvedValueOnce({
        status: "added" as const,
        coordinatesAvailable: true,
      })
      .mockResolvedValueOnce({
        status: "added" as const,
        coordinatesAvailable: false,
      })
      .mockRejectedValueOnce(new Error("route failed"));

    const result = await runDeCABulkAddToRoutes(
      [makeDeCA("with-coordinates"), makeDeCA("without-coordinates"), makeDeCA("failed")],
      addToRoutes,
      new DeCABulkRouteAddGate(),
    );

    expect(result?.addedIds).toEqual(["with-coordinates", "without-coordinates"]);
    expect(result?.addedWithoutCoordinatesIds).toEqual(["without-coordinates"]);
    expect(result?.errors).toEqual([{ id: "failed", message: "route failed" }]);
  });

  it("allows retrying only the failed DeCAs", async () => {
    const decas = [makeDeCA("succeeded"), makeDeCA("retry")];
    const selectedIds = new Set(["succeeded", "retry"]);
    const routedIds = new Set<string>();
    const isInRoutes = (id: string) => routedIds.has(id);
    const firstAdd = vi.fn(async (deca: DeCA) => {
      if (deca.id === "succeeded") {
        routedIds.add(deca.id);
        return { status: "added" as const, coordinatesAvailable: true };
      }
      throw new Error("temporary failure");
    });
    const gate = new DeCABulkRouteAddGate();
    const first = await runDeCABulkAddToRoutes(
      selectEligibleDeCAsForRoutes(decas, selectedIds, isInRoutes),
      firstAdd,
      gate,
    );
    expect(gate.isLocked).toBe(false);

    const retrySelection = first ? getDeCAIdsToRetry(first) : new Set<string>();
    expect(
      selectEligibleDeCAsForRoutes(decas, selectedIds, isInRoutes).map(
        ({ id }) => id,
      ),
    ).toEqual(["retry"]);
    const retryAdd = vi.fn(async (deca: DeCA) => {
      routedIds.add(deca.id);
      return { status: "added" as const, coordinatesAvailable: true };
    });
    const retry = await runDeCABulkAddToRoutes(
      selectEligibleDeCAsForRoutes(decas, retrySelection, isInRoutes),
      retryAdd,
      gate,
    );

    expect(retryAdd).toHaveBeenCalledTimes(1);
    expect(retryAdd).toHaveBeenCalledWith(decas[1]);
    expect(retry?.addedIds).toEqual(["retry"]);
    expect(retry?.errors).toEqual([]);
    expect(gate.isLocked).toBe(false);
  });

  it("rejects a second execution while the first is running", async () => {
    const gate = new DeCABulkRouteAddGate();
    let finishFirst: ((value: { status: "added"; coordinatesAvailable: true }) => void) | undefined;
    const addToRoutes = vi.fn(
      () =>
        new Promise<{ status: "added"; coordinatesAvailable: true }>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const firstRun = runDeCABulkAddToRoutes([makeDeCA("one")], addToRoutes, gate);
    const secondRun = await runDeCABulkAddToRoutes(
      [makeDeCA("one")],
      addToRoutes,
      gate,
    );

    expect(secondRun).toBeNull();
    expect(addToRoutes).toHaveBeenCalledTimes(1);
    finishFirst?.({ status: "added", coordinatesAvailable: true });
    await expect(firstRun).resolves.toMatchObject({ addedIds: ["one"] });
    expect(gate.isLocked).toBe(false);
  });

  it("waits for each DeCA before starting the next one", async () => {
    let finishFirst:
      | ((value: { status: "added"; coordinatesAvailable: true }) => void)
      | undefined;
    const calls: string[] = [];
    const addToRoutes = vi.fn((deca: DeCA) => {
      calls.push(deca.id);
      if (deca.id === "first") {
        return new Promise<{ status: "added"; coordinatesAvailable: true }>(
          (resolve) => {
            finishFirst = resolve;
          },
        );
      }
      return Promise.resolve({
        status: "added" as const,
        coordinatesAvailable: true as const,
      });
    });

    const run = runDeCABulkAddToRoutes(
      [makeDeCA("first"), makeDeCA("second")],
      addToRoutes,
      new DeCABulkRouteAddGate(),
    );

    expect(calls).toEqual(["first"]);
    finishFirst?.({ status: "added", coordinatesAvailable: true });
    await run;
    expect(calls).toEqual(["first", "second"]);
  });
});
