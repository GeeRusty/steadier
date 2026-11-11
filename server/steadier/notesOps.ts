// Daily Log notes, shared by the Claude connector and the voice assistant.
import { randomUUID } from "node:crypto";
import { MAX_DAILY_LOG_ENTRIES, MAX_DAILY_LOG_TEXT } from "../../client/src/domain/dailyLog";
import { adelaideClock } from "../../client/src/domain/time";
import type { DailyLogEntry, Workspace } from "../../client/src/domain/types";
import { adelaideTimestamp } from "../../shared/time";
import { ChangeError, type ChangePlan } from "./changes";

export function planAddNote(
  workspace: Workspace,
  text: string,
  date: string | null,
  now: Date = new Date()
): ChangePlan<{ note: DailyLogEntry }> {
  const clean = text.trim();
  if (!clean) throw new ChangeError("INVALID_CHANGE", "The note is empty.");
  if (clean.length > MAX_DAILY_LOG_TEXT) throw new ChangeError("INVALID_CHANGE", "That note is too long.");
  const existing = workspace.dailyLog ?? [];
  if (existing.length >= MAX_DAILY_LOG_ENTRIES) throw new ChangeError("INVALID_CHANGE", "The Daily Log is full.");
  const stamp = adelaideTimestamp(now);
  const note: DailyLogEntry = {
    id: randomUUID(),
    date: date ?? adelaideClock(now).date,
    text: clean,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return {
    workspace: { ...workspace, dailyLog: [note, ...existing] },
    summary: `Added a Daily Log note for ${note.date}`,
    result: { note },
  };
}

/** Newest first, optionally filtered by text and a date range. */
export function findNotes(
  workspace: Workspace,
  options: { query?: string; from?: string; to?: string; limit?: number } = {}
): DailyLogEntry[] {
  const q = options.query?.trim().toLowerCase();
  return [...(workspace.dailyLog ?? [])]
    .filter(note => !q || note.text.toLowerCase().includes(q))
    .filter(note => !options.from || note.date >= options.from)
    .filter(note => !options.to || note.date <= options.to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit ?? 50);
}
