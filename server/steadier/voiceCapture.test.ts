import express from "express";
import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "../../client/src/domain/compass";
import { emptyProjectSchedule } from "../../client/src/domain/time";
import type { Project, Workspace } from "../../client/src/domain/types";
import type { CommitWithBackupInput, WorkspaceChangeRepository } from "./changes";
import type { StoredWorkspace } from "./service";
import { emptyWorkspace } from "./validation";
import { registerVoiceRoutes, type VoiceIntent } from "./voice";

const AT = "2026-11-16T10:00:00+10:30";
const kingston: Project = {
  id: "p-king",
  title: "Kingston shack",
  purpose: "Keep the shack sound.",
  outcome: "",
  role: "support",
  pattern: "sustained",
  status: "active",
  milestones: [],
  progress: [],
  createdAt: AT,
  updatedAt: AT,
  schedule: emptyProjectSchedule(),
  compass: emptyProjectCompass(),
};

class FakeChanges implements WorkspaceChangeRepository {
  stored: StoredWorkspace;
  constructor(workspace: Workspace) {
    this.stored = { userId: 1, workspace, revision: 1, updatedAt: AT, timeZone: "Australia/Adelaide", focusOwnerClientId: null };
  }
  async readWorkspace() {
    return structuredClone(this.stored);
  }
  async commitWithBackup(input: CommitWithBackupInput) {
    if (input.baseRevision !== this.stored.revision) return false;
    this.stored = { ...this.stored, workspace: input.workspace, revision: this.stored.revision + 1 };
    return true;
  }
  async listWorkspaceBackups() {
    return [];
  }
  async readWorkspaceBackup() {
    return null;
  }
  async listPendingDeletes() {
    return [];
  }
  async findPendingDelete() {
    return null;
  }
}

const tasksIntent = (titles: string[]): VoiceIntent => ({
  intent: "add_tasks",
  tasks: titles.map(title => ({ title, date: null, time: null, minutes: null, remind_minutes_before: null })),
  task_id: null,
  new_date: null,
  new_time: null,
  new_minutes: null,
  shopping_list: null,
  shopping_items: [],
  idea_title: null,
  idea_note: null,
  note_text: null,
  note_date: null,
  help_question: null,
  clarify: null,
});

async function serve(changes: FakeChanges, heard: string[]) {
  const app = express();
  app.use(express.json());
  registerVoiceRoutes(app, {
    changes,
    interpret: async message => {
      const said = JSON.parse(/They said: (.*)$/m.exec(message)![1]) as string;
      heard.push(said);
      return tasksIntent(said.split(/, and | and /));
    },
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, close: () => server.close() };
}

describe("capture to a project by voice", () => {
  it("starts a session, sends tasks to it after yes, and ends with a count", async () => {
    const w = emptyWorkspace();
    w.projects = [kingston];
    const changes = new FakeChanges(w);
    const heard: string[] = [];
    const { vi } = await import("vitest");
    const sdkModule = await import("../_core/sdk");
    const spy = vi.spyOn(sdkModule.sdk, "authenticateRequest").mockResolvedValue({ id: 1 } as never);
    const { base, close } = await serve(changes, heard);
    const say = async (text: string, draft: unknown = null) =>
      (await (await fetch(`${base}/api/voice/interpret`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, draft }) })).json()) as {
        kind: string;
        speech: string;
        session: string | null;
        proposal?: unknown;
      };
    try {
      const started = await say("capture to Kingston");
      expect(started.speech).toBe("Capturing to Kingston shack. Say end capture when you're done.");
      expect(started.session).toBe("Kingston shack");
      expect(changes.stored.workspace.captureSession?.projectId).toBe("p-king");

      const asked = await say("fix the gutter, and check the roof screws");
      expect(asked.kind).toBe("confirm");
      expect(asked.speech).toMatch(/^2 tasks for Kingston shack: /);
      // Nothing saved before yes.
      expect(changes.stored.workspace.tasks).toHaveLength(0);
      const saved = await fetch(`${base}/api/voice/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal: asked.proposal }),
      });
      expect(saved.status).toBe(200);
      const tasks = changes.stored.workspace.tasks;
      expect(tasks.map(t => t.projectId)).toEqual(["p-king", "p-king"]);
      expect(tasks.every(t => t.state === "inbox")).toBe(true);
      expect(tasks[0].history.map(h => h.text)).toContain("Captured to Kingston shack (session)");

      const ended = await say("end capture");
      expect(ended.speech).toBe("Capture ended. 2 tasks went to Kingston shack.");
      expect(changes.stored.workspace.captureSession).toBeUndefined();

      const one = await say("capture to Kingston fix the downpipe");
      expect(heard.at(-1)).toBe("fix the downpipe");
      expect(one.speech).toBe("Add fix the downpipe, for Kingston shack. Save it?");
      expect(changes.stored.workspace.captureSession).toBeUndefined();

      const missing = await say("capture to Narnia");
      expect(missing.speech).toMatch(/no project called Narnia/);
    } finally {
      close();
      spy.mockRestore();
    }
  });
});
