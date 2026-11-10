import { randomUUID } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { getDb, upsertUser, getUserByOpenId } from "../server/db";
import { sdk } from "../server/_core/sdk";
import { createTask, today } from "../client/src/domain/engine";
import { makeSampleProjects } from "../client/src/domain/life";
import type { Workspace } from "../client/src/domain/types";

const identities = [];
for (const suffix of ["a", "b"]) {
  const openId = `steadier-test-${randomUUID().slice(0,20)}-${suffix}`;
  await upsertUser({ openId, name: `Synthetic Steadier check ${suffix}`, loginMethod: "synthetic-test", role: "user" });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("Synthetic test identity was not persisted");
  const cookie = await sdk.createSessionToken(openId, { name: user.name || "", expiresInMs: 60 * 60 * 1000 });
  identities.push({ id: user.id, name: user.name, cookie });
}
const task = createTask({ title: "Synthetic licence renewal", area: "Vehicles", nextAction: "Find the existing notice.", deadline: today(), role: "support", pattern: "timely", labelSource: "confirmed" });
const sample = makeSampleProjects([task], today());
const workspace:Workspace = { version:2, tasks:sample.tasks, projects:sample.projects, focus:null, intention:null, matrixWeights:{"direction-timely":1,"direction-sustained":1,"support-timely":1,"support-sustained":1}, trial:{startedAt:new Date().toISOString(),lastExportAt:null,lastReviewAt:null} };
await mkdir(".webdev", { recursive:true });
await writeFile(".webdev/server-test-fixtures.json", JSON.stringify({ identities, workspace }, null, 2)+"\n");
await chmod(".webdev/server-test-fixtures.json", 0o600);
const db = await getDb();
await (db as unknown as { $client?: { end:()=>Promise<void> } })?.$client?.end();
console.log("Synthetic server check fixtures prepared in a private ignored file; no owner records imported.");
