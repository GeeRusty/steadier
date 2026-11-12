import { defaultLeadTimeDays, newObligationDraft, saveObligation } from "./obligations";
import type { Obligation, ObligationCadence, ObligationKind, Workspace } from "./types";

/** What the server sends back from "Scan a bill" (already filtered). */
export interface ScanReply {
  provider: string;
  forWhat: string;
  amount: string | null;
  dueDate: string | null;
  cadence: ObligationCadence;
  renewalDate: string | null;
  cancelByDate: string | null;
  kind: ObligationKind;
  removed: number;
  notes: string[];
}

/** The confirm screen: every field is the owner's to check and change. */
export interface ScanForm {
  provider: string;
  forWhat: string;
  kind: ObligationKind;
  dueDate: string;
  cadence: ObligationCadence;
  amount: string;
  leadTimeDays: number;
  /** A second date on the same bill, offered as an extra obligation. */
  extra: { kind: "renewal" | "cancel-by"; dueDate: string } | null;
  addExtra: boolean;
}

export function scanFormFrom(reply: ScanReply, today: string): ScanForm {
  const kind = reply.kind;
  const dueDate =
    (kind === "cancel-by" ? reply.cancelByDate : kind === "renewal" ? reply.renewalDate : null) ??
    reply.dueDate ??
    reply.renewalDate ??
    reply.cancelByDate ??
    today;
  let extra: ScanForm["extra"] = null;
  if (kind !== "cancel-by" && reply.cancelByDate && reply.cancelByDate !== dueDate) {
    extra = { kind: "cancel-by", dueDate: reply.cancelByDate };
  } else if (kind !== "renewal" && kind !== "cancel-by" && reply.renewalDate && reply.renewalDate !== dueDate) {
    extra = { kind: "renewal", dueDate: reply.renewalDate };
  }
  return {
    provider: reply.provider,
    forWhat: reply.forWhat,
    kind,
    dueDate,
    cadence: reply.cadence,
    amount: reply.amount ?? "",
    leadTimeDays: defaultLeadTimeDays(kind),
    extra,
    addExtra: false,
  };
}

export function scanTitle(form: Pick<ScanForm, "provider" | "forWhat">): string {
  return [form.provider.trim(), form.forWhat.trim()].filter(Boolean).join(" — ");
}

function draftFor(
  title: string,
  kind: ObligationKind,
  dueDate: string,
  cadence: ObligationCadence,
  leadTimeDays: number,
  amount: string | null,
  stamp: string
): Obligation {
  return {
    ...newObligationDraft(dueDate, stamp),
    title,
    kind,
    dueDate,
    cadenceAnchorDate: dueDate,
    cadence,
    leadTimeDays,
    amountDue: amount,
    nextAction: kind === "cancel-by" ? `Decide: keep or cancel ${title}` : "",
  };
}

/** Save the checked scan as one draft (or two, if the owner ticked the extra date). */
export function saveScannedObligations(workspace: Workspace, form: ScanForm, stamp: string): Workspace {
  const title = scanTitle(form);
  if (!title) throw new Error("Enter the provider or what it's for.");
  const amount = form.amount.trim() || null;
  let next = saveObligation(
    workspace,
    draftFor(title, form.kind, form.dueDate, form.cadence, form.leadTimeDays, amount, stamp),
    "draft",
    stamp
  );
  if (form.extra && form.addExtra) {
    next = saveObligation(
      next,
      draftFor(title, form.extra.kind, form.extra.dueDate, "none", defaultLeadTimeDays(form.extra.kind), null, stamp),
      "draft",
      stamp
    );
  }
  return next;
}
