export type EmissionReservationLease = {
  readonly generation: number;
  readonly decaId: string;
};

export class EmissionReservationGate {
  private generation = 0;
  private activeLease: EmissionReservationLease | null = null;

  acquire(decaId: string): EmissionReservationLease | null {
    if (this.activeLease) return null;
    const lease = { generation: ++this.generation, decaId };
    this.activeLease = lease;
    return lease;
  }

  isCurrent(lease: EmissionReservationLease): boolean {
    return this.activeLease === lease && this.generation === lease.generation;
  }

  release(lease: EmissionReservationLease): boolean {
    if (!this.isCurrent(lease)) return false;
    this.activeLease = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeLease = null;
  }
}

export type EmissionPreparationResult<TRow> =
  | { kind: "reserved"; row: TRow }
  | { kind: "remote_state"; row: TRow }
  | { kind: "remote_missing" }
  | { kind: "document_changed"; row: TRow }
  | { kind: "carrier_missing" }
  | { kind: "validation_failed"; errors: { field: string; label: string; code: "required" | "invalid" }[] }
  | {
      kind: "preflight_error";
      stage: "session" | "remote" | "carrier" | "recipient";
      error: unknown;
    }
  | {
      kind: "reservation_reconciled";
      row: TRow | null;
      reservationError: unknown | null;
    }
  | {
      kind: "reservation_uncertain";
      reservationError: unknown | null;
      reconciliationError: unknown;
    }
  | { kind: "stale" };

type ContextCheck = { kind: "ok" } | { kind: "stale" } | { kind: "session_error"; error: unknown };

