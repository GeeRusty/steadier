// One-off (2026-11-14): save each workspace once with Front of Mind, so the
// ideas leave the stored task list. Reading a saved workspace already moves
// ideas into Front of Mind; this only writes that result, through the guarded
// path (backup in the same transaction).
//   docker compose exec app pnpm exec tsx scripts/migrate-front-of-mind.ts <userId> [--dry]
import { applyGuardedChange } from "../server/steadier/changes";
import { createProductionRepository } from "../server/steadier/repository";
import { letGoItems, openItems } from "../client/src/domain/frontOfMind";

async function main() {
  const userId = Number(process.argv[2]);
  const dry = process.argv.includes("--dry");
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Usage: migrate-front-of-mind.ts <userId> [--dry]");
  const repo = createProductionRepository();
  const stored = await repo.readWorkspace(userId);
  if (!stored) throw new Error("No workspace for that user.");
  const w = stored.workspace;
  console.log(
    `After the move (as read): ${w.tasks.length} tasks, ${w.tasks.filter(t => t.state === "someday").length} someday tasks; Front of Mind ${openItems(w).length} open, ${letGoItems(w).length} let go.`
  );
  if (dry) return;
  const applied = await applyGuardedChange(repo, userId, "owner", workspace => ({
    workspace,
    summary: "Steadier: Ideas shelf moved into Front of Mind",
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
