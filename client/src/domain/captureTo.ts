/**
 * Capture to a project (owner-approved 2026-11-16).
 *
 * - "capture to Kingston: fix the gutter" (the colon is optional when spoken)
 *   puts that one task in Kingston.
 * - "capture to Kingston" on its own starts a session: every task and photo
 *   made with + or voice goes into Kingston until "end capture", End, or
 *   another project is chosen. The same phrase restarts it later.
 * - The project only fills in Place, exactly as choosing it in + does. Tasks
 *   still land not-ready, for Sort.
 * - The session is kept with the workspace, so the phone, the voice page and
 *   other devices all see it. It never ends on its own.
 */
import type { Project, Task, Workspace } from "./types";

export interface CaptureSession {
  projectId: string;
  /** Adelaide timestamp of when it started (or last switched). */
  startedAt: string;
}

export type CaptureCommand =
  | { kind: "end" }
  | { kind: "start"; project: Project }
  | { kind: "one"; project: Project; rest: string }
  | { kind: "ambiguous"; name: string; matches: Project[]; rest: string }
  | { kind: "nomatch"; name: string; rest: string };

const START = /^\s*capture\s+(?:to|into)\s+(.+?)\s*$/is;
const END = /^\s*(?:end|stop|finish)\s+captur(?:e|ing)\s*[.!]?\s*$/i;

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function activeProjects(projects: Project[]): Project[] {
  return projects.filter(p => p.status === "active");
}

/** Active projects whose title contains `name` as whole words. Exact titles win. */
export function matchProjects(name: string, projects: Project[]): Project[] {
  const wanted = norm(name);
  if (!wanted) return [];
  const active = activeProjects(projects);
  const exact = active.filter(p => norm(p.title) === wanted);
  if (exact.length) return exact;
  return active.filter(p => ` ${norm(p.title)} `.includes(` ${wanted} `));
}

const tidy = (text: string) => text.replace(/^[\s,;:.\-–—]+|[\s.]+$/g, "").replace(/\s{2,}/g, " ");

/**
 * Read a capture phrase. Null when the text isn't one (an ordinary capture).
 * With a colon the name is everything before it. Without one (speech), the
 * longest run of leading words that names a project is the name.
 */
export function parseCaptureCommand(text: string, projects: Project[]): CaptureCommand | null {
  if (END.test(text)) return { kind: "end" };
  const match = START.exec(text);
  if (!match) return null;
  const body = match[1];
  const colon = body.indexOf(":");
  const pick = (name: string, rest: string): CaptureCommand => {
    const found = matchProjects(name, projects);
    if (found.length === 1) return rest ? { kind: "one", project: found[0], rest } : { kind: "start", project: found[0] };
    if (found.length > 1) return { kind: "ambiguous", name: tidy(name), matches: found, rest };
    return { kind: "nomatch", name: tidy(name), rest };
  };
  if (colon >= 0) return pick(body.slice(0, colon), tidy(body.slice(colon + 1)));
  const words = body.split(/\s+/).filter(Boolean);
  for (let k = Math.min(6, words.length); k >= 1; k--) {
    const name = words.slice(0, k).join(" ");
    if (matchProjects(name, projects).length) return pick(name, tidy(words.slice(k).join(" ")));
  }
  return { kind: "nomatch", name: tidy(words.slice(0, 3).join(" ")), rest: "" };
}

export function captureSessionProject(workspace: Pick<Workspace, "captureSession" | "projects">): Project | null {
  const session = workspace.captureSession;
  if (!session) return null;
  return workspace.projects.find(p => p.id === session.projectId && p.status === "active") ?? null;
}

export function startCaptureSession(workspace: Workspace, projectId: string, at: string): Workspace {
  if (!workspace.projects.some(p => p.id === projectId && p.status === "active")) return workspace;
  if (workspace.captureSession?.projectId === projectId) return workspace;
  return { ...workspace, captureSession: { projectId, startedAt: at } };
}

export function endCaptureSession(workspace: Workspace): Workspace {
  if (!workspace.captureSession) return workspace;
  const { captureSession: _ended, ...rest } = workspace;
  return rest;
}

export function captureHistoryLine(project: Pick<Project, "title">, session: boolean): string {
  return `Captured to ${project.title}${session ? " (session)" : ""}`;
}

/** How many tasks this session put in its project (for "Capture ended. 3 tasks went to Kingston."). */
export function sessionTaskCount(workspace: Workspace): number {
  const session = workspace.captureSession;
  const project = captureSessionProject(workspace);
  if (!session || !project) return 0;
  const line = captureHistoryLine(project, true);
  const since = Date.parse(session.startedAt);
  return workspace.tasks.filter(task =>
    task.history.some(entry => entry.text === line && (!Number.isFinite(since) || Date.parse(entry.at) >= since))
  ).length;
}

export function endSpeech(projectTitle: string, count: number): string {
  return count
    ? `Capture ended. ${count} task${count === 1 ? "" : "s"} went to ${projectTitle}.`
    : `Capture ended. Nothing went to ${projectTitle}.`;
}

/**
 * Give a new task its Place: the same fields choosing the project in + sets
 * (project, its purpose, and its role and pattern as suggestions). Nothing
 * else: Action and First step stay for Sort.
 */
export function placeInProject(task: Task, project: Project, session: boolean, at: string): Task {
  return {
    ...task,
    projectId: project.id,
    purpose: task.purpose || project.purpose,
    role: task.role ?? project.role,
    pattern: task.pattern ?? project.pattern,
    labelSource: task.labelSource === "confirmed" ? "confirmed" : "suggested",
    history: [...task.history, { at, text: captureHistoryLine(project, session) }],
  };
}

// ---- Validation ----

export function validateCaptureSession(value: unknown, fail: (message: string) => never): CaptureSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("captureSession is not an object.");
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("projectId") || !keys.includes("startedAt")) fail("captureSession has unknown or missing fields.");
  if (typeof v.projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.projectId)) fail("captureSession projectId is not valid.");
  if (typeof v.startedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.startedAt) || !Number.isFinite(Date.parse(v.startedAt)))
    fail("captureSession startedAt must be a timestamp.");
  return { projectId: v.projectId as string, startedAt: v.startedAt as string };
}
