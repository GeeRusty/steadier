import { setTaskPlace } from "../../domain/places";
import { removeSmallStep } from "../../domain/smallSteps";
import WhyLine from "./WhyLine";
import type { ChainStep } from "../../domain/goals";
import { TaskCompassFields } from "./CompassFields";
import { suggestCatchAll, type Imperative } from "../../domain/compass";
import { downloadPrivate } from "../../lib/cloudApi";
import { formatAdelaide } from "../../../../shared/time";
import {
  adelaideClock,
  describeFlexibleWindow,
  flexibleCompletionNote,
  flexibleWindowState,
  formatDuration,
  rescheduleOccurrenceSchedule,
  setFlexibleWindowSchedule,
  type TaskSchedule,
} from "../../domain/time";
import { parseQuickAdd } from "../../domain/quickParse";
import {
  hasNativeVoiceDraftHandoff,
  isNativeVoiceDraftEvent,
} from "../../domain/nativeVoice";
import { useVoice } from "../../hooks/useVoice";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CornerDownRight,
  Mic,
  Plus,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import TimeChips from "./TimeChips";
import LifeAreaPicker from "./LifeAreaPicker";
import TimingShapeMark from "./TimingShapeMark";
import TaskDetailDoneControl from "./TaskDetailDoneControl";
import {
  MAX_SUBTASK_DEPTH,
  ancestorsOf,
  childrenOf,
  depthOf,
  descendantsOf,
  parentProblem,
  spokenSubtaskContext,
  subtaskProgress,
  subtreeHeight,
} from "../../domain/subtasks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import type {
  Place,
  Task,
  TaskState,
  Context,
  Project,
  LifeRole,
  LifePattern,
} from "../../domain/types";
import { STATES } from "../../domain/types";
import {
  autosaveSyncAdvanced,
  createAutosaveDebouncer,
  isServerConfirmedAutosave,
  taskAutosaveBlockReason,
  taskDraftChanged,
  taskMatchesExpectedSnapshot,
  TASK_AUTOSAVE_IDLE_MS,
  type PendingTaskAutosave,
  type TaskAutosaveCloudState,
  type TaskAutosaveSaveResult,
} from "../../domain/taskAutosave";
import {
  stateLabel,
  derivedState,
  deadlineLabel,
  skipOccurrence,
} from "../../domain/engine";
import ScheduleEditor from "./ScheduleEditor";

