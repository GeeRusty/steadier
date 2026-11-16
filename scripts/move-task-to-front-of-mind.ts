// One-off (2026-11-16, owner's request): move a task that was meant as an idea
// into Front of Mind, keeping its date. Guarded path: backup in the same step.
//   docker compose exec app pnpm exec tsx scripts/move-task-to-front-of-mind.ts <userId> <taskId> [--dry]
import { applyGuardedChange } from "../server/steadier/changes";
import { createProductionRepository } from "../server/steadier/repository";
import { moveTaskToFrontOfMind } from "../client/src/domain/frontOfMind";
import { adelaideTimestamp } from "../shared/time";

async function main() {
  const userId = Number(process.argv[2]);
  const taskId = process.argv[3] ?? "";
  const dry = process.argv.includes("--dry");
  if (!Number.isSafeInteger(userId) || userId <= 0 || !taskId) throw new Error("Usage: move-task-to-front-of-mind.ts <userId> <taskId> [--dry]");
  const repo = createProductionRepository();
  const stored = await repo.readWorkspace(userId);
  if (!stored) throw new Error("No workspace for that user.");
  const task = stored.workspace.tasks.find(t => t.id === taskId);
  if (!task) throw new Error("No such task.");
  const preview = moveTaskToFrontOfMind(stored.workspace, taskId, adelaideTimestamp());
  const item = preview.frontOfMind!.items.find(i => i.id === taskId)!;
  console.log(`Task “${task.title}” (created ${task.createdAt}) → Front of Mind item created ${item.createdAt}.`);
  if (dry) return;
  const applied = await applyGuardedChange(repo, userId, "owner", workspace => ({
    workspace: moveTaskToFrontOfMind(workspace, taskId, adelaideTimestamp()),
    summary: `Steadier: moved “${task.title.slice(0, 80)}” from a task to Front of Mind (owner's request)`,
    result: null,
  }));
  console.log(`Saved revision ${applied.revision}.`);
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
