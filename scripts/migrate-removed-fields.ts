// One-off (2026-11-12): save each workspace once in the new shape, so the
// removed Area and Important fields leave the stored data. Reading a saved
// workspace already moves a chosen Area into the notes; this only writes that
// result, through the guarded path (backup in the same transaction).
//   docker compose exec app pnpm exec tsx scripts/migrate-removed-fields.ts <userId> [--dry]
import { applyGuardedChange } from "../server/steadier/changes";
import { createProductionRepository } from "../server/steadier/repository";

async function main() {
  const userId = Number(process.argv[2]);
  const dry = process.argv.includes("--dry");
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Usage: migrate-removed-fields.ts <userId> [--dry]");
  const repo = createProductionRepository();
  const stored = await repo.readWorkspace(userId);
  if (!stored) throw new Error("No workspace for that user.");
  const moved = stored.workspace.tasks.filter(t => /Area “.+” moved into the notes/.test(t.history.at(-1)?.text ?? ""));
  console.log(`${stored.workspace.tasks.length} tasks; ${moved.length} get an Area line in their notes.`);
  if (dry) return;
  const applied = await applyGuardedChange(repo, userId, "owner", workspace => ({
    workspace,
    summary: "Steadier: Area and Important removed; chosen Areas moved into task notes",
    result: moved.length,
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
