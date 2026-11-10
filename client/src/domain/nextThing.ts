import type { Workspace } from "./types";

/** Clear only the selected Next Thing pointer for a task that no longer exists or is complete. */
export function clearNextThingForTask(
  workspace: Workspace,
  taskId: string
): Workspace {
  return workspace.nextThing?.taskId === taskId
    ? { ...workspace, nextThing: null }
    : workspace;
}
