import type { DeCA, EmpresaHabitual } from "./types";
import type {
  DecaRow,
  FinalizeDecaEmissionInput,
  OfficialDeCAPdfLocation,
} from "./decaSupabaseService";
import {
  EmissionReservationGate,
  prepareAndReserveDeCA,
} from "./decaEmissionPreparation";
import type { DeCAEmissionOutcome } from "./decaEmissionBatch";

type WorkflowResult =
  | { status: "emitted"; message: string; row?: DecaRow }
  | { status: "failed" | "pending"; message: string; row?: DecaRow };

type OfficialPdfOptions = {
  emittedAt: string;
  documentoId: string;
  cargadorNif: string | null;
  destinatarioNif: string | null;
};

export type DeCAEmissionWorkflowDependencies = {
  expectedUserId: string | null;
  gate: EmissionReservationGate;
  getCurrentUserId: () => Promise<string | null>;
  readRemoteDeCA: (decaId: string) => Promise<DecaRow | null>;
  resolveCarrier: (row: DecaRow) => Promise<EmpresaHabitual | undefined>;
  resolveRecipient: (row: DecaRow) => Promise<EmpresaHabitual | undefined>;
  validate: (
    deca: DeCA,
    carrier: EmpresaHabitual,
    recipient?: EmpresaHabitual,
  ) => {
    field: string;
    label: string;
    code: "required" | "invalid";
  }[];
  reserve: (decaId: string) => Promise<DecaRow | null>;
  getPdfLocation: (
    decaId: string,
    emissionRequestId: string,
  ) => Promise<OfficialDeCAPdfLocation>;
  generatePdf: (
    deca: DeCA,
    publicUrl: string,
    options: OfficialPdfOptions,
    carrier: EmpresaHabitual,
    recipient?: EmpresaHabitual,
  ) => Promise<{ blob: Blob }>;
  calculateSha256: (blob: Blob) => Promise<string>;
  uploadPdf: (
    location: OfficialDeCAPdfLocation,
    blob: Blob,
  ) => Promise<{ alreadyExists: boolean; storedSha256?: string }>;
  finalize: (
    input: FinalizeDecaEmissionInput,
  ) => Promise<DecaRow | null>;
  recordFailure: (input: {
    decaId: string;
    emissionRequestId?: string;
    message: string;
    returnToDraft: boolean;
  }) => Promise<DecaRow | null>;
  mapToLocal: (row: DecaRow) => DeCA;
  isCurrent: (
    lease: { readonly generation: number; readonly decaId: string },
    userId: string,
  ) => boolean;
};

const reservationErrorMessage = (
  result: Awaited<ReturnType<typeof prepareAndReserveDeCA<DecaRow, EmpresaHabitual, EmpresaHabitual>>>,
) => {
  switch (result.kind) {
    case "remote_missing":
      return "No se encontró un DeCA activo en remoto.";
    case "document_changed":
      return "El DeCA cambió durante la comprobación; vuelve a revisar sus datos.";
    case "carrier_missing":
      return "No se encontró una ficha completa del cargador.";
    case "validation_failed":
      return `Faltan datos válidos para emitir: ${result.errors
        .map((error) => error.label)
        .join(", ")}.`;
    case "preflight_error":
      return `No se pudo completar la comprobación previa (${result.stage}): ${
        result.error instanceof Error
          ? result.error.message
          : String(result.error)
      }`;
    case "reservation_reconciled":
      return result.row
        ? `La reserva no se confirmó; el estado remoto es ${result.row.estado}.`
        : "No se pudo confirmar la reserva y no se encontró el DeCA.";
    case "reservation_uncertain":
      return "No se pudo reconciliar la respuesta de la reserva.";
    case "stale":
      return "La sesión o la operación cambió; no se inició otra emisión.";
    case "remote_state":
      return `El estado remoto es ${result.row.estado}.`;
    case "reserved":
      return "";
  }
};

