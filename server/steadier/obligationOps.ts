import { adelaideTimestamp } from "../../shared/time";
import { safeAmount, safeShortText } from "../../shared/safeFields";
import { amountsHiddenFromAI, defaultLeadTimeDays, newObligationDraft } from "../../client/src/domain/obligations";
import type { Obligation, ObligationCadence, ObligationKind, Workspace } from "../../client/src/domain/types";
import { ChangeError, type ChangePlan } from "./changes";

export interface SuggestedObligationInput {
  provider?: string;
  forWhat?: string;
  kind: ObligationKind;
  dueDate: string;
  cadence?: ObligationCadence;
  leadTimeDays?: number;
  amount?: string;
  nextAction?: string;
}

export interface SuggestedObligationResult {
  obligation: Obligation;
  /** Things the never-store filter threw away. */
  removed: number;
  amountNotSaved: boolean;
}

/**
 * Claude suggests an obligation. It is always a draft marked "Suggested by
 * Claude": no Compass link, no preparation task, no reminder until the owner
 * confirms it in Obligations. Only the safe fields are accepted, and the
 * never-store filter runs over every text field.
 */
export function planSuggestObligation(
  workspace: Workspace,
  input: SuggestedObligationInput,
  now: Date
): ChangePlan<SuggestedObligationResult> {
  const provider = safeShortText(input.provider ?? "", 80);
  const forWhat = safeShortText(input.forWhat ?? "", 80);
  const title = [provider.text, forWhat.text].filter(Boolean).join(" — ");
  if (!title) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Give the provider or what it's for, without account or reference numbers."
    );
  }
  const action = safeShortText(input.nextAction ?? "", 300);
  let removed = provider.removed + forWhat.removed + action.removed;
  const hidden = amountsHiddenFromAI(workspace);
  const amount = hidden ? null : safeAmount(input.amount);
  if (!hidden && input.amount && !amount) removed += 1;
  const stamp = adelaideTimestamp(now);
  const obligation: Obligation = {
    ...newObligationDraft(input.dueDate, stamp),
    title,
    kind: input.kind,
    dueDate: input.dueDate,
    cadenceAnchorDate: input.dueDate,
    cadence: input.cadence ?? "none",
    leadTimeDays: input.leadTimeDays ?? defaultLeadTimeDays(input.kind),
    amountDue: amount,
    nextAction:
      action.text || (input.kind === "cancel-by" ? `Decide: keep or cancel ${title}` : ""),
    status: "draft",
    suggestedBy: "claude",
  };
  return {
    workspace: { ...workspace, obligations: [...(workspace.obligations ?? []), obligation] },
    summary: `Claude: suggested obligation “${title}”`,
    result: { obligation, removed, amountNotSaved: hidden && !!input.amount },
  };
}
