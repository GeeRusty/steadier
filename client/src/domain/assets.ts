import type {
  Asset,
  AssetCondition,
  AssetLogEntry,
  AssetLogKind,
  AssetMeterUnit,
  AssetReading,
  AssetRevisit,
  AssetServicePlan,
  AssetType,
  LegacyAsset,
  LegacyAssetCondition,
  Workspace,
} from "./types";

// ---------------------------------------------------------------------------
// Limits, labels, ids

export const MAX_ASSETS = 300;
export const MAX_ASSET_LOGS_PER_ASSET = 500;
export const MAX_ASSET_LOGS_TOTAL = 5000;
export const MAX_ASSET_READINGS = 1000;
export const MAX_ASSET_PLANS = 30;
export const MAX_ASSET_REVISITS = 30;
export const MAX_ASSET_DOCUMENTS = 20;
export const MAX_ASSET_NAME_LENGTH = 120;
export const MAX_ASSET_TEXT = 120;
export const MAX_ASSET_NOTES = 2000;
/** Due from this many days before the date. */
export const DUE_SOON_DAYS = 14;
/** Due from this far before the meter point. */
export const METER_SOON: Record<AssetMeterUnit, number> = { km: 500, h: 10 };
/** A vehicle or equipment meter reading older than this asks for a new one. */
export const READING_STALE_DAYS = 60;

export const ASSET_TYPES: readonly AssetType[] = ["vehicle", "place", "equipment", "appliance"];
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  vehicle: "Vehicle",
  place: "Place",
  equipment: "Equipment",
  appliance: "Appliance",
};
export const ASSET_TYPE_GROUP: Record<AssetType, [string, string]> = {
  vehicle: ["Vehicle", "Vehicles"],
  place: ["Place", "Places"],
  equipment: ["Equipment", "Equipment"],
  appliance: ["Appliance", "Appliances"],
};
export const ASSET_CONDITIONS: readonly AssetCondition[] = ["unchecked", "good", "fair", "poor", "needs-attention"];
export const CONDITION_LABEL: Record<AssetCondition, string> = {
  unchecked: "Not yet checked",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  "needs-attention": "Needs attention",
};
export const LOG_KINDS: readonly AssetLogKind[] = ["service", "repair", "inspection", "note"];
export const LOG_KIND_LABEL: Record<AssetLogKind, string> = {
  service: "Service",
  repair: "Repair",
  inspection: "Inspection",
  note: "Note",
};
export const METER_UNITS: readonly AssetMeterUnit[] = ["km", "h"];
export const METER_LABEL: Record<AssetMeterUnit, string> = { km: "Odometer", h: "Engine hours" };

export const ASSETS_INFO = "Physical things you look after: vehicles, places, equipment and appliances.";
export const ASSETS_INFO_MORE =
  "Each can have a meter, service plans and revisits. When a service or revisit comes due it shows once in Needs attention as Upkeep due, and in the Weekly Review; nothing else reminds you. Registration and insurance stay in Obligations and show here when linked to the asset.";

function idToken(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export const newAssetId = () => `asset-${idToken()}`;
export const newAssetLogId = () => `asset-log-${idToken()}`;
export const newAssetReadingId = () => `asset-reading-${idToken()}`;
export const newAssetPlanId = () => `asset-plan-${idToken()}`;
export const newAssetRevisitId = () => `asset-revisit-${idToken()}`;

// ---------------------------------------------------------------------------
// Dates and money

function utc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDaysTo(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}
/** Calendar months, clamped to the month's last day (31 Jan + 1 = 28/29 Feb). */
export function addMonthsTo(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(ny, nm, Math.min(d, last), 12)));
}
function daysFrom(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Dec", or "2 Dec 2027" outside today's year. */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? "" : ` ${y}`}`;
}
export function meterText(value: number, unit: AssetMeterUnit): string {
  return `${Math.round(value).toLocaleString("en-AU")} ${unit}`;
}
/** "$1,180" or "$48.50". */
export function moneyText(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-AU", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
/** "48", "$48.50", "1,180" → cents; "" → null; anything else → undefined. */
export function parseMoney(text: string): number | null | undefined {
  const clean = text.replace(/[$,\s]/g, "");
  if (!clean) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(clean)) return undefined;
  return Math.round(Number(clean) * 100);
}
/** "61240", "61,240" → 61240; "" → null; anything else → undefined. */
export function parseMeter(text: string): number | null | undefined {
  const clean = text.replace(/[,\s]/g, "").replace(/(km|h)$/i, "");
  if (!clean) return null;
  if (!/^\d{1,9}(\.\d)?$/.test(clean)) return undefined;
  return Number(clean);
}

// ---------------------------------------------------------------------------
// Reading the store

export function assetsOf(workspace: Workspace): Asset[] {
  return workspace.assets ?? [];
}
export function findAsset(workspace: Workspace, id: string): Asset | null {
  return assetsOf(workspace).find(a => a.id === id) ?? null;
}
/** Assets at a place (one level). */
export function heldBy(workspace: Workspace, placeId: string): Asset[] {
  return assetsOf(workspace).filter(a => a.placeId === placeId);
}
export function obligationsFor(workspace: Workspace, assetId: string) {
  return (workspace.obligations ?? []).filter(o => o.assetId === assetId && o.status !== "paid");
}
export function usesMeter(asset: Pick<Asset, "type">): boolean {
  return asset.type === "vehicle" || asset.type === "equipment";
}

/** Latest reading from readings and log entries (date, then the higher value). */
export function lastReading(asset: Asset): { value: number; date: string } | null {
  const all: { value: number; date: string }[] = [
    ...asset.readings.map(r => ({ value: r.value, date: r.date })),
    ...asset.logs.filter(l => l.reading !== null).map(l => ({ value: l.reading as number, date: l.date })),
  ];
  all.sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value);
  return all[0] ?? null;
}

