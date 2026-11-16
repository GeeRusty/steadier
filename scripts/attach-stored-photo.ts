// One-off (owner's request): put a photo that is stored on the server, but
// never reached its task, onto that task. Guarded path: backup in the same step.
//   docker compose exec app pnpm exec tsx scripts/attach-stored-photo.ts <userId> <taskId> <hash> <before|after|none> <addedAt> [--dry]
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { applyGuardedChange } from "../server/steadier/changes";
import { createProductionRepository } from "../server/steadier/repository";
import { photoPath, photoDir } from "../server/steadier/photos";
import { addPhoto, newPhotoId, type TaskPhoto } from "../client/src/domain/photos";

async function main() {
  const [userArg, taskId, hash, labelArg, addedAt] = process.argv.slice(2);
  const dry = process.argv.includes("--dry");
  const userId = Number(userArg);
  if (!Number.isSafeInteger(userId) || !taskId || !hash || !labelArg || !addedAt) throw new Error("Usage: see the top of this file.");
  const file = photoPath(photoDir(), userId, hash);
  const bytes = (await fs.stat(file)).size;
  const meta = await sharp(file).metadata();
  const photo: TaskPhoto = {
    id: newPhotoId(),
    hash,
    addedAt,
    label: labelArg === "none" ? null : (labelArg as "before" | "after"),
    width: meta.width!,
    height: meta.height!,
    bytes,
    markup: [],
  };
  const repo = createProductionRepository();
  const stored = await repo.readWorkspace(userId);
  const task = stored?.workspace.tasks.find(t => t.id === taskId);
  if (!task) throw new Error("No such task.");
  if (task.photos?.some(p => p.hash === hash)) throw new Error("That photo is already on the task.");
  console.log(`Attach ${hash.slice(0, 12)} (${photo.width}×${photo.height}, ${bytes} bytes, ${photo.label ?? "no label"}) to “${task.title}”.`);
  if (dry) return;
  const applied = await applyGuardedChange(repo, userId, "owner", workspace => ({
    workspace: addPhoto(workspace, taskId, photo, addedAt),
    summary: `Steadier: attached the 14:52 photo to “${task.title.slice(0, 80)}” (owner's request)`,
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
