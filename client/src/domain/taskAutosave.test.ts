import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask } from "./engine";
import {
  TASK_AUTOSAVE_IDLE_MS,
  applyTaskAutosaveToWorkspace,
  applyTaskDraftToWorkspace,
  autosaveSyncAdvanced,
  buildCalendarDraftTask,
  canAutosaveCalendarDraft,
  createAutosaveDebouncer,
  hasMeaningfulTaskTitle,
  hasMeaningfulParsedTaskTitle,
  isServerConfirmedAutosave,
  taskAutosaveBlockReason,
  taskDraftChanged,
  taskMatchesExpectedSnapshot,
} from "./taskAutosave";
import { parseQuickAdd } from "./quickParse";
import type { PendingTaskAutosave, TaskAutosaveCloudState } from "./taskAutosave";
import type { Workspace } from "./types";

const STAMP = "2026-11-08T08:00:00+10:30";

function syntheticTask(title = "Synthetic autosave task") {
  return createTask({ id: "autosave-synthetic-1", title }, STAMP);
}

const syncedCloud: TaskAutosaveCloudState = {
  active: true,
  status: "synced",
  pending: false,
  revision: 9,
  lastSyncedAt: "2026-11-08T08:10:00+10:30",
};

afterEach(() => vi.useRealTimers());

