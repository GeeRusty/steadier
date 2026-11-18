/**
 * One-off clean-up (owner, 18 Nov 2026): open repeating tasks had "Next review"
 * set to their occurrence date, so they showed "review due". Repeats no longer
 * get one; this clears the ones already saved, with a history line each.
 */
import type { Task, Workspace } from "./types";

export const REPEAT_REVIEW_CLEARED = "Next review cleared: repeats don't get one.";

export function openRepeatsWithReview(tasks: Task[]): Task[] {
  return tasks.filter(t => t.state !== "done" && !!t.schedule.repeat && !!t.reviewDate);
}

export function clearRepeatReviewDates(workspace: Workspace, stamp: string): { workspace: Workspace; cleared: Task[] } {
  const ids = new Set(openRepeatsWithReview(workspace.tasks).map(t => t.id));
  const cleared: Task[] = [];
  const tasks = workspace.tasks.map(t => {
    if (!ids.has(t.id)) return t;
    const next: Task = {
      ...t,
      reviewDate: null,
      updatedAt: stamp,
      history: [...t.history, { at: stamp, text: REPEAT_REVIEW_CLEARED }].slice(-1000),
    };
    cleared.push(next);
    return next;
  });
  return { workspace: { ...workspace, tasks }, cleared };
}
