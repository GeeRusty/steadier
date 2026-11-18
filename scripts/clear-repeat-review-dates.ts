// One-off (2026-11-18, owner-approved): clear "Next review" on open repeating
// tasks, so they stop showing "review due". Each gets a history line. Written
// through the guarded path (backup in the same transaction).
//   docker compose exec app pnpm exec tsx scripts/clear-repeat-review-dates.ts <userId> [--dry]
import { applyGuardedChange } from "../server/steadier/changes";
import { createProductionRepository } from "../server/steadier/repository";
import { clearRepeatReviewDates, openRepeatsWithReview } from "../client/src/domain/repeatReview";
import { adelaideTimestamp } from "../shared/time";

async function main() {
  const userId = Number(process.argv[2]);
  const dry = process.argv.includes("--dry");
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Usage: clear-repeat-review-dates.ts <userId> [--dry]");
  const repo = createProductionRepository();
  const stored = await repo.readWorkspace(userId);
  if (!stored) throw new Error("No workspace for that user.");
  const found = openRepeatsWithReview(stored.workspace.tasks);
  for (const t of found) console.log(`- ${t.title} (review ${t.reviewDate})`);
  console.log(`${found.length} open repeat(s) to clear.`);
  if (dry || !found.length) return;
  const stamp = adelaideTimestamp();
  const applied = await applyGuardedChange(repo, userId, "owner", workspace => {
    const { workspace: next, cleared } = clearRepeatReviewDates(workspace, stamp);
    return { workspace: next, summary: `Steadier: Next review cleared on ${cleared.length} repeating task(s)`, result: cleared.length };
  });
  console.log(`Saved revision ${applied.revision}.`);
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