describe("task autosave safeguards", () => {
  it("debounces edits and commits only the latest value after the idle delay", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosaveDebouncer(save);

    autosave.schedule("synthetic title");
    vi.advanceTimersByTime(TASK_AUTOSAVE_IDLE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    autosave.schedule("synthetic title and notes");
    vi.advanceTimersByTime(TASK_AUTOSAVE_IDLE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("synthetic title and notes");
    expect(autosave.pending()).toBe(false);
  });

  it("flushes once on field blur and discards a pending save on explicit cancel", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = createAutosaveDebouncer(save);

    autosave.schedule("synthetic field value");
    autosave.flush();
    autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("synthetic field value");

    autosave.schedule("cancelled local draft");
    autosave.cancel();
    vi.advanceTimersByTime(TASK_AUTOSAVE_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("requires a meaningful parsed title before Calendar creates a task", () => {
    expect(hasMeaningfulTaskTitle("  ")).toBe(false);
    expect(hasMeaningfulTaskTitle("  Pay the synthetic bill  ")).toBe(true);
    expect(hasMeaningfulParsedTaskTitle(" New task. ")).toBe(false);
    expect(hasMeaningfulParsedTaskTitle("Untitled task")).toBe(false);
    expect(canAutosaveCalendarDraft("", false)).toBe(false);
    expect(canAutosaveCalendarDraft("for 45 minutes", false)).toBe(false);
    expect(canAutosaveCalendarDraft("New task", false)).toBe(false);
    expect(hasMeaningfulParsedTaskTitle("tomorrow")).toBe(false);
    expect(hasMeaningfulParsedTaskTitle("every Saturday")).toBe(false);
    expect(hasMeaningfulParsedTaskTitle("Finish the report for 45 minutes")).toBe(true);
    expect(canAutosaveCalendarDraft("Synthetic appointment", true)).toBe(false);
    expect(canAutosaveCalendarDraft("Synthetic appointment", false)).toBe(true);
  });

  it("keeps a Calendar task ID stable and does not create an empty or flexible draft", () => {
    const placement = { date: "2026-11-08", start: 570 };
    const first = buildCalendarDraftTask(
      null,
      parseQuickAdd("Synthetic calendar appointment", placement.date, 480),
      placement
    );
    expect(first).not.toBeNull();
    expect(first?.schedule.date).toBe(placement.date);
    expect(first?.schedule.time).toBe("09:30");

    const changed = buildCalendarDraftTask(
      first,
      parseQuickAdd("Synthetic calendar appointment revised", placement.date, 480),
      placement
    );
    expect(changed?.id).toBe(first?.id);
    expect(
      buildCalendarDraftTask(
        null,
        parseQuickAdd("for 45 minutes", placement.date, 480),
        placement
      )
    ).toBeNull();
    expect(
      buildCalendarDraftTask(
        null,
        parseQuickAdd("New task", placement.date, 480),
        placement
      )
    ).toBeNull();
  });

  it("does not autosave voice drafts, stale records, workspace conflicts or blank titles", () => {
    expect(
      taskAutosaveBlockReason({
        title: "Synthetic task",
        voiceDraftPending: true,
        stale: false,
        workspaceConflict: false,
      })
    ).toBe("voice-draft");
    expect(
      taskAutosaveBlockReason({
        title: "Synthetic task",
        voiceDraftPending: false,
        stale: true,
        workspaceConflict: false,
      })
    ).toBe("stale");
    expect(
      taskAutosaveBlockReason({
        title: "Synthetic task",
        voiceDraftPending: false,
        stale: false,
        workspaceConflict: true,
      })
    ).toBe("conflict");
    expect(
      taskAutosaveBlockReason({
        title: " ",
        voiceDraftPending: false,
        stale: false,
        workspaceConflict: false,
      })
    ).toBe("empty-title");
    expect(
      taskAutosaveBlockReason({
        title: "Synthetic task",
        voiceDraftPending: false,
        stale: false,
        workspaceConflict: false,
        aiSuggestionPending: true,
      })
    ).toBe("suggestion-pending");
  });

  it("distinguishes editable task changes while ignoring only audit metadata", () => {
    const task = syntheticTask();
    const auditOnly = {
      ...task,
      updatedAt: "2026-11-08T08:01:00+10:30",
      history: [{ at: "2026-11-08T08:01:00+10:30", text: "Autosaved" }],
    };
    expect(taskDraftChanged(auditOnly, task)).toBe(false);
    expect(taskDraftChanged({ ...task, notes: "Synthetic note" }, task)).toBe(true);
  });

  it("requires the full saved baseline to match before an autosave can write", () => {
    const task = syntheticTask();
    expect(taskMatchesExpectedSnapshot(task, task)).toBe(true);
    expect(taskMatchesExpectedSnapshot({ ...task, notes: "Newer server note" }, task)).toBe(false);
    expect(taskMatchesExpectedSnapshot(undefined, task)).toBe(false);
  });

  it("updates only the matching synthetic task and rejects stale or Done bypass drafts", () => {
    const task = syntheticTask();
    const workspace = { tasks: [task] } as Workspace;
    const draft = { ...task, notes: "Synthetic autosaved note" };
    const saved = applyTaskDraftToWorkspace(
      workspace,
      task,
      draft,
      "Autosaved synthetic details"
    );
    expect(saved.accepted).toBe(true);
    if (!saved.accepted) return;
    expect(saved.task.id).toBe(task.id);
    expect(saved.task.createdAt).toBe(task.createdAt);
    expect(saved.task.notes).toBe("Synthetic autosaved note");
    expect(saved.task.history.at(-1)?.text).toBe("Autosaved synthetic details");
    expect(saved.workspace.tasks).toHaveLength(1);

    const newerWorkspace = {
      ...workspace,
      tasks: [{ ...task, notes: "Newer synthetic server value" }],
    } as Workspace;
    const stale = applyTaskDraftToWorkspace(newerWorkspace, task, draft);
    expect(stale.accepted).toBe(false);
    if (!stale.accepted) expect(stale.reason).toBe("stale");

    const doneBypass = applyTaskDraftToWorkspace(workspace, task, {
      ...task,
      state: "done",
    });
    expect(doneBypass.accepted).toBe(false);
    if (!doneBypass.accepted) expect(doneBypass.reason).toBe("invalid");
  });

  it("creates only titled synthetic tasks, refuses ID collisions, and preserves deleted-task drafts", () => {
    const task = syntheticTask();
    const emptyWorkspace = { tasks: [] } as unknown as Workspace;
    const blank = applyTaskAutosaveToWorkspace(emptyWorkspace, null, {
      ...task,
      title: "   ",
    });
    expect(blank.accepted).toBe(false);
    if (!blank.accepted) expect(blank.reason).toBe("invalid");
    expect(emptyWorkspace.tasks).toHaveLength(0);

    const placeholder = applyTaskAutosaveToWorkspace(emptyWorkspace, null, {
      ...task,
      title: "New task",
    });
    expect(placeholder.accepted).toBe(false);
    if (!placeholder.accepted) expect(placeholder.reason).toBe("invalid");

    const created = applyTaskAutosaveToWorkspace(emptyWorkspace, null, task);
    expect(created.accepted).toBe(true);
    if (!created.accepted) return;
    expect(created.workspace.tasks).toEqual([task]);

    const doneByAutosave = applyTaskAutosaveToWorkspace(
      emptyWorkspace,
      null,
      { ...task, state: "done" }
    );
    expect(doneByAutosave.accepted).toBe(false);
    if (!doneByAutosave.accepted) expect(doneByAutosave.reason).toBe("invalid");

    const collision = applyTaskAutosaveToWorkspace(
      { tasks: [task] } as Workspace,
      null,
      { ...task, title: "Attempted overwrite" }
    );
    expect(collision.accepted).toBe(false);
    if (!collision.accepted) expect(collision.reason).toBe("stale");

    const deleted = applyTaskAutosaveToWorkspace(
      emptyWorkspace,
      task,
      { ...task, notes: "Preserved synthetic draft" }
    );
    expect(deleted.accepted).toBe(false);
    if (!deleted.accepted) expect(deleted.reason).toBe("stale");
    expect(emptyWorkspace.tasks).toHaveLength(0);

    const legacyPlaceholder = syntheticTask("New task");
    const existingEdit = applyTaskDraftToWorkspace(
      { tasks: [legacyPlaceholder] } as Workspace,
      legacyPlaceholder,
      { ...legacyPlaceholder, notes: "Synthetic note on the legacy task" }
    );
    expect(existingEdit.accepted).toBe(true);
  });

  it("celebrates only a matching server-confirmed snapshot after revision advancement", () => {
    const task = syntheticTask();
    const ticket: PendingTaskAutosave = {
      token: 1,
      task,
      baseRevision: 8,
      baseLastSyncedAt: "2026-11-08T08:00:00+10:30",
    };
    expect(isServerConfirmedAutosave(ticket, syncedCloud, task)).toBe(true);
    expect(autosaveSyncAdvanced(ticket, syncedCloud)).toBe(true);

    expect(
      isServerConfirmedAutosave(
        ticket,
        { ...syncedCloud, status: "saving", pending: true },
        task
      )
    ).toBe(false);
    expect(isServerConfirmedAutosave(ticket, { ...syncedCloud, status: "offline" }, task)).toBe(false);
    expect(isServerConfirmedAutosave(ticket, { ...syncedCloud, status: "conflict" }, task)).toBe(false);
    expect(
      isServerConfirmedAutosave(
        ticket,
        { ...syncedCloud, lastSyncedAt: ticket.baseLastSyncedAt },
        task
      )
    ).toBe(false);
    expect(isServerConfirmedAutosave(ticket, syncedCloud, undefined)).toBe(false);
    expect(isServerConfirmedAutosave(ticket, syncedCloud, { ...task, title: "Other" })).toBe(false);
    expect(isServerConfirmedAutosave(ticket, syncedCloud, task, true)).toBe(false);
  });
});