export async function prepareAndReserveDeCA<TRow, TCarrier, TRecipient>(args: {
  decaId: string;
  expectedUserId: string | null;
  lease: EmissionReservationLease;
  gate: EmissionReservationGate;
  getCurrentUserId: () => Promise<string | null>;
  readRemoteDeCA: (decaId: string) => Promise<TRow | null>;
  isOwnedByUser: (row: TRow, userId: string) => boolean;
  isDraft: (row: TRow) => boolean;
  sameDraft: (before: TRow, after: TRow) => boolean;
  resolveCarrier: (row: TRow) => Promise<TCarrier | undefined>;
  resolveRecipient: (row: TRow) => Promise<TRecipient | undefined>;
  validate: (row: TRow, carrier: TCarrier, recipient?: TRecipient) => {
    field: string;
    label: string;
    code: "required" | "invalid";
  }[];
  reserve: (decaId: string) => Promise<TRow | null>;
  isCurrent: (lease: EmissionReservationLease, userId: string) => boolean;
}): Promise<EmissionPreparationResult<TRow>> {
  const checkContext = async (): Promise<ContextCheck> => {
    if (
      !args.expectedUserId ||
      !args.gate.isCurrent(args.lease) ||
      !args.isCurrent(args.lease, args.expectedUserId)
    ) {
      return { kind: "stale" };
    }

    let currentUserId: string | null;
    try {
      currentUserId = await args.getCurrentUserId();
    } catch (error) {
      if (
        !args.gate.isCurrent(args.lease) ||
        !args.isCurrent(args.lease, args.expectedUserId)
      ) {
        return { kind: "stale" };
      }
      return { kind: "session_error", error };
    }

    if (
      currentUserId !== args.expectedUserId ||
      !args.gate.isCurrent(args.lease) ||
      !args.isCurrent(args.lease, args.expectedUserId)
    ) {
      return { kind: "stale" };
    }
    return { kind: "ok" };
  };

  const resultForContext = (
    check: ContextCheck,
    stage: "session" | "remote" | "carrier" | "recipient",
  ): EmissionPreparationResult<TRow> | null => {
    if (check.kind === "ok") return null;
    if (check.kind === "stale") return { kind: "stale" };
    return { kind: "preflight_error", stage, error: check.error };
  };

  const initialContext = await checkContext();
  const initialContextResult = resultForContext(initialContext, "session");
  if (initialContextResult) return initialContextResult;

  let initialRow: TRow | null;
  try {
    initialRow = await args.readRemoteDeCA(args.decaId);
  } catch (error) {
    const context = await checkContext();
    const contextResult = resultForContext(context, "session");
    return contextResult ?? { kind: "preflight_error", stage: "remote", error };
  }
  const afterInitialRead = await checkContext();
  const afterInitialReadResult = resultForContext(afterInitialRead, "session");
  if (afterInitialReadResult) return afterInitialReadResult;
  if (!initialRow) return { kind: "remote_missing" };
  if (!args.isOwnedByUser(initialRow, args.expectedUserId!)) {
    return { kind: "stale" };
  }
  if (!args.isDraft(initialRow)) return { kind: "remote_state", row: initialRow };

  let carrier: TCarrier | undefined;
  try {
    carrier = await args.resolveCarrier(initialRow);
  } catch (error) {
    const context = await checkContext();
    const contextResult = resultForContext(context, "session");
    return contextResult ?? { kind: "preflight_error", stage: "carrier", error };
  }
  const afterCarrierRead = await checkContext();
  const afterCarrierReadResult = resultForContext(afterCarrierRead, "session");
  if (afterCarrierReadResult) return afterCarrierReadResult;
  if (!carrier) return { kind: "carrier_missing" };

  let recipient: TRecipient | undefined;
  try {
    recipient = await args.resolveRecipient(initialRow);
  } catch (error) {
    const context = await checkContext();
    const contextResult = resultForContext(context, "session");
    return contextResult ?? { kind: "preflight_error", stage: "recipient", error };
  }
  const afterRecipientRead = await checkContext();
  const afterRecipientReadResult = resultForContext(afterRecipientRead, "session");
  if (afterRecipientReadResult) return afterRecipientReadResult;

  const validationErrors = args.validate(initialRow, carrier, recipient);
  if (validationErrors.length > 0) {
    return { kind: "validation_failed", errors: validationErrors };
  }

  let currentRow: TRow | null;
  try {
    currentRow = await args.readRemoteDeCA(args.decaId);
  } catch (error) {
    const context = await checkContext();
    const contextResult = resultForContext(context, "session");
    return contextResult ?? { kind: "preflight_error", stage: "remote", error };
  }
  const afterCurrentRead = await checkContext();
  const afterCurrentReadResult = resultForContext(afterCurrentRead, "session");
  if (afterCurrentReadResult) return afterCurrentReadResult;
  if (!currentRow) return { kind: "remote_missing" };
  if (!args.isOwnedByUser(currentRow, args.expectedUserId!)) {
    return { kind: "stale" };
  }
  if (!args.isDraft(currentRow)) return { kind: "remote_state", row: currentRow };
  if (!args.sameDraft(initialRow, currentRow)) {
    return { kind: "document_changed", row: currentRow };
  }

  let reserved: TRow | null;
  try {
    reserved = await args.reserve(args.decaId);
  } catch (reservationError) {
    return reconcile(reservationError);
  }

  const afterReservation = await checkContext();
  if (afterReservation.kind === "stale") return { kind: "stale" };
  if (afterReservation.kind === "session_error") {
    return reconcile(afterReservation.error);
  }
  if (reserved) {
    return args.isOwnedByUser(reserved, args.expectedUserId!)
      ? { kind: "reserved", row: reserved }
      : { kind: "stale" };
  }
  return reconcile(null);

  async function reconcile(
    reservationError: unknown | null,
  ): Promise<EmissionPreparationResult<TRow>> {
    const beforeRead = await checkContext();
    if (beforeRead.kind === "stale") return { kind: "stale" };
    if (beforeRead.kind === "session_error") {
      return {
        kind: "reservation_uncertain",
        reservationError,
        reconciliationError: beforeRead.error,
      };
    }

    let reconciledRow: TRow | null;
    try {
      reconciledRow = await args.readRemoteDeCA(args.decaId);
    } catch (reconciliationError) {
      const afterFailedRead = await checkContext();
      if (afterFailedRead.kind === "stale") return { kind: "stale" };
      return {
        kind: "reservation_uncertain",
        reservationError,
        reconciliationError:
          afterFailedRead.kind === "session_error"
            ? afterFailedRead.error
            : reconciliationError,
      };
    }

    const afterRead = await checkContext();
    if (afterRead.kind === "stale") return { kind: "stale" };
    if (afterRead.kind === "session_error") {
      return {
        kind: "reservation_uncertain",
        reservationError,
        reconciliationError: afterRead.error,
      };
    }
    if (
      reconciledRow &&
      !args.isOwnedByUser(reconciledRow, args.expectedUserId!)
    ) {
      return { kind: "stale" };
    }
    return {
      kind: "reservation_reconciled",
      row: reconciledRow,
      reservationError,
    };
  }
}
