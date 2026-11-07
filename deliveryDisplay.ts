import type { Delivery } from "./types";

export const getDeliveryCardTitle = (
  delivery: Pick<Delivery, "recipient" | "concept" | "sourceType">,
): string =>
  delivery.recipient.trim() ||
  delivery.concept ||
  (delivery.sourceType === "DECA" ? "Destinatario no especificado" : "");