function sortedLogs(logs: AssetLogEntry[]): AssetLogEntry[] {
  return [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
export function lastService(asset: Asset): AssetLogEntry | null {
  return sortedLogs(asset.logs).find(l => l.kind === "service") ?? null;
}

export type DueState = "not-started" | "ok" | "due" | "overdue";
export interface PlanStatus {
  last: { date: string; reading: number | null } | null;
  nextDate: string | null;
  nextMeter: number | null;
  state: DueState;
}

export function planStatus(asset: Asset, plan: AssetServicePlan, today: string): PlanStatus {
  const logged = sortedLogs(asset.logs).find(l => l.kind === "service" && l.planId === plan.id);
  const last = logged
    ? { date: logged.date, reading: logged.reading }
    : plan.startDate || plan.startReading !== null
      ? { date: plan.startDate ?? "", reading: plan.startReading }
      : null;
  const nextDate = last?.date && plan.everyMonths ? addMonthsTo(last.date, plan.everyMonths) : null;
  const nextMeter = plan.everyMeter && last?.reading != null && asset.meter ? last.reading + plan.everyMeter : null;
  if (!nextDate && nextMeter === null) return { last: last?.date || last?.reading != null ? last : null, nextDate, nextMeter, state: "not-started" };
  const current = lastReading(asset);
  const overdue =
    (nextDate !== null && today > nextDate) || (nextMeter !== null && current !== null && current.value > nextMeter);
  const due =
    (nextDate !== null && today >= addDaysTo(nextDate, -DUE_SOON_DAYS)) ||
    (nextMeter !== null && current !== null && asset.meter !== null && current.value >= nextMeter - METER_SOON[asset.meter]);
  return { last, nextDate, nextMeter, state: overdue ? "overdue" : due ? "due" : "ok" };
}

export function revisitState(revisit: AssetRevisit, today: string): DueState {
  if (today > revisit.by) return "overdue";
  if (today >= addDaysTo(revisit.by, -DUE_SOON_DAYS)) return "due";
  return "ok";
}

export function readingStale(asset: Asset, today: string): boolean {
  if (asset.status !== "active" || !asset.meter || !usesMeter(asset)) return false;
  const last = lastReading(asset);
  return !last || daysFrom(last.date, today) > READING_STALE_DAYS;
}

/** "by 2 Dec or 63,900 km" */
export function planNextText(asset: Asset, s: PlanStatus, today: string): string {
  const parts = [
    s.nextDate ? shortDate(s.nextDate, today) : null,
    s.nextMeter !== null && asset.meter ? meterText(s.nextMeter, asset.meter) : null,
  ].filter(Boolean);
  return parts.length ? `by ${parts.join(" or ")}` : "";
}

export function planEveryText(plan: AssetServicePlan, unit: AssetMeterUnit | null): string {
  const months = plan.everyMonths ? `${plan.everyMonths} month${plan.everyMonths === 1 ? "" : "s"}` : null;
  const meter = plan.everyMeter && unit ? meterText(plan.everyMeter, unit) : null;
  if (months && meter) return `Every ${months} or ${meter}, whichever comes first`;
  return `Every ${months ?? meter ?? "—"}`;
}

export interface UpkeepItem {
  key: string;
  assetId: string;
  assetName: string;
  kind: "service" | "revisit" | "reading";
  /** plan or revisit id; null for a reading. */
  refId: string | null;
  what: string;
  detail: string;
  overdue: boolean;
  dueDate: string | null;
  taskId: string | null;
  listTemplateId: string | null;
}

/** Everything due or overdue across active assets: services, revisits, stale readings. */
export function upkeepDue(workspace: Workspace, today: string): UpkeepItem[] {
  const out: UpkeepItem[] = [];
  for (const asset of assetsOf(workspace)) {
    if (asset.status !== "active") continue;
    const now = lastReading(asset);
    for (const plan of asset.plans) {
      const s = planStatus(asset, plan, today);
      if (s.state !== "due" && s.state !== "overdue") continue;
      const next = planNextText(asset, s, today);
      const reading = s.nextMeter !== null && now && asset.meter ? ` (now ${meterText(now.value, asset.meter)})` : "";
      out.push({
        key: `plan:${asset.id}:${plan.id}`,
        assetId: asset.id,
        assetName: asset.name,
        kind: "service",
        refId: plan.id,
        what: plan.name,
        detail: `${s.state === "overdue" ? "overdue · " : ""}${next}${reading}`,
        overdue: s.state === "overdue",
        dueDate: s.nextDate,
        taskId: plan.taskId,
        listTemplateId: plan.listTemplateId,
      });
    }
    for (const revisit of asset.revisits) {
      const state = revisitState(revisit, today);
      if (state === "ok") continue;
      out.push({
        key: `revisit:${asset.id}:${revisit.id}`,
        assetId: asset.id,
        assetName: asset.name,
        kind: "revisit",
        refId: revisit.id,
        what: revisit.what,
        detail: `${state === "overdue" ? "overdue · " : ""}revisit by ${shortDate(revisit.by, today)}`,
        overdue: state === "overdue",
        dueDate: revisit.by,
        taskId: revisit.taskId,
        listTemplateId: null,
      });
    }
    if (readingStale(asset, today)) {
      const last = lastReading(asset);
      out.push({
        key: `reading:${asset.id}`,
        assetId: asset.id,
        assetName: asset.name,
        kind: "reading",
        refId: null,
        what: "Update reading",
        detail: last && asset.meter ? `last ${meterText(last.value, asset.meter)} on ${shortDate(last.date, today)}` : "no reading yet",
        overdue: false,
        dueDate: null,
        taskId: null,
        listTemplateId: null,
      });
    }
  }
  return out;
}

/** Soonest next plan or revisit for the card: "Major service · by 2 Dec or 63,900 km". */
export function nextDueText(asset: Asset, today: string): string | null {
  const options: { sort: string; text: string }[] = [];
  for (const plan of asset.plans) {
    const s = planStatus(asset, plan, today);
    if (s.state === "not-started") continue;
    const sort = s.state === "overdue" || s.state === "due" ? "0" : s.nextDate ?? "9999-12-31";
    options.push({ sort, text: `${plan.name} · ${planNextText(asset, s, today)}` });
  }
  for (const r of asset.revisits) {
    options.push({ sort: revisitState(r, today) === "ok" ? r.by : "0", text: `${r.what} · by ${shortDate(r.by, today)}` });
  }
  options.sort((a, b) => a.sort.localeCompare(b.sort));
  return options[0]?.text ?? null;
}

/** One due chip for the card (never more), or null. */
export function dueChip(asset: Asset, today: string): string | null {
  if (asset.status !== "active") return null;
  const plans = asset.plans.map(p => planStatus(asset, p, today).state);
  const revisits = asset.revisits.map(r => revisitState(r, today));
  if (plans.includes("overdue")) return "service overdue";
  if (plans.includes("due")) return "service due";
  if (revisits.includes("overdue")) return "revisit overdue";
  if (revisits.includes("due")) return "revisit due";
  if (readingStale(asset, today)) return "reading due";
  return null;
}

/**
 * Title for the Create task draft. The date is written with its year, so the
 * capture reader can't roll it into next year; an overdue item gets today.
 */
export function upkeepDraftTitle(assetName: string, item: Pick<UpkeepItem, "what" | "dueDate" | "overdue">, today: string): string {
  const base = `${assetName}: ${item.what}`;
  if (!item.dueDate) return base;
  const date = item.overdue || item.dueDate < today ? today : item.dueDate;
  const [y, m, d] = date.split("-").map(Number);
  return `${base} by ${d} ${MONTHS[m - 1]} ${y}`;
}

/** The upkeep item a task was created for (service plan or revisit), if any. */
export function upkeepForTask(workspace: Workspace, taskId: string) {
  for (const asset of assetsOf(workspace)) {
    if (asset.status !== "active") continue;
    const plan = asset.plans.find(p => p.taskId === taskId);
    if (plan) return { asset, kind: "service" as const, refId: plan.id, what: plan.name };
    const revisit = asset.revisits.find(r => r.taskId === taskId);
    if (revisit) return { asset, kind: "revisit" as const, refId: revisit.id, what: revisit.what };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Changes (each returns the same workspace when nothing valid changed)

function withAssets(workspace: Workspace, assets: Asset[]): Workspace {
  return { ...workspace, assets };
}
function withAsset(workspace: Workspace, assetId: string, update: (a: Asset) => Asset): Workspace {
  let changed = false;
  const next = assetsOf(workspace).map(a => {
    if (a.id !== assetId) return a;
    const u = update(a);
    changed ||= u !== a;
    return u;
  });
  return changed ? withAssets(workspace, next) : workspace;
}
function totalLogs(workspace: Workspace): number {
  return assetsOf(workspace).reduce((n, a) => n + a.logs.length, 0);
}

export function newAsset(id: string, name: string, type: AssetType, at: string, extra: Partial<Asset> = {}): Asset {
  return {
    id,
    name: name.trim(),
    type,
    condition: "unchecked",
    status: "active",
    make: "",
    model: "",
    serial: "",
    purchaseDate: null,
    purchasePrice: null,
    warrantyEnd: null,
    documents: [],
    pillarId: null,
    projectId: null,
    placeId: null,
    meter: type === "vehicle" ? "km" : null,
    readings: [],
    plans: [],
    revisits: [],
    logs: [],
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

function placeOk(workspace: Workspace, assetId: string, placeId: string | null, type: AssetType): boolean {
  if (placeId === null) return true;
  if (type === "place" || placeId === assetId) return false;
  return assetsOf(workspace).some(a => a.id === placeId && a.type === "place");
}

export function addAsset(workspace: Workspace, asset: Asset): Workspace {
  const assets = assetsOf(workspace);
  if (
    assets.length >= MAX_ASSETS ||
    assets.some(a => a.id === asset.id) ||
    !asset.name.trim() ||
    asset.name.length > MAX_ASSET_NAME_LENGTH ||
    !placeOk(workspace, asset.id, asset.placeId, asset.type)
  )
    return workspace;
  return withAssets(workspace, [...assets, asset]);
}

export type AssetDetails = Pick<
  Asset,
  | "name"
  | "type"
  | "make"
  | "model"
  | "serial"
  | "purchaseDate"
  | "purchasePrice"
  | "warrantyEnd"
  | "documents"
  | "pillarId"
  | "projectId"
  | "placeId"
  | "meter"
>;

export function editAsset(workspace: Workspace, assetId: string, patch: Partial<AssetDetails>, at: string): Workspace {
  const current = findAsset(workspace, assetId);
  if (!current) return workspace;
  const next = { ...current, ...patch, name: (patch.name ?? current.name).trim() };
  if (!next.name || next.name.length > MAX_ASSET_NAME_LENGTH) return workspace;
  if (!placeOk(workspace, assetId, next.placeId, next.type)) return workspace;
  if (next.documents.length > MAX_ASSET_DOCUMENTS) return workspace;
  let out = withAsset(workspace, assetId, () => ({ ...next, updatedAt: at }));
  // A place that stops being a place no longer holds anything.
  if (current.type === "place" && next.type !== "place") {
    out = withAssets(out, assetsOf(out).map(a => (a.placeId === assetId ? { ...a, placeId: null, updatedAt: at } : a)));
  }
  return out;
}

export function setCondition(workspace: Workspace, assetId: string, condition: AssetCondition, at: string): Workspace {
  return withAsset(workspace, assetId, a => (a.condition === condition ? a : { ...a, condition, updatedAt: at }));
}

/** Retire or bring back. `alsoHeld` retires (or restores) what a place holds too. */
export function setAssetStatus(
  workspace: Workspace,
  assetId: string,
  status: Asset["status"],
  at: string,
  alsoHeld = false
): Workspace {
  return withAssets(
    workspace,
    assetsOf(workspace).map(a =>
      (a.id === assetId || (alsoHeld && a.placeId === assetId)) && a.status !== status ? { ...a, status, updatedAt: at } : a
    )
  );
}

export function removeAsset(workspace: Workspace, assetId: string, at: string): Workspace {
  const assets = assetsOf(workspace);
  if (!assets.some(a => a.id === assetId)) return workspace;
  const next = assets
    .filter(a => a.id !== assetId)
    .map(a => (a.placeId === assetId ? { ...a, placeId: null, updatedAt: at } : a));
  const obligations = workspace.obligations?.map(o => {
    if (o.assetId !== assetId) return o;
    const copy = { ...o };
    delete copy.assetId;
    return copy;
  });
  return { ...withAssets(workspace, next), ...(obligations ? { obligations } : {}) };
}

export function addReading(workspace: Workspace, assetId: string, reading: AssetReading): Workspace {
  if (!Number.isFinite(reading.value) || reading.value < 0) return workspace;
  return withAsset(workspace, assetId, a =>
    !a.meter || a.readings.length >= MAX_ASSET_READINGS || a.readings.some(r => r.id === reading.id)
      ? a
      : { ...a, readings: [...a.readings, reading], updatedAt: reading.createdAt }
  );
}

export function removeReading(workspace: Workspace, assetId: string, readingId: string, at: string): Workspace {
  return withAsset(workspace, assetId, a =>
    a.readings.some(r => r.id === readingId) ? { ...a, readings: a.readings.filter(r => r.id !== readingId), updatedAt: at } : a
  );
}

function planValid(plan: AssetServicePlan): boolean {
  const n = (v: number | null) => v === null || (Number.isInteger(v) && v > 0 && v <= 10_000_000);
  return !!plan.name.trim() && plan.name.length <= MAX_ASSET_TEXT && n(plan.everyMonths) && n(plan.everyMeter) && (plan.everyMonths !== null || plan.everyMeter !== null);
}

export function addPlan(workspace: Workspace, assetId: string, plan: AssetServicePlan): Workspace {
  if (!planValid(plan)) return workspace;
  return withAsset(workspace, assetId, a =>
    a.plans.length >= MAX_ASSET_PLANS || a.plans.some(p => p.id === plan.id) ? a : { ...a, plans: [...a.plans, plan], updatedAt: plan.updatedAt }
  );
}

export function editPlan(
  workspace: Workspace,
  assetId: string,
  planId: string,
  patch: Partial<Pick<AssetServicePlan, "name" | "everyMonths" | "everyMeter" | "startDate" | "startReading" | "listTemplateId">>,
  at: string
): Workspace {
  return withAsset(workspace, assetId, a => {
    const plan = a.plans.find(p => p.id === planId);
    if (!plan) return a;
    const next = { ...plan, ...patch, updatedAt: at };
    if (!planValid(next)) return a;
    return { ...a, plans: a.plans.map(p => (p.id === planId ? next : p)), updatedAt: at };
  });
}

export function removePlan(workspace: Workspace, assetId: string, planId: string, at: string): Workspace {
  return withAsset(workspace, assetId, a =>
    a.plans.some(p => p.id === planId)
      ? {
          ...a,
          plans: a.plans.filter(p => p.id !== planId),
          // Past services stay in history; they just no longer count for a plan.
          logs: a.logs.map(l => (l.planId === planId ? { ...l, planId: null } : l)),
          updatedAt: at,
        }
      : a
  );
}

export function addRevisit(workspace: Workspace, assetId: string, revisit: AssetRevisit): Workspace {
  if (!revisit.what.trim() || revisit.what.length > MAX_ASSET_TEXT || !/^\d{4}-\d{2}-\d{2}$/.test(revisit.by)) return workspace;
  return withAsset(workspace, assetId, a =>
    a.revisits.length >= MAX_ASSET_REVISITS || a.revisits.some(r => r.id === revisit.id)
      ? a
      : { ...a, revisits: [...a.revisits, revisit], updatedAt: revisit.createdAt }
  );
}

export function removeRevisit(workspace: Workspace, assetId: string, revisitId: string, at: string): Workspace {
  return withAsset(workspace, assetId, a =>
    a.revisits.some(r => r.id === revisitId) ? { ...a, revisits: a.revisits.filter(r => r.id !== revisitId), updatedAt: at } : a
  );
}

function entryValid(e: AssetLogEntry): boolean {
  return (
    LOG_KINDS.includes(e.kind) &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    (e.reading === null || (Number.isFinite(e.reading) && e.reading >= 0)) &&
    (e.cost === null || (Number.isInteger(e.cost) && e.cost >= 0)) &&
    e.by.length <= MAX_ASSET_TEXT &&
    e.notes.length <= MAX_ASSET_NOTES &&
    (e.kind === "service" || e.planId === null)
  );
}

/** Condition follows the newest entry that recorded one; otherwise it stays. */
function conditionFromLogs(a: Asset): AssetCondition {
  return sortedLogs(a.logs).find(l => l.conditionAfter !== null)?.conditionAfter ?? a.condition;
}

/**
 * Add a log entry. A service for a plan closes that occurrence (its task link is
 * cleared, so the next one can get its own task).
 */
export function addLogEntry(workspace: Workspace, assetId: string, entry: AssetLogEntry): Workspace {
  if (!entryValid(entry) || totalLogs(workspace) >= MAX_ASSET_LOGS_TOTAL) return workspace;
  return withAsset(workspace, assetId, a => {
    if (a.logs.length >= MAX_ASSET_LOGS_PER_ASSET || a.logs.some(l => l.id === entry.id)) return a;
    if (entry.planId && !a.plans.some(p => p.id === entry.planId)) return a;
    if (entry.reading !== null && !a.meter) return a;
    const logs = [...a.logs, entry];
    const plans = entry.planId ? a.plans.map(p => (p.id === entry.planId ? { ...p, taskId: null, updatedAt: entry.updatedAt } : p)) : a.plans;
    const next = { ...a, logs, plans, updatedAt: entry.updatedAt };
    return { ...next, condition: conditionFromLogs(next) };
  });
}

export function editLogEntry(
  workspace: Workspace,
  assetId: string,
  logId: string,
  patch: Partial<Pick<AssetLogEntry, "kind" | "date" | "reading" | "cost" | "by" | "notes" | "conditionAfter" | "planId">>,
  at: string
): Workspace {
  return withAsset(workspace, assetId, a => {
    const current = a.logs.find(l => l.id === logId);
    if (!current) return a;
    const next = { ...current, ...patch, updatedAt: at };
    if (next.kind !== "service") next.planId = null;
    if (!entryValid(next) || (next.planId && !a.plans.some(p => p.id === next.planId))) return a;
    const updated = { ...a, logs: a.logs.map(l => (l.id === logId ? next : l)), updatedAt: at };
    return { ...updated, condition: conditionFromLogs(updated) };
  });
}

export function removeLogEntry(workspace: Workspace, assetId: string, logId: string, at: string): Workspace {
  return withAsset(workspace, assetId, a => {
    if (!a.logs.some(l => l.id === logId)) return a;
    const updated = { ...a, logs: a.logs.filter(l => l.id !== logId), updatedAt: at };
    return { ...updated, condition: conditionFromLogs(updated) };
  });
}

/** Recording a revisit logs an Inspection with the new condition and closes the revisit. */
export function recordRevisit(
  workspace: Workspace,
  assetId: string,
  revisitId: string,
  entry: AssetLogEntry,
  nextBy: string | null = null
): Workspace {
  const asset = findAsset(workspace, assetId);
  const revisit = asset?.revisits.find(r => r.id === revisitId);
  if (!asset || !revisit) return workspace;
  const logged = addLogEntry(workspace, assetId, { ...entry, kind: "inspection", planId: null, notes: entry.notes.trim() ? `${revisit.what}: ${entry.notes.trim()}` : revisit.what });
  if (logged === workspace) return workspace;
  return withAsset(logged, assetId, a => ({
    ...a,
    revisits: nextBy
      ? a.revisits.map(r => (r.id === revisitId ? { ...r, by: nextBy, taskId: null } : r))
      : a.revisits.filter(r => r.id !== revisitId),
  }));
}

/** Link a task created from Upkeep due (owner-confirmed draft) to its plan or revisit. */
export function linkUpkeepTask(
  workspace: Workspace,
  assetId: string,
  kind: "service" | "revisit",
  refId: string,
  taskId: string,
  at: string
): Workspace {
  if (!workspace.tasks.some(t => t.id === taskId)) return workspace;
  return withAsset(workspace, assetId, a => {
    if (kind === "service") {
      if (!a.plans.some(p => p.id === refId)) return a;
      return { ...a, plans: a.plans.map(p => (p.id === refId ? { ...p, taskId, updatedAt: at } : p)), updatedAt: at };
    }
    if (!a.revisits.some(r => r.id === refId)) return a;
    return { ...a, revisits: a.revisits.map(r => (r.id === refId ? { ...r, taskId } : r)), updatedAt: at };
  });
}

/** Clear references to removed projects, pillars, places, tasks and lists. */
export function pruneAssetLinks(workspace: Workspace): Workspace {
  const assets = workspace.assets;
  if (!assets?.length) {
    if (!workspace.obligations?.some(o => o.assetId)) return workspace;
  }
  const projectIds = new Set(workspace.projects.map(p => p.id));
  const pillarIds = new Set((workspace.goals ?? []).filter(g => g.level === "pillar").map(g => g.id));
  const taskIds = new Set(workspace.tasks.map(t => t.id));
  const templateIds = new Set((workspace.lists?.templates ?? []).map(t => t.id));
  const placeIds = new Set((assets ?? []).filter(a => a.type === "place").map(a => a.id));
  const assetIds = new Set((assets ?? []).map(a => a.id));
  let changed = false;
  const next = (assets ?? []).map(a => {
    const keep = <T>(value: T | null, ok: boolean): T | null => {
      if (value !== null && !ok) changed = true;
      return ok ? value : null;
    };
    const projectId = keep(a.projectId, !!a.projectId && projectIds.has(a.projectId));
    const pillarId = keep(a.pillarId, !!a.pillarId && pillarIds.has(a.pillarId));
    const placeId = keep(a.placeId, !!a.placeId && a.placeId !== a.id && a.type !== "place" && placeIds.has(a.placeId));
    const task = <T extends { taskId: string | null }>(x: T): T => {
      if (x.taskId && !taskIds.has(x.taskId)) {
        changed = true;
        return { ...x, taskId: null };
      }
      return x;
    };
    const plans = a.plans.map(p => {
      const t = task(p);
      if (t.listTemplateId && !templateIds.has(t.listTemplateId)) {
        changed = true;
        return { ...t, listTemplateId: null };
      }
      return t;
    });
    return { ...a, projectId, pillarId, placeId, plans, revisits: a.revisits.map(task), logs: a.logs.map(task) };
  });
  const obligations = workspace.obligations?.map(o => {
    if (!o.assetId || assetIds.has(o.assetId)) return o;
    changed = true;
    const copy = { ...o };
    delete copy.assetId;
    return copy;
  });
  if (!changed) return workspace;
  return { ...workspace, ...(assets ? { assets: next } : {}), ...(obligations ? { obligations } : {}) };
}

// ---------------------------------------------------------------------------
// Costs

export interface CostRow {
  year: string;
  assetId: string;
  assetName: string;
  type: AssetType;
  entries: number;
  cents: number;
}

export function costsByYear(workspace: Workspace): CostRow[] {
  const rows = new Map<string, CostRow>();
  for (const a of assetsOf(workspace)) {
    for (const l of a.logs) {
      if (l.cost === null) continue;
      const year = l.date.slice(0, 4);
      const key = `${year}|${a.id}`;
      const row = rows.get(key) ?? { year, assetId: a.id, assetName: a.name, type: a.type, entries: 0, cents: 0 };
      row.entries += 1;
      row.cents += l.cost;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((x, y) => y.year.localeCompare(x.year) || x.assetName.localeCompare(y.assetName));
}

export function yearCost(asset: Asset, year: string): number {
  return asset.logs.reduce((n, l) => (l.cost !== null && l.date.startsWith(year) ? n + l.cost : n), 0);
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function costsCsv(workspace: Workspace): string {
  const lines = [["Year", "Asset", "Type", "Entries with a cost", "Total (AUD)"].map(csvCell).join(",")];
  for (const r of costsByYear(workspace)) {
    lines.push([r.year, r.assetName, ASSET_TYPE_LABEL[r.type], String(r.entries), (r.cents / 100).toFixed(2)].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Speech and the connector view

export function assetsSpeech(workspace: Workspace, today: string, assetId: string | null): string {
  if (assetId) {
    const a = findAsset(workspace, assetId);
    if (!a) return "";
    const parts = [`${a.name}. ${ASSET_TYPE_LABEL[a.type]}.`];
    if (a.condition !== "unchecked") parts.push(`Condition ${CONDITION_LABEL[a.condition]}.`);
    const r = lastReading(a);
    if (r && a.meter) parts.push(`${METER_LABEL[a.meter]} ${meterText(r.value, a.meter)} on ${shortDate(r.date, today)}.`);
    for (const p of a.plans) {
      const s = planStatus(a, p, today);
      parts.push(`${p.name}: ${s.state === "not-started" ? "not started" : `${s.state === "overdue" ? "overdue, " : s.state === "due" ? "due, " : ""}next ${planNextText(a, s, today)}`}.`);
    }
    for (const rv of a.revisits) parts.push(`Revisit ${rv.what} by ${shortDate(rv.by, today)}.`);
    const last = sortedLogs(a.logs)[0];
    if (last) parts.push(`Last entry ${shortDate(last.date, today)}: ${LOG_KIND_LABEL[last.kind]}.`);
    return parts.join(" ");
  }
  const active = assetsOf(workspace).filter(a => a.status === "active");
  const due = upkeepDue(workspace, today);
  const head = `${active.length} asset${active.length === 1 ? "" : "s"}.`;
  if (!due.length) return `${head} Nothing due.`;
  return `${head} Upkeep due: ${due.map(d => `${d.assetName}, ${d.what}`).join("; ")}.`;
}

/**
 * What the Claude connector sees (owner decision 2026-11-14): names, type,
 * condition, next due, last done, and the type and date of recent entries.
 * Never costs, prices, serials, documents or note text.
 */
export function assetsForConnector(workspace: Workspace, today: string) {
  const byId = new Map(assetsOf(workspace).map(a => [a.id, a]));
  return {
    assets: assetsOf(workspace).map(a => {
      const r = lastReading(a);
      return {
        assetId: a.id,
        name: a.name,
        type: a.type,
        condition: a.condition,
        status: a.status,
        at: a.placeId ? byId.get(a.placeId)?.name ?? null : null,
        meter: a.meter && r ? { unit: a.meter, value: r.value, date: r.date } : null,
        plans: a.plans.map(p => {
          const s = planStatus(a, p, today);
          return {
            name: p.name,
            every: planEveryText(p, a.meter),
            lastDone: s.last?.date || null,
            nextDue: { date: s.nextDate, meter: s.nextMeter },
            state: s.state,
          };
        }),
        revisits: a.revisits.map(rv => ({ what: rv.what, by: rv.by, state: revisitState(rv, today) })),
        recentEntries: sortedLogs(a.logs)
          .slice(0, 5)
          .map(l => ({ type: l.kind, date: l.date })),
      };
    }),
    upkeepDue: upkeepDue(workspace, today).map(d => ({ assetId: d.assetId, asset: d.assetName, what: d.what, detail: d.detail, overdue: d.overdue })),
  };
}

// ---------------------------------------------------------------------------
// Old shape → new (on load; deterministic)

function typeFromCategory(category: string): AssetType | null {
  const c = category.trim().toLowerCase();
  if (!c) return null;
  if (/v[e]?h[i]?cle|vhicle|\bcar\b|\bute\b|truck|\bvan\b|motor|bike|trailer|caravan|boat|4wd/.test(c)) return "vehicle";
  if (/place|house|home|shack|property|\bunit\b|flat|cabin|shed|farm|block/.test(c)) return "place";
  if (/appliance|fridge|freezer|washer|washing|dryer|oven|stove|dishwasher|hot water|heater|air ?con|microwave/.test(c)) return "appliance";
  if (/equip|tool|machine|mower|generator|pump|chainsaw/.test(c)) return "equipment";
  return null;
}
const LEGACY_CONDITION: Record<LegacyAssetCondition, AssetCondition> = {
  unknown: "unchecked",
  good: "good",
  fair: "fair",
  worn: "poor",
  "needs-attention": "needs-attention",
};

export function assetFromLegacy(old: LegacyAsset): Asset {
  const type = typeFromCategory(old.category);
  const logs: AssetLogEntry[] = old.wearLogs.map(l => ({
    id: l.id,
    kind: "note",
    date: l.date,
    reading: null,
    cost: null,
    by: "",
    notes: l.text,
    conditionAfter: l.condition === "unknown" ? null : LEGACY_CONDITION[l.condition],
    planId: null,
    taskId: l.taskId,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));
  // A category that isn't one of the four types is kept as a dated note.
  if (!type && old.category.trim()) {
    logs.push({
      id: `${old.id}-category`,
      kind: "note",
      date: old.createdAt.slice(0, 10),
      reading: null,
      cost: null,
      by: "",
      notes: `Category before Assets & Upkeep: ${old.category.trim()}`,
      conditionAfter: null,
      planId: null,
      taskId: null,
      createdAt: old.createdAt,
      updatedAt: old.createdAt,
    });
  }
  return newAsset(old.id, old.name, type ?? "equipment", old.createdAt, {
    condition: LEGACY_CONDITION[old.condition],
    status: old.status,
    projectId: old.projectId,
    logs,
    updatedAt: old.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// Validation (strict, like the rest of the workspace)

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function bad(message: string): never {
  throw new Error(message);
}
function exact(value: Rec, keys: string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) bad(`${label} has unknown or missing fields.`);
}
function str(value: Rec, key: string, max: number, label: string, nonEmpty = false): string {
  const v = value[key];
  if (typeof v !== "string" || v.length > max || (nonEmpty && !v.trim())) bad(`${label} ${key} must be ${nonEmpty ? "a non-empty " : "a "}string up to ${max} characters.`);
  return v;
}
function id(value: Rec, key: string, label: string): string {
  const v = str(value, key, 128, label, true);
  if (!ID.test(v)) bad(`${label} ${key} is not a valid ID.`);
  return v;
}
function nid(value: Rec, key: string, label: string): string | null {
  return value[key] === null ? null : id(value, key, label);
}
function date(value: Rec, key: string, label: string): string {
  const v = value[key];
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) bad(`${label} ${key} must be a date.`);
  return v;
}
function ndate(value: Rec, key: string, label: string): string | null {
  return value[key] === null ? null : date(value, key, label);
}
function instant(value: Rec, key: string, label: string): string {
  const v = value[key];
  if (typeof v !== "string" || v.length > 100 || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) bad(`${label} ${key} must be a valid timestamp.`);
  return v;
}
function num(value: Rec, key: string, label: string, opts: { int?: boolean; positive?: boolean } = {}): number | null {
  const v = value[key];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e10 || (opts.int && !Number.isInteger(v)) || (opts.positive && v <= 0)) bad(`${label} ${key} must be a number.`);
  return v;
}
function oneOf<T extends string>(value: Rec, key: string, options: readonly T[], label: string): T {
  const v = value[key];
  if (typeof v !== "string" || !options.includes(v as T)) bad(`${label} ${key} is invalid.`);
  return v as T;
}
function list(value: Rec, key: string, max: number, label: string): unknown[] {
  const v = value[key];
  if (!Array.isArray(v) || v.length > max) bad(`${label} ${key} must be a list of at most ${max}.`);
  return v;
}

const ASSET_KEYS = [
  "id", "name", "type", "condition", "status", "make", "model", "serial", "purchaseDate", "purchasePrice",
  "warrantyEnd", "documents", "pillarId", "projectId", "placeId", "meter", "readings", "plans", "revisits",
  "logs", "createdAt", "updatedAt",
];
const LEGACY_KEYS = ["id", "name", "category", "condition", "status", "projectId", "wearLogs", "createdAt", "updatedAt"];

function legacyAsset(raw: Rec, label: string): LegacyAsset {
  exact(raw, LEGACY_KEYS, label);
  const conditions = ["unknown", "good", "fair", "worn", "needs-attention"] as const;
  return {
    id: id(raw, "id", label),
    name: str(raw, "name", MAX_ASSET_NAME_LENGTH, label, true),
    category: str(raw, "category", 80, label),
    condition: oneOf(raw, "condition", conditions, label),
    status: oneOf(raw, "status", ["active", "retired"] as const, label),
    projectId: nid(raw, "projectId", label),
    wearLogs: list(raw, "wearLogs", MAX_ASSET_LOGS_PER_ASSET, label).map((l, i) => {
      const ll = `${label} wear log ${i + 1}`;
      if (!isRec(l)) bad(`${ll} is not an object.`);
      exact(l, ["id", "date", "condition", "text", "taskId", "createdAt", "updatedAt"], ll);
      return {
        id: id(l, "id", ll),
        date: date(l, "date", ll),
        condition: oneOf(l, "condition", conditions, ll),
        text: str(l, "text", MAX_ASSET_NOTES, ll, true),
        taskId: nid(l, "taskId", ll),
        createdAt: instant(l, "createdAt", ll),
        updatedAt: instant(l, "updatedAt", ll),
      };
    }),
    createdAt: instant(raw, "createdAt", label),
    updatedAt: instant(raw, "updatedAt", label),
  };
}

function strictAsset(raw: Rec, label: string): Asset {
  exact(raw, ASSET_KEYS, label);
  const meter = raw.meter === null ? null : oneOf(raw, "meter", METER_UNITS, label);
  return {
    id: id(raw, "id", label),
    name: str(raw, "name", MAX_ASSET_NAME_LENGTH, label, true),
    type: oneOf(raw, "type", ASSET_TYPES, label),
    condition: oneOf(raw, "condition", ASSET_CONDITIONS, label),
    status: oneOf(raw, "status", ["active", "retired"] as const, label),
    make: str(raw, "make", MAX_ASSET_TEXT, label),
    model: str(raw, "model", MAX_ASSET_TEXT, label),
    serial: str(raw, "serial", MAX_ASSET_TEXT, label),
    purchaseDate: ndate(raw, "purchaseDate", label),
    purchasePrice: num(raw, "purchasePrice", label, { int: true }),
    warrantyEnd: ndate(raw, "warrantyEnd", label),
    documents: list(raw, "documents", MAX_ASSET_DOCUMENTS, label).map((d, i) => {
      const dl = `${label} document ${i + 1}`;
      if (!isRec(d)) bad(`${dl} is not an object.`);
      exact(d, ["label", "url"], dl);
      const url = str(d, "url", 2000, dl, true);
      if (!/^https:\/\//i.test(url)) bad(`${dl} url must start with https://.`);
      return { label: str(d, "label", MAX_ASSET_TEXT, dl), url };
    }),
    pillarId: nid(raw, "pillarId", label),
    projectId: nid(raw, "projectId", label),
    placeId: nid(raw, "placeId", label),
    meter,
    readings: list(raw, "readings", MAX_ASSET_READINGS, label).map((r, i) => {
      const rl = `${label} reading ${i + 1}`;
      if (!isRec(r)) bad(`${rl} is not an object.`);
      exact(r, ["id", "date", "value", "createdAt"], rl);
      const value = num(r, "value", rl);
      if (value === null) bad(`${rl} value is required.`);
      return { id: id(r, "id", rl), date: date(r, "date", rl), value, createdAt: instant(r, "createdAt", rl) };
    }),
    plans: list(raw, "plans", MAX_ASSET_PLANS, label).map((p, i) => {
      const pl = `${label} plan ${i + 1}`;
      if (!isRec(p)) bad(`${pl} is not an object.`);
      exact(p, ["id", "name", "everyMonths", "everyMeter", "startDate", "startReading", "listTemplateId", "taskId", "createdAt", "updatedAt"], pl);
      const plan: AssetServicePlan = {
        id: id(p, "id", pl),
        name: str(p, "name", MAX_ASSET_TEXT, pl, true),
        everyMonths: num(p, "everyMonths", pl, { int: true, positive: true }),
        everyMeter: num(p, "everyMeter", pl, { int: true, positive: true }),
        startDate: ndate(p, "startDate", pl),
        startReading: num(p, "startReading", pl),
        listTemplateId: nid(p, "listTemplateId", pl),
        taskId: nid(p, "taskId", pl),
        createdAt: instant(p, "createdAt", pl),
        updatedAt: instant(p, "updatedAt", pl),
      };
      if (plan.everyMonths === null && plan.everyMeter === null) bad(`${pl} needs a time or meter interval.`);
      return plan;
    }),
    revisits: list(raw, "revisits", MAX_ASSET_REVISITS, label).map((r, i) => {
      const rl = `${label} revisit ${i + 1}`;
      if (!isRec(r)) bad(`${rl} is not an object.`);
      exact(r, ["id", "what", "by", "taskId", "createdAt"], rl);
      return {
        id: id(r, "id", rl),
        what: str(r, "what", MAX_ASSET_TEXT, rl, true),
        by: date(r, "by", rl),
        taskId: nid(r, "taskId", rl),
        createdAt: instant(r, "createdAt", rl),
      };
    }),
    logs: list(raw, "logs", MAX_ASSET_LOGS_PER_ASSET, label).map((l, i) => {
      const ll = `${label} entry ${i + 1}`;
      if (!isRec(l)) bad(`${ll} is not an object.`);
      exact(l, ["id", "kind", "date", "reading", "cost", "by", "notes", "conditionAfter", "planId", "taskId", "createdAt", "updatedAt"], ll);
      return {
        id: id(l, "id", ll),
        kind: oneOf(l, "kind", LOG_KINDS, ll),
        date: date(l, "date", ll),
        reading: num(l, "reading", ll),
        cost: num(l, "cost", ll, { int: true }),
        by: str(l, "by", MAX_ASSET_TEXT, ll),
        notes: str(l, "notes", MAX_ASSET_NOTES, ll),
        conditionAfter: l.conditionAfter === null ? null : oneOf(l, "conditionAfter", ASSET_CONDITIONS, ll),
        planId: nid(l, "planId", ll),
        taskId: nid(l, "taskId", ll),
        createdAt: instant(l, "createdAt", ll),
        updatedAt: instant(l, "updatedAt", ll),
      };
    }),
    createdAt: instant(raw, "createdAt", label),
    updatedAt: instant(raw, "updatedAt", label),
  };
}

/** Accepts the current shape, or the old wear-log shape (converted). */
export function validateAssets(value: unknown): Asset[] {
  if (!Array.isArray(value) || value.length > MAX_ASSETS) bad(`assets must be a list of at most ${MAX_ASSETS}.`);
  const ids = new Set<string>();
  const childIds = new Set<string>();
  let logs = 0;
  const assets = value.map((raw, index) => {
    const label = `asset ${index + 1}`;
    if (!isRec(raw)) bad(`${label} is not an object.`);
    const asset = "wearLogs" in raw ? assetFromLegacy(legacyAsset(raw, label)) : strictAsset(raw, label);
    if (ids.has(asset.id)) bad("asset IDs must be unique.");
    ids.add(asset.id);
    for (const child of [...asset.readings, ...asset.plans, ...asset.revisits, ...asset.logs]) {
      if (childIds.has(child.id)) bad(`${label} has a repeated entry ID.`);
      childIds.add(child.id);
    }
    for (const l of asset.logs) {
      if (l.planId && !asset.plans.some(p => p.id === l.planId)) bad(`${label} has an entry for a missing service plan.`);
      if (l.planId && l.kind !== "service") bad(`${label} only service entries can belong to a plan.`);
    }
    logs += asset.logs.length;
    if (logs > MAX_ASSET_LOGS_TOTAL) bad(`assets may hold at most ${MAX_ASSET_LOGS_TOTAL} entries.`);
    return asset;
  });
  return assets;
}
