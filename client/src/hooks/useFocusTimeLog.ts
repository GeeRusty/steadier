import { useEffect, useRef } from "react";
import type { FocusSession, Workspace } from "../domain/types";
import { adelaideClock, minutesToTime } from "../domain/time";
import { logTime } from "../domain/planning";

type Tracked = {
  taskId: string;
  duration: number;
  remaining: number;
  spent: number;
  firstAt: number | null;
};

/**
 * Records focus time actually counted (planned vs actual), on the device that
 * owns the running timer only. A block is written when it ends, is reset, or
 * focus moves to another task; under one minute is ignored.
 */
export function useFocusTimeLog(
  focus: FocusSession | null,
  ownsTimer: boolean,
  countAsTaskWork: boolean,
  mutate: (fn: (w: Workspace) => Workspace) => boolean
): void {
  const tracked = useRef<Tracked | null>(null);
  const write = useRef(mutate);
  write.current = mutate;

  useEffect(() => {
    const current = tracked.current;
    const sameBlock =
      !!focus &&
      !!current &&
      current.taskId === focus.taskId &&
      current.duration === focus.duration;
    if (
      current &&
      (!sameBlock || (focus && focus.remaining > current.remaining))
    ) {
      flush(current);
      tracked.current = null;
    }
    if (!focus || !countAsTaskWork) {
      if (tracked.current) {
        flush(tracked.current);
        tracked.current = null;
      }
      return;
    }
    if (!tracked.current) {
      tracked.current = {
        taskId: focus.taskId,
        duration: focus.duration,
        remaining: focus.remaining,
        spent: 0,
        firstAt: null,
      };
      return;
    }
    const t = tracked.current;
    const drop = t.remaining - focus.remaining;
    if (drop > 0 && ownsTimer) {
      t.spent += drop;
      if (t.firstAt === null) t.firstAt = Date.now() - drop * 1000;
    }
    t.remaining = focus.remaining;
    if (focus.remaining === 0) {
      flush(t);
      tracked.current = { ...t, spent: 0, firstAt: null };
    }
  }, [
    focus?.taskId,
    focus?.duration,
    focus?.remaining,
    ownsTimer,
    countAsTaskWork,
  ]);

  useEffect(
    () => () => {
      if (tracked.current) flush(tracked.current);
    },
    []
  );

  function flush(t: Tracked) {
    const minutes = Math.round(t.spent / 60);
    if (minutes < 1 || t.firstAt === null) return;
    const clock = adelaideClock(new Date(t.firstAt));
    const start = `${clock.date}T${minutesToTime(clock.minutes)}`;
    write.current(w => ({
      ...w,
      tasks: w.tasks.map(task =>
        task.id === t.taskId ? logTime(task, start, minutes, "focus") : task
      ),
    }));
    t.spent = 0;
  }
}
