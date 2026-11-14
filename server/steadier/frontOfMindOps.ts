// Front of Mind changes the Claude connector (and confirmed voice) may make.
// Claude may add (labelled), change wording (kept in History) and suggest Let
// go. Keep, Let go, make a task and promote stay with the owner, in Steadier.
import type { Workspace } from "../../client/src/domain/types";
import type { ConnectorActor } from "../../shared/cloud";
import { adelaideTimestamp } from "../../shared/time";
import {
  addFrontOfMind,
  editWording,
  findItem,
  FRONT_OF_MIND_TEXT_LIMIT,
  MAX_FRONT_OF_MIND,
  newFrontOfMindId,
  suggestLetGo,
  frontOfMindOf,
} from "../../client/src/domain/frontOfMind";
import { ChangeError, type ChangePlan } from "./changes";
import { connectorName } from "./connectorOps";

const short = (text: string) => (text.length > 80 ? `“${text.slice(0, 77)}…”` : `“${text}”`);

function openItem(workspace: Workspace, itemId: string) {
  const item = findItem(workspace, itemId);
  if (!item || item.became) throw new ChangeError("NOT_FOUND", "No Front of Mind item has that itemId. Read the list first.");
  return item;
}

/** Add an item. From Claude it's labelled "added by Claude" until the owner Keeps it. */
export function planAddFrontOfMind(
  workspace: Workspace,
  text: string,
  notes: string | undefined,
  now: Date,
  by: "owner" | "claude",
  note?: string
): ChangePlan<{ itemId: string; wording: string }> {
  const wording = text.replace(/\s+/g, " ").trim();
  if (!wording) throw new ChangeError("INVALID_CHANGE", "Say what's on the owner's mind in a few words.");
  if (wording.length > FRONT_OF_MIND_TEXT_LIMIT) throw new ChangeError("INVALID_CHANGE", `Keep it under ${FRONT_OF_MIND_TEXT_LIMIT} characters.`);
  if (frontOfMindOf(workspace).items.length >= MAX_FRONT_OF_MIND) throw new ChangeError("INVALID_CHANGE", "Front of Mind is full.");
  const id = newFrontOfMindId();
  const next = addFrontOfMind(workspace, id, wording, adelaideTimestamp(now), { by, notes, note });
  return {
    workspace: next,
    summary: `${by === "claude" ? "Claude" : "Owner"}: added ${short(wording)} to Front of Mind`,
    result: { itemId: id, wording },
  };
}

export function planEditFrontOfMindWording(
  workspace: Workspace,
  itemId: string,
  text: string,
  reason: string | undefined,
  now: Date,
  actor: ConnectorActor
): ChangePlan<{ itemId: string; wording: string; was: string }> {
  const item = openItem(workspace, itemId);
  if (item.letGoAt) throw new ChangeError("INVALID_CHANGE", "That item was let go by the owner; only they can bring it back.");
  const next = editWording(workspace, itemId, text, adelaideTimestamp(now), "claude", reason ?? "");
  if (next === workspace) throw new ChangeError("INVALID_CHANGE", "Nothing to change: give new wording, under 500 characters, that differs from the current wording.");
  return {
    workspace: next,
    summary: `${connectorName(actor)}: changed the wording of ${short(item.text)} in Front of Mind`,
    result: { itemId, wording: findItem(next, itemId)!.text, was: item.text },
  };
}

export function planSuggestFrontOfMindLetGo(
  workspace: Workspace,
  itemId: string,
  reason: string,
  now: Date,
  actor: ConnectorActor
): ChangePlan<{ itemId: string }> {
  const item = openItem(workspace, itemId);
  if (item.letGoAt) throw new ChangeError("INVALID_CHANGE", "That item is already let go.");
  if (!reason.trim()) throw new ChangeError("INVALID_CHANGE", "Give the owner a short reason.");
  const next = suggestLetGo(workspace, itemId, reason, adelaideTimestamp(now));
  return {
    workspace: next,
    summary: `${connectorName(actor)}: suggested letting go of ${short(item.text)} (owner decides)`,
    result: { itemId },
  };
}
