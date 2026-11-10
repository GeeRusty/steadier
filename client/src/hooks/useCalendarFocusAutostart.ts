import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  calendarFocusStartDecision,
  dueCalendarFocusStarts,
} from "../domain/calendarAutoStart";
import { derivedState } from "../domain/engine";
import { adelaideClock } from "../domain/time";
import type { FocusSession, Project, Task } from "../domain/types";
import { systemNotify } from "./useReminders";

const STORAGE_KEY = "steadier.calendar-focus-starts.v1";
const MAX_SAVED_KEYS = 256;
const CHECK_INTERVAL_MS = 15_000;

export interface CalendarFocusAutostartOptions {
  tasks: Task[];
  projects: Project[];
  focus: FocusSession | null;
  enabled: boolean;
  canStart: boolean;
  remoteFocus: boolean;
  onStart: (task: Task, durationMinutes: number) => boolean;
}

function readHandledKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

function persistHandledKeys(keys: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    const retained = [...keys].slice(-MAX_SAVED_KEYS);
    keys.clear();
    retained.forEach(key => keys.add(key));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
  } catch {
    // The focus session itself remains protected by the shared workspace CAS.
  }
}

/**
 * Starts a booked timed Calendar task at its Adelaide start when the app is
 * open. It waits rather than replacing another timer and persists only a small
 * local set of handled occurrence keys to avoid restarting after a reload.
 */
export function useCalendarFocusAutostart(
  options: CalendarFocusAutostartOptions
): void {
  const latest = useRef(options);
  latest.current = options;
  const handled = useRef<Set<string> | null>(null);
  if (!handled.current) handled.current = readHandledKeys();
  const notices = useRef(new Set<string>());

  useEffect(() => {
    const check = () => {
      const state = latest.current;
      if (!state.enabled) return;
      const clock = adelaideClock();
      const candidates = dueCalendarFocusStarts(
        state.tasks,
        state.projects,
        clock.date,
        clock.minutes,
        handled.current ?? undefined
      );
      const candidate = candidates[0];
      if (!candidate) return;
      const task = state.tasks.find(item => item.id === candidate.taskId);
      if (!task) return;

      const notifyOnce = (message: string, error = false) => {
        if (notices.current.has(candidate.key)) return;
        notices.current.add(candidate.key);
        const text = `${task.title}: ${message}`;
        if (error) toast.error(text);
        else toast(text);
        if (document.visibilityState === "hidden")
          void systemNotify("Steadier scheduled focus", text);
      };

      const decision = calendarFocusStartDecision(
        task.id,
        state.focus,
        state.remoteFocus,
        state.canStart,
        derivedState(task, state.tasks) === "ready"
      );
      // If the owner already started this same task, never reset its timer.
      if (decision === "already-active") {
        handled.current?.add(candidate.key);
        persistHandledKeys(handled.current!);
        return;
      }
      if (decision === "wait-for-remote-focus") {
        notifyOnce("Focus is active on another device; that session was left unchanged.");
        return;
      }
      if (decision === "wait-for-current-focus") {
        notifyOnce("another Focus timer is active, so it was left unchanged.");
        return;
      }
      if (decision === "task-not-ready") {
        notifyOnce("is not ready to start, so no timer was started. Open the task to review it.", true);
        return;
      }
      if (decision === "focus-unavailable") {
        notifyOnce("could not start because this workspace is still syncing. The task was not changed.", true);
        return;
      }
      if (!state.onStart(task, candidate.durationMinutes)) {
        notifyOnce("could not start automatically. Check sync; the task was not changed.", true);
        return;
      }

      handled.current?.add(candidate.key);
      persistHandledKeys(handled.current!);
      const text = `Started the booked timer for ${task.title}.`;
      toast.success(text);
      if (document.visibilityState === "hidden")
        void systemNotify("Steadier timer started", text);
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
