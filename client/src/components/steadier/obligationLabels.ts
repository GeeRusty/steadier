import type { ObligationCadence, ObligationKind } from "../../domain/types";

export const KIND_LABEL: Record<ObligationKind, string> = {
  bill: "Bill",
  renewal: "Renewal",
  licence: "Licence",
  insurance: "Insurance",
  tax: "Tax date",
  "cancel-by": "Cancel by",
};
export const CADENCE_LABEL: Record<ObligationCadence, string> = {
  none: "Does not repeat",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