interface Props {
  task: Task;
  tasks: Task[];
  projects: Project[];
  onClose: () => void;
  onSave: (task: Task) => boolean | void;
  onAutosave: (task: Task, baseline: Task) => TaskAutosaveSaveResult;
  autosaveCloud: TaskAutosaveCloudState;
  onDone: (id: string, updated?: Task) => boolean | void;
  onRead: (text: string) => void;
  imperatives?: Imperative[];
  /** Plain-language chain up to the Pillars for the chosen project. */
  whyFor?: (projectId: string | null) => string;
  /** Upward chains for the chosen project, shown as tappable links. */
  whyChains?: (projectId: string | null) => ChainStep[][];
  onOpenGoal?: (id: string) => void;
  /** Switch the editor to another task (parent or subtask). */
  onOpenTask?: (task: Task) => void;
  /** Create a subtask under a saved task; returns an error message or null. */
  onAddSubtask?: (parentId: string, title: string) => string | null;
  /** Finish a subtask without closing this editor. */
  onCompleteSubtask?: (id: string) => void;
  /** Delete one subtask after explicit owner confirmation. */
  onDeleteSubtask?: (id: string) => boolean;
  /** Reopen a deliberately Dropped task; the record itself is kept. */
  onReopenDropped?: (id: string) => boolean;
  /** Saved places for location reminders (v2.7). */
  places?: Place[];
  /** Open Near me to add or manage places. */
  onManagePlaces?: () => void;
}
function makesCycle(task: Task, tasks: Task[]) {
  const walk = (id: string, visited: Set<string>): boolean => {
    if (id === task.id) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (tasks.find(t => t.id === id)?.dependencies || []).some(dep =>
      walk(dep, visited)
    );
  };
  return task.dependencies.some(id => walk(id, new Set()));
}
export default function TaskEditor({
  task,
  tasks,
  projects,
  onClose,
  onSave,
  onAutosave,
  autosaveCloud,
  onDone,
  onRead,
  imperatives = [],
  whyFor,
  whyChains,
  onOpenGoal,
  onOpenTask,
  onAddSubtask,
  onCompleteSubtask,
  onDeleteSubtask,
  onReopenDropped,
  places = [],
  onManagePlaces,
}: Props) {
  const [draft, setDraft] = useState<Task>(() => structuredClone(task));
  const [autosaveState, setAutosaveState] = useState<"saving" | "saved" | "not-saved">("saved");
  const [autosaveDetail, setAutosaveDetail] = useState("");
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [voiceDraftPending, setVoiceDraftPending] = useState(false);
  const voiceDraftPendingRef = useRef(false);
  const pendingServerAutosaveRef = useRef<PendingTaskAutosave | null>(null);
  const baselineRef = useRef(task);
  baselineRef.current = task;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const onAutosaveRef = useRef(onAutosave);
  onAutosaveRef.current = onAutosave;
  const cloudRef = useRef(autosaveCloud);
  cloudRef.current = autosaveCloud;
  const runAutosaveRef = useRef<
    (snapshot: Task) => TaskAutosaveSaveResult | undefined
  >(() => undefined);
  const autosaveRef = useRef<
    ReturnType<
      typeof createAutosaveDebouncer<Task, TaskAutosaveSaveResult | undefined>
    > | null
  >(null);
  if (!autosaveRef.current) {
    autosaveRef.current = createAutosaveDebouncer(snapshot =>
      runAutosaveRef.current(snapshot)
    );
  }
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskError, setSubtaskError] = useState("");
  const [pendingDeleteSubtask, setPendingDeleteSubtask] =
    useState<Task | null>(null);
  const [pendingDeleteStep, setPendingDeleteStep] = useState<
    Task["checklist"][number] | null
  >(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskVoice = useVoice();
  const [voiceCaptureRequested, setVoiceCaptureRequested] = useState(false);
  const [voiceDraftNote, setVoiceDraftNote] = useState("");
  const dirty = taskDraftChanged(draft, task) || voiceDraftPending;
  const hasUnconfirmedProjectSuggestion = (candidate: Task) =>
    candidate.labelSource === "suggested" &&
    (candidate.projectId !== task.projectId ||
      candidate.role !== task.role ||
      candidate.pattern !== task.pattern);
  const hasUnconfirmedSuggestion = (candidate: Task) =>
    Boolean(candidate.parent?.suggested) ||
    hasUnconfirmedProjectSuggestion(candidate);
  /** Leave for another task or page without losing unsaved edits silently. */
  const leave = (go: () => void) => {
    if (
      dirty &&
      !window.confirm(
        "Leave this task? Changes are saved automatically after a short pause. Any voice draft or change still marked Not saved will remain unsaved."
      )
    )
      return;
    go();
  };
  const children = childrenOf(tasks, task.id);
  const progress = subtaskProgress(tasks, task.id);
  const parentTask = draft.parent
    ? (tasks.find(t => t.id === draft.parent!.id) ?? null)
    : null;
  const parentPath = parentTask
    ? [...ancestorsOf(tasks, parentTask)].reverse().concat(parentTask)
    : [];
  const ownDepth = parentTask ? depthOf(tasks, parentTask) + 1 : 0;
  const canAddChild = ownDepth < MAX_SUBTASK_DEPTH;
  const eligibleParents = useMemo(() => {
    const below = new Set(descendantsOf(tasks, task.id).map(t => t.id));
    const height = subtreeHeight(tasks, task.id);
    return tasks
      .filter(
        t =>
          t.id === task.parent?.id ||
          (t.id !== task.id &&
            t.state !== "done" &&
            !below.has(t.id) &&
            depthOf(tasks, t) + 1 + height <= MAX_SUBTASK_DEPTH)
      )
      .sort(
        (a, b) =>
          Number(b.projectId === task.projectId && !!task.projectId) -
            Number(a.projectId === task.projectId && !!task.projectId) ||
          a.title.localeCompare(b.title)
      );
  }, [tasks, task]);
  const chooseParent = (id: string) => {
    if (!id) {
      setDraft(d => {
        const { parent: _parent, ...rest } = d;
        return rest;
      });
      return;
    }
    const chosen = tasks.find(t => t.id === id);
    setDraft(d => ({
      ...d,
      parent: { id, suggested: false },
      // A task with no project joins its parent's project.
      ...(!d.projectId && chosen?.projectId
        ? {
            projectId: chosen.projectId,
            compass: {
              ...d.compass,
              projectSuggested: chosen.compass.projectSuggested,
            },
          }
        : {}),
    }));
  };
  const changedElsewhere = !taskMatchesExpectedSnapshot(
    tasks.find(t => t.id === task.id),
    task
  );
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (taskVoice.listening || !voiceCaptureRequested) return;
    const transcript = taskVoice.finalTranscript.trim();
    if (!transcript) {
      if (!taskVoice.error)
        setVoiceDraftNote(
          "No final transcript was received; no fields changed."
        );
      setVoiceCaptureRequested(false);
      return;
    }

    const clock = adelaideClock();
    const parsed = parseQuickAdd(transcript, clock.date, clock.minutes);
    voiceDraftPendingRef.current = true;
    setVoiceDraftPending(true);
    autosaveRef.current?.cancel();
    setDraft(current => {
      let schedule = current.schedule;
      if (parsed.flexibleWindow) {
        schedule = setFlexibleWindowSchedule(
          schedule,
          parsed.flexibleWindow,
          current.deadline ?? current.startDate
        );
        if (parsed.minutes !== null)
          schedule = { ...schedule, minutes: parsed.minutes };
        if (parsed.repeat) {
          schedule = {
            ...schedule,
            repeat: parsed.repeat,
            repeatAnchorDate:
              schedule.repeatAnchorDate ?? parsed.flexibleWindow.startDate,
            repeatOccurrenceDate: parsed.flexibleWindow.startDate,
            repeatTime: null,
          };
        }
      } else {
        if (parsed.date || parsed.time) {
          const changes: Partial<Pick<TaskSchedule, "date" | "time">> = {};
          if (parsed.date) changes.date = parsed.date;
          if (parsed.time) changes.time = parsed.time;
          schedule = rescheduleOccurrenceSchedule(
            schedule,
            changes,
            current.deadline ?? current.startDate
          );
        }
        if (parsed.minutes !== null)
          schedule = { ...schedule, minutes: parsed.minutes };
        if (parsed.repeat) {
          const anchorDate =
            schedule.repeatAnchorDate ??
            schedule.repeatOccurrenceDate ??
            schedule.date ??
            current.deadline ??
            current.startDate ??
            null;
          schedule = {
            ...schedule,
            repeat: parsed.repeat,
            repeatAnchorDate: anchorDate,
            repeatOccurrenceDate:
              schedule.repeatOccurrenceDate ?? schedule.date ?? anchorDate,
            repeatTime:
              schedule.repeatTime !== undefined
                ? schedule.repeatTime
                : schedule.time,
          };
        }
        if (parsed.fixed) schedule = { ...schedule, fixed: true };
      }
      if (parsed.deadlineTime && (parsed.deadline || current.deadline))
        schedule = { ...schedule, deadlineTime: parsed.deadlineTime };
      return {
        ...current,
        ...(parsed.title.trim() ? { title: parsed.title.trim() } : {}),
        deadline: parsed.deadline ?? current.deadline,
        schedule,
      };
    });
    const understood = parsed.understood.length
      ? parsed.understood.join(" · ")
      : "task title";
    setVoiceDraftNote(
      `Editable voice draft applied (${understood}). Review the fields, then choose Save changes; nothing has been saved yet.`
    );
    setVoiceCaptureRequested(false);
  }, [
    taskVoice.error,
    taskVoice.finalTranscript,
    taskVoice.listening,
    voiceCaptureRequested,
  ]);
  const speechSupported =
    typeof window !== "undefined" &&
    !!window.speechSynthesis &&
    "SpeechSynthesisUtterance" in window;
  const nativeVoiceFallback =
    !taskVoice.supported && hasNativeVoiceDraftHandoff();
  const readFlexibleWindow = () => {
    const flexibleWindow = draft.schedule.flexibleWindow;
    if (!flexibleWindow) return;
    const today = adelaideClock().date;
    const status = flexibleWindowState(flexibleWindow, today);
    const timing =
      status === "expired"
        ? "Needs rescheduling."
        : status === "closes-today"
          ? "Window closes today."
          : `Finish within ${describeFlexibleWindow(flexibleWindow, today)}.`;
    onRead(
      `${draft.title}. Flexible time window: ${timing} ${
        draft.schedule.minutes
          ? `Explicit effort estimate: ${formatDuration(draft.schedule.minutes)}.`
          : "No effort estimate entered."
      } No time of day is planned.`
    );
  };
  const patch = <K extends keyof Task>(key: K, value: Task[K]) =>
    setDraft(d => ({ ...d, [key]: value }));
  const classify = (change: Partial<Task>) =>
    setDraft(d => {
      const next = { ...d, ...change };
      next.labelSource =
        next.role && next.pattern ? "suggested" : "unclassified";
      return next;
    });
  const validated = (
    candidate: Task = draft,
    showError = true
  ): Task | undefined => {
    const fail = (message: string) => {
      if (showError) setError(message);
      return undefined;
    };
    if (!candidate.title.trim())
      return fail("Give this responsibility a name.");
    if (
      candidate.parent &&
      candidate.parent.id !== baselineRef.current.parent?.id
    ) {
      const problem = parentProblem(tasksRef.current, task.id, candidate.parent.id);
      if (problem) return fail(problem);
    }
    if (makesCycle(candidate, tasksRef.current))
      return fail(
        "These prerequisites form a circle. Choose a dependency that can finish independently."
      );
    if (
      (candidate.state === "waiting" || candidate.state === "blocked") &&
      !candidate.waitingFor.trim() &&
      !candidate.dependencies.length
    )
      return fail("Name what you are waiting for or choose a prerequisite.");
    // Keep normalization pure; opening or validating the editor never mutates
    // the persisted draft object in place.
    return {
      ...candidate,
      state:
        candidate.state === "ready" && !candidate.nextAction.trim()
          ? "inbox"
          : candidate.state,
      title: candidate.title.trim(),
      repeatDays: null,
    };
  };
  const saveAutosavedDraft = (snapshot: Task): TaskAutosaveSaveResult | undefined => {
    const baseline = baselineRef.current;
    const latestTasks = tasksRef.current;
    const cloud = cloudRef.current;
    const block = taskAutosaveBlockReason({
      title: snapshot.title,
      voiceDraftPending: voiceDraftPendingRef.current,
      stale:
        autosaveBlocked ||
        !taskMatchesExpectedSnapshot(
          latestTasks.find(t => t.id === baseline.id),
          baseline
        ),
      workspaceConflict: cloud.status === "conflict",
      aiSuggestionPending: hasUnconfirmedSuggestion(snapshot),
    });
    if (block) {
      const detail =
        block === "voice-draft"
          ? "Voice text is still an editable draft. Review it and tap Save changes."
          : block === "empty-title"
            ? "A non-empty title is required; the blank draft was not saved."
          : block === "conflict"
              ? "Sync conflict: your edits are preserved. Resolve the conflict before saving again."
              : block === "suggestion-pending"
                ? "A suggested link or placement is not autosaved. Confirm or reject it first; your draft stays here."
                : "This task changed elsewhere. Your edits are preserved; reopen the latest task before saving.";
      setAutosaveState("not-saved");
      setAutosaveDetail(detail);
      if (block === "stale" || block === "conflict")
        setAutosaveBlocked(true);
      return {
        accepted: false,
        reason:
          block === "stale"
            ? "stale"
            : block === "conflict"
              ? "blocked"
              : "invalid",
        message: detail,
      };
    }
    const valid = validated(snapshot, false);
    if (!valid) {
      const detail = "Not saved. Fix the task details shown below, then try again.";
      setAutosaveState("not-saved");
      setAutosaveDetail(detail);
      return { accepted: false, reason: "invalid", message: detail };
    }
    if (!taskDraftChanged(valid, baseline)) return undefined;

    const result = onAutosaveRef.current(valid, baseline);
    if (!result.accepted) {
      setAutosaveState("not-saved");
      setAutosaveDetail(result.message);
      if (result.reason === "stale" || result.reason === "blocked")
        setAutosaveBlocked(true);
      return result;
    }
    setError("");
    pendingServerAutosaveRef.current = result.ticket;
    setDraft(current => ({
      ...current,
      updatedAt: result.task.updatedAt,
      history: result.task.history,
    }));
    setAutosaveState(result.serverPending ? "saving" : "saved");
    setAutosaveDetail(
      result.serverPending
        ? "Waiting for Steadier to confirm the save."
        : "Saved on this device."
    );
    return result;
  };
  runAutosaveRef.current = saveAutosavedDraft;

  useEffect(() => {
    if (!onAutosave) return;
    const cloud = autosaveCloud;
    const ticket = pendingServerAutosaveRef.current;
    if (!ticket) return;
    if (cloud.status === "conflict") {
      setAutosaveBlocked(true);
      setAutosaveState("not-saved");
      setAutosaveDetail(
        "Sync conflict: your edits remain here. Resolve the conflict before continuing."
      );
      return;
    }
    if (cloud.status === "offline" || cloud.status === "error") {
      setAutosaveState("not-saved");
      setAutosaveDetail(
        "Not saved to the server yet. Your local draft is preserved; check the sync status and retry."
      );
      return;
    }
    const serverTask = tasks.find(item => item.id === ticket.task.id);
    if (isServerConfirmedAutosave(ticket, cloud, serverTask)) {
      pendingServerAutosaveRef.current = null;
      setAutosaveBlocked(false);
      setAutosaveState("saved");
      setAutosaveDetail("Saved to Steadier.");
      return;
    }
    if (autosaveSyncAdvanced(ticket, cloud)) {
      pendingServerAutosaveRef.current = null;
      setAutosaveBlocked(true);
      setAutosaveState("not-saved");
      setAutosaveDetail(
        "The server has a different task version. Your edits are preserved; reopen the current version before saving."
      );
    }
  }, [
    autosaveCloud.active,
    autosaveCloud.lastSyncedAt,
    autosaveCloud.pending,
    autosaveCloud.revision,
    autosaveCloud.status,
    onAutosave,
    tasks,
    task.id,
  ]);

  useEffect(() => {
    if (!onAutosave) return;
    const autosaver = autosaveRef.current;
    if (!autosaver) return;
    const block = taskAutosaveBlockReason({
      title: draft.title,
      voiceDraftPending: voiceDraftPending || taskVoice.listening || voiceCaptureRequested,
      stale: changedElsewhere || autosaveBlocked,
      workspaceConflict: autosaveCloud.status === "conflict",
      aiSuggestionPending: hasUnconfirmedSuggestion(draft),
    });
    if (block) {
      autosaver.cancel();
      if (block === "voice-draft") {
        setAutosaveState("not-saved");
        setAutosaveDetail(
          "Voice text is an editable draft. Review it and tap Save changes; it will not autosave."
        );
      } else if (block === "empty-title") {
        setAutosaveState("not-saved");
        setAutosaveDetail("A non-empty title is required; the blank draft was not saved.");
      } else if (block === "stale" || block === "conflict") {
        setAutosaveBlocked(true);
        setAutosaveState("not-saved");
        setAutosaveDetail(
          block === "conflict"
            ? "Sync conflict: your edits are preserved until you resolve it."
            : "This task changed elsewhere. Your edits are preserved and will not overwrite it."
        );
      } else if (block === "suggestion-pending") {
        setAutosaveState("not-saved");
        setAutosaveDetail(
          "Confirm or reject the suggested link or placement before it can be saved."
        );
      }
      return;
    }
    const valid = validated(draft, false);
    if (!valid) {
      autosaver.cancel();
      setAutosaveState("not-saved");
      setAutosaveDetail("Not saved. Fix the task details shown below, then try again.");
      return;
    }
    if (!taskDraftChanged(valid, task)) {
      if (!pendingServerAutosaveRef.current) {
        setAutosaveState("saved");
        setAutosaveDetail("");
      }
      return;
    }
    setAutosaveState("saving");
    setAutosaveDetail("Changes save after a short pause.");
    autosaver.schedule(valid);
    return () => autosaver.cancel();
  }, [
    autosaveBlocked,
    autosaveCloud.status,
    changedElsewhere,
    draft,
    onAutosave,
    task,
    taskVoice.listening,
    voiceCaptureRequested,
    voiceDraftPending,
  ]);

  useEffect(() => () => autosaveRef.current?.cancel(), []);

  const save = () => {
    autosaveRef.current?.cancel();
    const valid = validated(draft, true);
    if (!valid) return;
    if (hasUnconfirmedSuggestion(valid)) {
      const detail =
        "Confirm or reject the suggested link or placement before saving this task.";
      setError(detail);
      setAutosaveState("not-saved");
      setAutosaveDetail(detail);
      return;
    }
    const accepted = onSave(valid);
    if (accepted === false) {
      setAutosaveState("not-saved");
      setAutosaveDetail("Not saved. Your edits are still open; check sync and try again.");
    }
  };
  const areas = [
    ...new Set([
      "Home",
      "Vehicles",
      "Business",
      "Personal",
      ...tasks.map(t => t.area),
    ]),
  ];
  return (
    <Dialog open onOpenChange={open => !open && leave(onClose)}>
      <DialogContent
        className="task-dialog"
        onBlurCapture={event => {
          const target = event.target as HTMLElement;
          if (!target.matches("input, textarea, select")) return;
          const next = event.relatedTarget as HTMLElement | null;
          if (next?.closest("[data-task-autosave-exempt]")) return;
          autosaveRef.current?.flush();
        }}
        onInputCapture={event => {
          if (!isNativeVoiceDraftEvent(event.nativeEvent)) return;
          voiceDraftPendingRef.current = true;
          setVoiceDraftPending(true);
          autosaveRef.current?.cancel();
          setVoiceDraftNote(
            "Native voice text is an editable draft. Review it, then tap Save changes."
          );
        }}
      >
        <div className="eyebrow">
          RESPONSIBILITY DETAIL <TimingShapeMark task={draft} />
        </div>
        <DialogTitle className="dialog-heading">
          Make the next step clear.
        </DialogTitle>
        <DialogDescription>
          Everything you need to pick this up again, in one place.
        </DialogDescription>
        <div className="task-title-done-row">
          <label className="field task-detail-title-field">
            Responsibility
            <input
              id="task-editor-responsibility"
              form="task-editor-form"
              ref={titleInputRef}
              value={draft.title}
              onChange={e => patch("title", e.target.value)}
              onInputCapture={event => {
                if (!isNativeVoiceDraftEvent(event.nativeEvent)) return;
                voiceDraftPendingRef.current = true;
                setVoiceDraftPending(true);
                autosaveRef.current?.cancel();
                setVoiceDraftNote(
                  "Native voice text was inserted into the title only. Review the title, set any timing or effort below, then choose Save changes."
                );
              }}
              required
              maxLength={240}
            />
          </label>
          <TaskDetailDoneControl
            taskTitle={draft.title}
            checked={task.state === "done"}
            disabled={task.state === "done" || changedElsewhere}
            onChange={() => {
              autosaveRef.current?.cancel();
              const valid = validated(draft, true);
              if (!valid) return;
              if (hasUnconfirmedSuggestion(valid)) {
                const detail =
                  "Confirm or reject the suggested link or placement before marking this task Done.";
                setError(detail);
                setAutosaveState("not-saved");
                setAutosaveDetail(detail);
                return;
              }
              const accepted = onDone(task.id, valid);
              if (accepted === false) {
                setAutosaveState("not-saved");
                setAutosaveDetail(
                  "Not saved. Your edits are still open; check sync and try again."
                );
              }
            }}
            note={
              draft.schedule.flexibleWindow
                ? (() => {
                    const w = draft.schedule.flexibleWindow!;
                    const status = flexibleCompletionNote(
                      draft.schedule,
                      adelaideClock().date
                    )?.status;
                    const span =
                      w.startDate === w.endDate
                        ? w.startDate
                        : `${w.startDate} to ${w.endDate}`;
                    const again = draft.schedule.repeat
                      ? " Marks this one only."
                      : "";
                    if (status === "late")
                      return `Window ${span} closed; recorded as late.${again}`;
                    if (status === "early")
                      return `Window ${span} not open yet.${again}`;
                    return `Window ${span}; on time through ${w.endDate}.${again}`;
                })()
                : draft.schedule.repeat
                  ? "Marking Done completes only this occurrence; the next one stays scheduled."
                  : undefined
            }
          />
        </div>
        <div
          className={`task-autosave-status is-${autosaveState}`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {autosaveState === "saving"
              ? "Saving…"
              : autosaveState === "saved"
                ? "Saved"
                : "Not saved"}
          </strong>
          {autosaveDetail && <span>{autosaveDetail}</span>}
        </div>
        {draft.parent && (
          <div
            className={`subtask-crumb${draft.parent.suggested ? " suggested" : ""}`}
          >
            <CornerDownRight size={15} aria-hidden />
            <span className="small">
              {draft.parent.suggested ? "Suggested subtask of" : "Subtask of"}
            </span>
            {parentPath.length ? (
              parentPath.map((t, i) => (
                <span key={t.id} className="subtask-crumb-step">
                  {i > 0 && <span aria-hidden> › </span>}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => leave(() => onOpenTask?.(t))}
                    disabled={!onOpenTask}
                  >
                    {t.title}
                  </button>
                </span>
              ))
            ) : (
              <span className="small muted">a task that no longer exists</span>
            )}
            {draft.parent.suggested && (
              <span className="subtask-crumb-actions">
                <button
                  type="button"
                  className="button secondary small-button"
                  onClick={() =>
                    setDraft(d => ({
                      ...d,
                      parent: { id: d.parent!.id, suggested: false },
                    }))
                  }
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => chooseParent("")}
                >
                  Reject
                </button>
                <span className="small muted">Saved when you press Save.</span>
              </span>
            )}
          </div>
        )}
        {changedElsewhere && (
          <div className="notice" role="alert">
            <strong>
              This responsibility changed while your draft was open.
            </strong>
            <p>
              Your draft is still here, but it will not overwrite the updated
              record silently. Download it before closing and reopening the
              responsibility. This draft file is not a full backup.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                downloadPrivate(
                  JSON.stringify(draft, null, 2),
                  "steadier-task-draft.json"
                )
              }
            >
              Download this task draft
            </button>
          </div>
        )}
        {task.droppedAt && (
          <div className="notice dropped-decision-notice" role="status">
            <strong>Dropped — kept decision</strong>
            <p>This task was not deleted. It remains in All Work and can be returned to the pool.</p>
            <button
              type="button"
              className="button secondary small-button"
              disabled={!onReopenDropped}
              onClick={() => onReopenDropped?.(task.id)}
            >
              Reopen to pool
            </button>
          </div>
        )}

        <form
          id="task-editor-form"
          onSubmit={e => {
            e.preventDefault();
            save();
          }}
        >
          <div className="voice-control task-edit-voice">
            {taskVoice.supported ? (
              <button
                type="button"
                className={`button ${taskVoice.listening ? "listening" : "secondary"}`}
                onClick={() => {
                  if (taskVoice.listening) {
                    taskVoice.stop();
                    return;
                  }
                  setVoiceDraftNote("");
                  setVoiceCaptureRequested(true);
                  taskVoice.start();
                }}
              >
                {taskVoice.listening ? <Square size={17} /> : <Mic size={17} />}
                {taskVoice.listening ? "Stop listening" : "Speak task update"}
              </button>
            ) : nativeVoiceFallback ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  const input = titleInputRef.current;
                  if (!input) return;
                  input.focus();
                  input.setSelectionRange(
                    input.value.length,
                    input.value.length
                  );
                  setVoiceDraftNote(
                    "Title focused. In the Android app’s Tools/Voice panel, start dictation, review/edit the draft, then tap Place in open field. It inserts text only; Save changes is still required."
                  );
                }}
              >
                <Mic size={17} /> Focus title for app Voice
              </button>
            ) : (
              <span className="small muted">
                Speech recognition is unavailable in this browser.
              </span>
            )}
            <span className="small muted" role="status" aria-live="polite">
              {taskVoice.listening
                ? "Listening. Only final speech is applied after listening ends."
                : voiceDraftNote ||
                  (taskVoice.supported
                    ? "Optional browser dictation fills an editable draft. Review it before saving."
                    : nativeVoiceFallback
                      ? "Focus the title, then use the app’s opt-in Voice panel to place a reviewed draft here."
                      : "Edit the title and timing manually in this browser.")}
            </span>
          </div>
          <p className="small muted">
            Browser dictation may process audio with its provider. Native app
            dictation inserts text into the focused title only. Review the
            title, timing and effort, then choose Save changes; nothing is saved
            automatically from voice.
          </p>
          {!taskVoice.supported && !nativeVoiceFallback && (
            <p className="notice small">
              Speech recognition is not available here. You can edit manually,
              or use a keyboard microphone where supported.
            </p>
          )}
          {taskVoice.error && (
            <p className="error" role="alert">
              {taskVoice.error}
            </p>
          )}
          <label className="field featured-field">
            Next physical step
            <textarea
              value={draft.nextAction}
              onChange={e => patch("nextAction", e.target.value)}
              placeholder="Something small and specific you can actually begin."
              maxLength={1000}
              rows={2}
            />
          </label>
          <details
            className="detail-section life-identity"
            open={!!draft.role || !!draft.projectId}
          >
            <summary>
              Its place in My Life ·{" "}
              {draft.labelSource === "suggested"
                ? "suggested, editable"
                : draft.labelSource === "confirmed"
                  ? "chosen by me"
                  : "can be clarified later"}
            </summary>
            <p className="small muted">
              Direction gives life its shape. Support keeps it working. Neither
              is a lower-value category.
            </p>
            <label className="field">
              Why this belongs in my life
              <input
                aria-label="Responsibility purpose"
                value={draft.purpose}
                onChange={e => patch("purpose", e.target.value)}
                maxLength={2000}
                placeholder="What this enables, protects or moves forward."
              />
            </label>
            <div className="form-pair">
              <label className="field">
                Role
                <select
                  aria-label="Responsibility role"
                  value={draft.role || ""}
                  onChange={e =>
                    classify({
                      role: (e.target.value || null) as LifeRole | null,
                    })
                  }
                >
                  <option value="">Clarify later</option>
                  <option value="direction">Direction</option>
                  <option value="support">Support</option>
                </select>
              </label>
              <label className="field">
                Attention pattern
                <select
                  aria-label="Responsibility attention pattern"
                  value={draft.pattern || ""}
                  onChange={e =>
                    classify({
                      pattern: (e.target.value || null) as LifePattern | null,
                    })
                  }
                >
                  <option value="">Clarify later</option>
                  <option value="timely">
                    Timely — within a meaningful window
                  </option>
                  <option value="sustained">
                    Sustained — continued attention
                  </option>
                </select>
              </label>
            </div>
            {hasUnconfirmedProjectSuggestion(draft) && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => patch("labelSource", "confirmed")}
                >
                  {draft.projectId
                    ? "Confirm suggested placement"
                    : "Use this identity"}
                </button>
              )}
            <label className="field">
              Project or ongoing responsibility
              <select
                aria-label="Linked project"
                value={draft.projectId || ""}
                onChange={e =>
                  setDraft(d => {
                    const project = projects.find(p => p.id === e.target.value);
                    return {
                      ...d,
                      projectId: project?.id || null,
                      ...(project && d.labelSource !== "confirmed"
                        ? {
                            role: project.role,
                            pattern: project.pattern,
                            labelSource: "suggested" as const,
                          }
                        : {}),
                      purpose: d.purpose || project?.purpose || "",
                    };
                  })
                }
              >
                <option value="">Standalone responsibility</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            {draft.projectId && (
              <p className="small">
                Desired outcome:{" "}
                {projects.find(p => p.id === draft.projectId)?.outcome ||
                  "Clarify in Projects & outcomes."}
              </p>
            )}
          </details>
          {whyFor && (
            <WhyLine
              text={whyFor(draft.projectId)}
              onRead={onRead}
              chains={whyChains?.(draft.projectId)}
              onOpenGoal={
                onOpenGoal
                  ? id => {
                      // Do not lose unsaved edits silently.
                      if (
                        JSON.stringify(draft) !== JSON.stringify(task) &&
                        !window.confirm(
                          "Leave this task without saving your changes?"
                        )
                      )
                        return;
                      onOpenGoal(id);
                    }
                  : undefined
              }
            />
          )}
          <TaskCompassFields
            compass={draft.compass}
            onChange={compass => patch("compass", compass)}
            imperatives={imperatives}
            suggestion={suggestCatchAll(draft)}
            hasProject={!!draft.projectId}
          />
          <div className="form-pair">
            <LifeAreaPicker
              areas={areas}
              value={draft.area}
              onChange={area => patch("area", area)}
            />
            <label className="field">
              Workflow
              <select
                value={draft.state}
                onChange={e => patch("state", e.target.value as TaskState)}
              >
                {STATES.filter(s => s !== "done" || task.state === "done").map(
                  s => (
                    <option key={s} value={s}>
                      {stateLabel(s)}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>
          <div className="check-line">
            <label>
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={e => patch("pinned", e.target.checked)}
              />{" "}
              Pin to attention
            </label>
          </div>
          <div className="form-pair">
            <ScheduleEditor
              task={draft}
              onChange={change => setDraft(d => ({ ...d, ...change }))}
              onSkip={() => {
                const skipped = skipOccurrence(draft);
                if (skipped) {
                  setDraft(skipped);
                  setError("");
                } else
                  setError(
                    "This was the last one in the series, so there is nothing to skip to."
                  );
              }}
            />
            {draft.schedule.flexibleWindow && (
              <div className="window-readout">
                <p className="small muted">
                  {flexibleWindowState(
                    draft.schedule.flexibleWindow,
                    adelaideClock().date
                  ) === "expired"
                    ? "Needs rescheduling. The task stays open and unchanged until you decide what to do."
                    : `Flexible window: ${describeFlexibleWindow(
                        draft.schedule.flexibleWindow,
                        adelaideClock().date
                      )}${
                        draft.schedule.minutes
                          ? ` · ${formatDuration(draft.schedule.minutes)} explicit effort`
                          : " · no effort estimate entered"
                      }`}
                </p>
                {speechSupported ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={readFlexibleWindow}
                  >
                    <Volume2 size={14} /> Read window aloud
                  </button>
                ) : (
                  <span className="small muted" role="status">
                    Read-aloud is not available in this browser.
                  </span>
                )}
              </div>
            )}
            {draft.schedule.skipped.length > task.schedule.skipped.length && (
              <p className="small muted" role="status">
                This occurrence is marked to skip in the draft. Tap Save changes
                to apply it; the repeat series will continue.
              </p>
            )}
            <label className="field">
              {draft.schedule.flexibleWindow
                ? "Hard deadline (separate from window)"
                : "Real finish-by deadline"}
              <input
                type="date"
                value={draft.deadline || ""}
                onChange={e => patch("deadline", e.target.value || null)}
              />
              {draft.schedule.flexibleWindow && (
                <span className="small muted">
                  This genuine finish-by date stays separate from availability
                  and remains unchanged unless you edit or remove it.
                </span>
              )}
            </label>
            <label className="field">
              Preparation / attention from
              <input
                aria-label="Preparation date"
                type="date"
                value={draft.preparationDate || ""}
                onChange={e =>
                  setDraft(d => ({
                    ...d,
                    preparationDate: e.target.value || null,
                    preparationSource: "confirmed",
                  }))
                }
              />
              <span className="small muted">
                {draft.preparationDate &&
                draft.preparationSource === "suggested"
                  ? "Suggested preparation, not a deadline. Confirm or change it."
                  : "A planning date, separate from the real deadline."}
              </span>
              {draft.preparationDate &&
                draft.preparationSource === "suggested" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => patch("preparationSource", "confirmed")}
                  >
                    Use this preparation date
                  </button>
                )}
            </label>
            <label className="field">
              Next review, not a deadline
              <input
                type="date"
                value={draft.reviewDate || ""}
                onChange={e => patch("reviewDate", e.target.value || null)}
              />
            </label>
            <label className="field">
              Available from
              <input
                type="date"
                value={draft.startDate || ""}
                onChange={e => patch("startDate", e.target.value || null)}
              />
            </label>
            <label className="field">
              Set aside until
              <input
                type="date"
                value={draft.deferredUntil || ""}
                onChange={e => patch("deferredUntil", e.target.value || null)}
              />
            </label>
            <label className="field">
              Minutes for this next step
              <input
                type="number"
                min={0}
                max={1440}
                value={draft.estimate}
                onChange={e => patch("estimate", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Context
              <select
                value={draft.context}
                onChange={e => patch("context", e.target.value as Context)}
              >
                <option value="anywhere">Anywhere</option>
                <option value="home">At home</option>
                <option value="computer">At computer</option>
                <option value="out">Out & about</option>
              </select>
            </label>
          </div>
          <label className="field">
            Waiting on / what would unblock this?
            <input
              value={draft.waitingFor}
              onChange={e => patch("waitingFor", e.target.value)}
              placeholder="A person, reply, part or decision."
              maxLength={500}
            />
          </label>
          <details className="detail-section">
            <summary>
              Prerequisites · {draft.dependencies.length} selected
            </summary>
            <p className="small muted">
              Incomplete prerequisites keep this out of ready starts. Finishing
              the last one releases it.
            </p>
            <div className="dependency-list">
              {tasks
                .filter(t => t.id !== task.id && t.state !== "done")
                .map(t => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={draft.dependencies.includes(t.id)}
                      onChange={e =>
                        patch(
                          "dependencies",
                          e.target.checked
                            ? [...draft.dependencies, t.id]
                            : draft.dependencies.filter(id => id !== t.id)
                        )
                      }
                    />
                    {t.title}
                    <span>{t.area}</span>
                  </label>
                ))}
              {draft.dependencies
                .filter(id => tasks.find(t => t.id === id)?.state === "done")
                .map(id => (
                  <p key={id} className="small">
                    <Check size={14} /> Completed:{" "}
                    {tasks.find(t => t.id === id)?.title}
                  </p>
                ))}
            </div>
          </details>
          <div className="field place-field">
            <label htmlFor="task-place">Place</label>
            <select
              id="task-place"
              value={draft.placeId ?? ""}
              onChange={e =>
                setDraft(d => setTaskPlace(d, e.target.value || null, places))
              }
            >
              <option value="">No place</option>
              {places.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="small muted">
              {places.length
                ? "Shown in Near me, and reminds you when you arrive while Steadier is open."
                : "Save places such as Bunnings or Work in Near me, then pick one here."}
              {onManagePlaces && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => leave(onManagePlaces)}
                  >
                    Manage places
                  </button>
                </>
              )}
            </p>
          </div>
          <details
            className="detail-section subtasks-section"
            open={children.length > 0 || !!draft.parent}
          >
            <summary>
              Subtasks
              {progress.total ? ` · ${progress.done}/${progress.total}` : ""}
            </summary>
            {children.length > 0 && (
              <ul className="subtask-list">
                {children.map(c => (
                  <li
                    key={c.id}
                    className={`subtask-row${c.state === "done" ? " is-done" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={c.state === "done"}
                      disabled={c.state === "done" || !onCompleteSubtask}
                      aria-label={
                        c.state === "done"
                          ? `${c.title} is complete`
                          : `Complete subtask ${c.title}`
                      }
                      onChange={() => onCompleteSubtask?.(c.id)}
                    />
                    <button
                      type="button"
                      className="subtask-open"
                      onClick={() => leave(() => onOpenTask?.(c))}
                      disabled={!onOpenTask}
                    >
                      <span className="subtask-title">{c.title}</span>
                      {c.parent?.suggested && (
                        <span className="suggested-chip">suggested</span>
                      )}
                    </button>
                    <TimeChips task={c} hideParent />
                    {onDeleteSubtask && (
                      <button
                        type="button"
                        className="text-button subtask-delete"
                        aria-label={`Delete subtask ${c.title}`}
                        onClick={() => setPendingDeleteSubtask(c)}
                      >
                        <Trash2 size={15} aria-hidden />
                        <span>Delete</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {onAddSubtask &&
              (canAddChild ? (
                <div className="inline-field">
                  <input
                    aria-label="New subtask"
                    value={subtaskTitle}
                    onChange={e => {
                      setSubtaskTitle(e.target.value);
                      setSubtaskError("");
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && subtaskTitle.trim()) {
                        e.preventDefault();
                        const problem = onAddSubtask(task.id, subtaskTitle);
                        if (problem) setSubtaskError(problem);
                        else setSubtaskTitle("");
                      }
                    }}
                    maxLength={500}
                    placeholder="Add a subtask"
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!subtaskTitle.trim() || task.state === "done"}
                    onClick={() => {
                      const problem = onAddSubtask(task.id, subtaskTitle);
                      if (problem) setSubtaskError(problem);
                      else setSubtaskTitle("");
                    }}
                  >
                    <Plus size={16} />
                    Add
                  </button>
                </div>
              ) : (
                <p className="small muted">
                  Subtasks can go {MAX_SUBTASK_DEPTH} levels deep, and this one
                  is at the limit.
                </p>
              ))}
            {subtaskError && (
              <p className="error" role="alert">
                {subtaskError}
              </p>
            )}
            <label className="field">
              Subtask of
              <select
                aria-label="Subtask of"
                value={draft.parent?.id ?? ""}
                onChange={e => chooseParent(e.target.value)}
              >
                <option value="">Nothing (a top-level task)</option>
                {eligibleParents.map(t => (
                  <option key={t.id} value={t.id}>
                    {"\u2014 ".repeat(depthOf(tasks, t))}
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">
              A subtask is a full task: open it to give it its own time,
              reminder or repeat. Small steps below are just ticks.
            </p>
            {(children.length > 0 || draft.parent) && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onRead(
                    [
                      spokenSubtaskContext(tasks, task),
                      ...children.map(
                        c => `${c.title}${c.state === "done" ? ", done" : ""}.`
                      ),
                    ]
                      .filter(Boolean)
                      .join(" ")
                  )
                }
              >
                <Volume2 size={14} />
                Read subtasks aloud
              </button>
            )}
          </details>
          <details className="detail-section" open={draft.checklist.length > 0}>
            <summary>
              Small steps · {draft.checklist.filter(s => s.done).length}/
              {draft.checklist.length}
            </summary>
            {draft.checklist.map(s => (
              <div className="checklist-step" key={s.id}>
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`Complete small step ${s.text}`}
                  onChange={e =>
                    patch(
                      "checklist",
                      draft.checklist.map(item =>
                        item.id === s.id
                          ? { ...item, done: e.target.checked }
                          : item
                      )
                    )
                  }
                />
                {s.text}
                {onDeleteSubtask && (
                  <button
                    type="button"
                    className="text-button subtask-delete small-step-delete"
                    aria-label={`Delete small step ${s.text}`}
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPendingDeleteStep(s);
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                    Delete
                  </button>
                )}
              </div>
            ))}
            <div className="inline-field">
              <input
                aria-label="New checklist step"
                value={step}
                onChange={e => setStep(e.target.value)}
                maxLength={500}
                placeholder="Add a small step"
              />
              <button
                type="button"
                className="button secondary"
                disabled={!step.trim()}
                onClick={() => {
                  patch("checklist", [
                    ...draft.checklist,
                    { id: crypto.randomUUID(), text: step.trim(), done: false },
                  ]);
                  setStep("");
                }}
              >
                <Plus size={16} />
                Add
              </button>
            </div>
          </details>
          <label className="field">
            Notes
            <textarea
              value={draft.notes}
              onChange={e => patch("notes", e.target.value)}
              maxLength={10000}
              rows={3}
              placeholder="Where you left things, useful details, or a link."
            />
          </label>
          <label className="field">
            What changed / evidence of progress
            <textarea
              aria-label="Responsibility progress evidence"
              value={draft.progressEvidence}
              onChange={e => patch("progressEvidence", e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="e.g. The work surface is now accessible. This is more useful than a completion count."
            />
          </label>
          <details className="detail-section">
            <summary>Activity & current state</summary>
            <p className="small">
              {stateLabel(derivedState(task, tasks))} · {deadlineLabel(task)}
            </p>
            {draft.history
              .slice()
              .reverse()
              .slice(0, 12)
              .map((h, i) => (
                <p key={i} className="small history">
                  <time dateTime={h.at}>{formatAdelaide(h.at)}</time>
                  {h.text.startsWith("Claude: ") ? (
                    <>
                      <span className="badge claude-chip">Made by Claude</span>{" "}
                      {h.text.slice("Claude: ".length)}
                    </>
                  ) : (
                    h.text
                  )}
                </p>
              ))}
          </details>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                onRead(
                  `${draft.title}. Next action: ${draft.nextAction || "Clarify the next small step."}`
                )
              }
            >
              <Volume2 size={16} />
              Read next step
            </button>
            <button
              type="button"
              className="button secondary"
              data-task-autosave-exempt
              onClick={() => leave(onClose)}
            >
              Close
            </button>
            <button
              type="submit"
              className="button primary"
              data-task-autosave-exempt
            >
              Save changes
            </button>
          </div>
        </form>
        <AlertDialog
          open={pendingDeleteSubtask !== null || pendingDeleteStep !== null}
          onOpenChange={open => {
            if (!open) {
              setPendingDeleteSubtask(null);
              setPendingDeleteStep(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingDeleteSubtask
                  ? "Delete this subtask?"
                  : "Delete this Small step?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDeleteSubtask ? (
                  <>
                    “{pendingDeleteSubtask.title}” will be removed from the
                    workspace. Any subtasks under it will move up one level,
                    and prerequisite links to it will be removed.
                  </>
                ) : (
                  <>
                    “{pendingDeleteStep?.text ?? "This Small step"}” will be
                    removed from Small steps when you save this task.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setPendingDeleteSubtask(null);
                  setPendingDeleteStep(null);
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={event => {
                  event.preventDefault();
                  if (pendingDeleteSubtask) {
                    if (onDeleteSubtask?.(pendingDeleteSubtask.id)) {
                      setPendingDeleteSubtask(null);
                    }
                    return;
                  }
                  if (pendingDeleteStep) {
                    patch(
                      "checklist",
                      removeSmallStep(draft.checklist, pendingDeleteStep.id)
                    );
                    setPendingDeleteStep(null);
                  }
                }}
              >
                {pendingDeleteSubtask ? "Delete subtask" : "Delete Small step"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