const validEmittedRow = (row: DecaRow, requestId: string) =>
  row.estado === "EMITIDO" &&
  row.emission_request_id === requestId &&
  row.pdf_version === 1 &&
  typeof row.pdf_sha256 === "string" &&
  /^[a-f0-9]{64}$/i.test(row.pdf_sha256) &&
  Boolean(row.pdf_path && row.pdf_public_url && row.emitted_at);

export const emitDeCA = async (
  decaId: string,
  deps: DeCAEmissionWorkflowDependencies,
): Promise<WorkflowResult> => {
  const lease = deps.gate.acquire(decaId);
  if (!lease) {
    return {
      status: "pending",
      message: "Ya hay una emisión en curso en esta sesión.",
    };
  }

  const isCurrent = (
    activeLease: { readonly generation: number; readonly decaId: string },
    userId: string,
  ) =>
    deps.gate.isCurrent(activeLease) && deps.isCurrent(activeLease, userId);
  let requestId: string | undefined;

  try {
    const userId = deps.expectedUserId;
    if (!userId || (await deps.getCurrentUserId()) !== userId) {
      return {
        status: "pending",
        message: "No se pudo verificar la sesión para emitir el DeCA.",
      };
    }

    let remote = await deps.readRemoteDeCA(decaId);
    if (!remote) {
      return { status: "failed", message: "No se encontró un DeCA activo en remoto." };
    }
    if (remote.estado === "EMITIDO") {
      return {
        status: "emitted",
        message: "El DeCA ya está emitido.",
        row: remote,
      };
    }

    if (remote.estado === "BORRADOR") {
      const prepared = await prepareAndReserveDeCA({
        decaId,
        expectedUserId: userId,
        lease,
        gate: deps.gate,
        getCurrentUserId: deps.getCurrentUserId,
        readRemoteDeCA: deps.readRemoteDeCA,
        isOwnedByUser: (row, expectedId) => row.user_id === expectedId,
        isDraft: (row) => row.estado === "BORRADOR",
        sameDraft: (before, after) =>
          before.id === after.id &&
          before.user_id === after.user_id &&
          before.estado === after.estado &&
          before.deleted_at === after.deleted_at &&
          before.updated_at === after.updated_at &&
          before.empresa_habitual_id === after.empresa_habitual_id &&
          before.cargador_nif === after.cargador_nif &&
          before.cargador === after.cargador,
        resolveCarrier: deps.resolveCarrier,
        resolveRecipient: deps.resolveRecipient,
        validate: (row, carrier, recipient) =>
          deps.validate(deps.mapToLocal(row), carrier, recipient),
        reserve: deps.reserve,
        isCurrent,
      });

      if (prepared.kind === "stale") {
        return {
          status: "pending",
          message: "La sesión cambió durante la preparación de la emisión.",
        };
      }

      if (prepared.kind === "reserved") {
        remote = prepared.row;
      } else if (
        prepared.kind === "remote_state" ||
        prepared.kind === "reservation_reconciled"
      ) {
        if (!prepared.row) {
          return {
            status: "failed",
            message: reservationErrorMessage(prepared),
          };
        }
        remote = prepared.row;
        if (remote.estado === "BORRADOR") {
          const message = reservationErrorMessage(prepared);
          const stored = await deps.recordFailure({
            decaId,
            message,
            returnToDraft: false,
          });
          return {
            status: "failed",
            message,
            row: stored ?? remote,
          };
        }
        if (remote.estado === "EMITIDO") {
          return {
            status: "emitted",
            message: "El DeCA ya está emitido.",
            row: remote,
          };
        }
      } else if (prepared.kind === "reservation_uncertain") {
        remote = await deps.readRemoteDeCA(decaId);
        if (!remote || remote.estado === "BORRADOR") {
          const message = reservationErrorMessage(prepared);
          const stored = remote
            ? await deps.recordFailure({
                decaId,
                message,
                returnToDraft: false,
              })
            : null;
          return { status: "failed", message, row: stored ?? remote ?? undefined };
        }
        if (remote.estado === "EMITIDO") {
          return {
            status: "emitted",
            message: "La consulta remota confirma que el DeCA ya está emitido.",
            row: remote,
          };
        }
      } else {
        const message = reservationErrorMessage(prepared);
        const stored = await deps.recordFailure({
          decaId,
          message,
          returnToDraft: false,
        });
        return { status: "failed", message, row: stored ?? undefined };
      }
    }

    if (remote.estado !== "EMITIENDO") {
      const message = `No se puede emitir el DeCA desde el estado ${remote.estado}.`;
      return { status: "failed", message, row: remote };
    }
    if (!remote.emission_request_id || !remote.emission_started_at) {
      return {
        status: "pending",
        message:
          "El DeCA está EMITIENDO, pero la reserva no contiene los datos para recuperarla.",
        row: remote,
      };
    }
    requestId = remote.emission_request_id;

    try {
      if (!isCurrent(lease, userId)) {
        return {
          status: "pending",
          message: "La sesión cambió; la reserva queda pendiente de recuperación.",
          row: remote,
        };
      }

      const location = await deps.getPdfLocation(decaId, requestId);
      const refreshed = await deps.readRemoteDeCA(decaId);
      if (
        !refreshed ||
        refreshed.estado !== "EMITIENDO" ||
        refreshed.emission_request_id !== requestId
      ) {
        if (refreshed?.estado === "EMITIDO") {
          return {
            status: "emitted",
            message: "La consulta remota confirma que el DeCA ya está emitido.",
            row: refreshed,
          };
        }
        return {
          status: "pending",
          message:
            "La reserva cambió antes de generar el PDF; no se inició otra emisión.",
          row: refreshed ?? undefined,
        };
      }

      const deca = deps.mapToLocal(refreshed);
      const carrier = await deps.resolveCarrier(refreshed);
      if (!carrier) {
        throw new Error(
          `No se encontró una ficha completa del cargador "${deca.cargador}".`,
        );
      }
      const recipient = await deps.resolveRecipient(refreshed);
      const validationErrors = deps.validate(deca, carrier, recipient);
      if (validationErrors.length > 0) {
        throw new Error(
          `Faltan datos válidos para emitir: ${validationErrors
            .map((error) => error.label)
            .join(", ")}.`,
        );
      }

      const pdf = await deps.generatePdf(
        deca,
        location.publicUrl,
        {
          emittedAt: refreshed.emission_started_at!,
          documentoId: `DECA-${refreshed.id}`,
          cargadorNif: refreshed.cargador_nif,
          destinatarioNif: refreshed.destinatario_nif,
        },
        carrier,
        recipient,
      );
      let pdfSha256 = await deps.calculateSha256(pdf.blob);
      const upload = await deps.uploadPdf(location, pdf.blob);
      if (upload.alreadyExists) {
        if (!upload.storedSha256) {
          throw new Error(
            "El PDF ya existe en Storage, pero no se pudo verificar su SHA-256.",
          );
        }
        pdfSha256 = upload.storedSha256;
      }

      const finalized = await deps.finalize({
        decaId,
        emissionRequestId: requestId,
        emittedAt: refreshed.emission_started_at!,
        location,
        pdfSha256,
      });
      if (finalized) {
        return {
          status: "emitted",
          message: "El PDF oficial se ha emitido correctamente.",
          row: finalized,
        };
      }
      throw new Error(
        "La reserva ya no coincide con la fila remota al finalizar.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("No se pudo completar la emisión oficial del DeCA.", error);

      let current: DecaRow | null;
      try {
        current = await deps.readRemoteDeCA(decaId);
      } catch (reconcileError) {
        console.error(
          "No se pudo reconciliar el estado remoto de la emisión.",
          reconcileError,
        );
        if (requestId) {
          try {
            const stored = await deps.recordFailure({
              decaId,
              emissionRequestId: requestId,
              message: `${message} No se pudo confirmar el estado remoto; la reserva se conserva para recuperación.`,
              returnToDraft: false,
            });
            if (stored) {
              return {
                status: "pending",
                message:
                  "No se pudo confirmar el resultado. La reserva queda pendiente y se reintentará su recuperación.",
                row: stored,
              };
            }
          } catch (recordError) {
            console.error(
              "No se pudo guardar el error de emisión pendiente.",
              recordError,
            );
          }
        }
        return {
          status: "pending",
          message:
            "No se pudo consultar ni actualizar el estado remoto; no se liberó la reserva.",
        };
      }

      if (!current) {
        return {
          status: "failed",
          message: `${message} No se encontró el DeCA al reconciliar.`,
        };
      }
      if (current.estado === "EMITIDO") {
        if (
          requestId &&
          validEmittedRow(current, requestId)
        ) {
          return {
            status: "emitted",
            message: "La emisión se confirmó al consultar el estado remoto.",
            row: current,
          };
        }
        return {
          status: "emitted",
          message: "El estado remoto confirma que el DeCA ya está emitido.",
          row: current,
        };
      }
      if (
        requestId &&
        current.estado === "EMITIENDO" &&
        current.emission_request_id === requestId
      ) {
        let failed: DecaRow | null = null;
        let releaseError: unknown;
        try {
          failed = await deps.recordFailure({
            decaId,
            emissionRequestId: requestId,
            message,
            returnToDraft: true,
          });
        } catch (error) {
          releaseError = error;
          console.error(
            "No se pudo confirmar la liberación de la reserva del DeCA.",
            error,
          );
        }
        if (
          failed?.id === decaId &&
          failed.user_id === userId &&
          failed.estado === "BORRADOR" &&
          failed.emission_request_id === null
        ) {
          return {
            status: "failed",
            message,
            row: failed,
          };
        }

        let latest: DecaRow | null;
        try {
          latest = await deps.readRemoteDeCA(decaId);
        } catch (reconcileError) {
          console.error(
            "No se pudo reconciliar el estado después de intentar liberar el DeCA.",
            reconcileError,
          );
          return {
            status: "pending",
            message:
              "No se pudo confirmar la liberación. La reserva no se considera liberada y debe reconciliarse.",
          };
        }
        if (latest?.estado === "EMITIDO") {
          return {
            status: "emitted",
            message: "La emisión se confirmó al reconciliar el estado remoto.",
            row: latest,
          };
        }
        if (latest?.estado === "BORRADOR") {
          return {
            status: "failed",
            message: `${message} El estado remoto confirma que el DeCA está en borrador.`,
            row: latest,
          };
        }
        if (
          latest?.estado === "EMITIENDO" &&
          latest.emission_request_id === requestId
        ) {
          let stored: DecaRow | null = null;
          try {
            stored = await deps.recordFailure({
              decaId,
              emissionRequestId: requestId,
              message,
              returnToDraft: false,
            });
          } catch (recordError) {
            console.error(
              "No se pudo registrar el error sin liberar la reserva pendiente.",
              recordError,
            );
          }
          return {
            status: "pending",
            message:
              releaseError || !failed
                ? "No se confirmó la liberación. El DeCA sigue reservado en EMITIENDO para reconciliarlo sin duplicar la emisión."
                : "El DeCA sigue reservado. Se conserva EMITIENDO para recuperarlo sin duplicar la emisión.",
            row: stored ?? latest,
          };
        }
        return {
          status: "pending",
          message: "El estado cambió durante la reconciliación.",
          row: latest ?? undefined,
        };
      }
      if (current.estado === "BORRADOR") {
        const stored = await deps.recordFailure({
          decaId,
          message,
          returnToDraft: false,
        });
        return { status: "failed", message, row: stored ?? current };
      }
      return {
        status: "pending",
        message: "Hay otra solicitud de emisión activa; no se modificó.",
        row: current,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("No se pudo iniciar o reconciliar la emisión del DeCA.", error);
    return { status: "failed", message };
  } finally {
    deps.gate.release(lease);
  }
};
