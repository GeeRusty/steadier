import type { PlanningSettings, ProjectSchedule, TaskSchedule } from "./time";
import type { Imperative, ProjectCompass, TaskCompass } from "./compass";
import type { WeeklyReview } from "./review";
import type { Goal } from "./goals";
export const STATES = [
  "ready",
  "inbox",
  "waiting",
  "blocked",
  "someday",
  "done",
] as const;
export type TaskState = (typeof STATES)[number];
export type Context = "anywhere" | "home" | "computer" | "out";
export type DerivedState = TaskState | "scheduled" | "deferred";
export type Scenario =
  | "few"
  | "fifty"
  | "twohundred"
  | "fivehundred"
  | "deadlines"
  | "overdue"
  | "undated"
  | "quiet";
export type View =
  | "attention"
  | "all"
  | "review"
  | "waiting"
  | "progress"
  | "settings"
  | "projects"
  | "matrix"
  | "cloud"
  | "sheet"
  | "calendar"
  | "time"
  | "imperatives"
  | "compass-view"
  | "weekly"
  | "map"
  | "compass-directory"
  | "near"
  | "obligations"
  | "journal"
  | "decisions"
  | "evidence"
  | "sites"
  | "shopping"
  | "assets"
  | "pipeline"
  | "routine"
  | "yearWheel"
  | "moveEnergy"
  | "weather"
  | "people"
  | "credentialRenewals"
  | "invoices"
  | "sort"
  | "ideas"
  | "linkcheck";
export type LifeRole = "direction" | "support";
export type LifePattern = "timely" | "sustained";
export type LabelSource = "unclassified" | "suggested" | "confirmed";
export type ObligationKind =
  | "bill"
  | "renewal"
  | "licence"
  | "insurance"
  | "tax"
  | "cancel-by";
export type ObligationStatus = "draft" | "active" | "paid";
export type ObligationCadence =
  | "none"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";
export interface ObligationLink {
  kind: "pillar" | "imperative";
  id: string;
}
export interface TaskObligationOrigin {
  obligationId: string;
  occurrenceDueDate: string;
  link: ObligationLink;
  active: boolean;
}
export interface Obligation {
  id: string;
  title: string;
  kind: ObligationKind;
  dueDate: string;
  leadTimeDays: number;
  cadence: ObligationCadence;
  cadenceAnchorDate: string | null;
  link: ObligationLink | null;
  status: ObligationStatus;
  amountDue: string | null;
  nextAction: string;
  referenceUrl: string | null;
  lastPaidOn: string | null;
  lastPaidDueDate: string | null;
  preparationTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Added by Claude and not yet confirmed by the owner; absent otherwise. */
  suggestedBy?: "claude";
  /** The asset this is for (registration, insurance); absent otherwise. */
  assetId?: string;
}
export type CredentialRenewalCategory =
  | "licence"
  | "professional-registration"
  | "certificate"
  | "permit"
  | "identity-document"
  | "other-credential";
export interface CredentialRenewalInput {
  category: CredentialRenewalCategory;
  renewalDate: string;
  name: string;
  purpose: string;
  notes: string;
}
export interface CredentialRenewal
  extends Omit<CredentialRenewalInput, "name" | "purpose" | "notes"> {
  id: string;
  /** Absent only on historical date-only records. */
  name?: string;
  purpose?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export type InvoiceGstMode = "off" | "exclusive" | "inclusive";
export interface InvoiceSettings {
  supplierName: string;
  supplierAddress: string;
  supplierAbn: string;
  gstMode: InvoiceGstMode;
  /** Set only when the owner explicitly confirms GST registration and scope. */
  gstConfirmedAt: string | null;
  /** Exact profile values the owner confirmed; changes require reconfirmation. */
  gstConfirmedProfile: {
    supplierName: string;
    supplierAddress: string;
    supplierAbn: string;
  } | null;
  nextInvoiceNumber: number;
  updatedAt: string;
}
export interface InvoiceLineItem {
  id: string;
  description: string;
  /** Quantity scaled by 1,000 (for example, 1.250 = 1,250). */
  quantityMilli: number;
  unitPriceCents: number;
}
export interface InvoiceDraft {
  issueDate: string;
  dueDate: string | null;
  customerName: string;
  customerAddress: string;
  customerAbn: string;
  /** Optional job/customer reference; absent on historical invoices. */
  jobReference?: string;
  lines: InvoiceLineItem[];
}
export interface InvoiceVersion extends InvoiceDraft {
  invoiceNumber: string;
  version: number;
  supplierName: string;
  supplierAddress: string;
  supplierAbn: string;
  gstMode: InvoiceGstMode;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  issuedAt: string;
  correctionReason: string | null;
}
export interface InvoiceDeliveryEvent {
  id: string;
  /** Delivery history belongs to a specific immutable invoice version. */
  version: number;
  date: string;
  result: "sent" | "failed";
  note: string;
  recordedAt: string;
}
export interface InvoicePaymentEvent {
  id: string;
  kind: "payment" | "reversal";
  /** The issued invoice version current when this event was recorded. */
  version: number;
  date: string;
  amountCents: number;
  note: string;
  /** Null for a receipt; otherwise the earlier receipt being reversed. */
  reversalOf: string | null;
  recordedAt: string;
}
export interface InvoiceRecord {
  id: string;
  invoiceNumber: string | null;
  status: "draft" | "issued" | "void";
  draft: InvoiceDraft;
  /** Issued copies are append-only; corrections add a new version. */
  versions: InvoiceVersion[];
  /** Optional only for historical records; activity is appended, not overwritten. */
  deliveryEvents?: InvoiceDeliveryEvent[];
  paymentEvents?: InvoicePaymentEvent[];
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkspaceEvidence {
  id: string;
  targetKind: "task" | "project";
  targetId: string;
  titleSnapshot: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
export type MatrixCell =
  | "direction-timely"
  | "direction-sustained"
  | "support-timely"
  | "support-sustained";
export type MatrixWeights = Record<MatrixCell, number>;
export interface Task {
  id: string;
  title: string;
  nextAction: string;
  notes: string;
  state: TaskState;
  pinned: boolean;
  deadline: string | null;
  startDate: string | null;
  reviewDate: string | null;
  deferredUntil: string | null;
  estimate: number;
  context: Context;
  waitingFor: string;
  dependencies: string[];
  checklist: { id: string; text: string; done: boolean }[];
  repeatDays: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  history: { at: string; text: string }[];
  /** Consecutive explicit Not now choices; absent on historical tasks. */
  passOverCount?: number;
  /** Timestamp of an owner-kept Dropped decision; never means deletion. */
  droppedAt?: string | null;
  /**
   * Task card Action dot: false until the owner confirms the title reads as
   * an action. Absent on tasks made before the card (they keep the old rule).
   */
  actionConfirmed?: boolean;
  purpose: string;
  role: LifeRole | null;
  pattern: LifePattern | null;
  labelSource: LabelSource;
  projectId: string | null;
  preparationDate: string | null;
  preparationSource: "suggested" | "confirmed";
  progressEvidence: string;
  /** Planned slot, reminders, repeat rule and time log (v2.1; defaulted on read). */
  schedule: TaskSchedule;
  /** Imperative links, catch-all placement and decision outcome (v2.2). */
  compass: TaskCompass;
  /**
   * Subtask link (v2.6). Present only on subtasks, so older records and
   * top-level tasks are unchanged. `suggested` is true while a connector-made
   * link awaits the owner's Confirm.
   */
  parent?: TaskParent;
  /**
   * Place this task belongs to (v2.7), e.g. "Bunnings". Only present when
   * set; older tasks are unchanged.
   */
  placeId?: string;
  /** Owner-confirmed source link for a generated obligation preparation task. */
  obligation?: TaskObligationOrigin;
}
export interface LinkCheckHold {
  kind: "imperative" | "project";
  id: string;
  /** Adelaide local timestamp of the Not yet tap. */
  heldOn: string;
}
export interface TaskParent {
  id: string;
  suggested: boolean;
}
export interface Project {
  id: string;
  title: string;
  purpose: string;
  outcome: string;
  role: LifeRole;
  pattern: LifePattern;
  status: "active" | "achieved";
  milestones: { id: string; title: string; done: boolean }[];
  progress: { at: string; text: string }[];
  createdAt: string;
  updatedAt: string;
  /** Deadline, review date, weekly time budget and milestone dates (v2.1). */
  schedule: ProjectSchedule;
  /** Imperative links, decision outcome and Notion link (v2.2). */
  compass: ProjectCompass;
}
export interface FocusSession {
  taskId: string;
  remaining: number;
  duration: number;
  running: boolean;
  updatedAt: number;
  step: string;
  /** Scheduled timeboxes may continue counting down after the task is completed. */
  continueAfterDone?: boolean;
}
export interface DailyIntention {
  date: string;
  text: string;
  taskId: string | null;
}
export interface Workspace {
  version: 2;
  tasks: Task[];
  projects: Project[];
  focus: FocusSession | null;
  intention: DailyIntention | null;
  /** One selected next thing, separate from the daily intention. */
  nextThing?: { taskId: string; when: string; date: string; updatedAt: string } | null;
  matrixWeights: MatrixWeights;
  trial: {
    startedAt: string;
    lastExportAt: string | null;
    lastReviewAt: string | null;
  };
  /** Day window and buffer for Plan my day / Reset my day (v2.1). */
  planning: PlanningSettings;
  /** Active and retired Imperatives (v2.2). */
  imperatives: Imperative[];
  /** Weekly Reality Reviews with Floor Check answers (v2.3). */
  reviews: WeeklyReview[];
  /** Compass map: Pillars, Value Goals and Goal Outcomes (v2.4). */
  goals: Goal[];
  /** Saved places for location reminders (v2.7). Absent until the first one. */
  places?: Place[];
  /** Active bills and other dated obligations; absent only on historical saves. */
  obligations?: Obligation[];
  /** Owner-saved evidence feed; absent until the first evidence entry. */
  evidence?: WorkspaceEvidence[];
  /** Non-sensitive owner-managed public site references; absent until used. */
  siteCards?: SiteCard[];
  /**
   * Lists: reusable templates, their runs (each use, with its own ticks and
   * date) and links to tasks, projects and notes. Absent until used. Older
   * saves with `shoppingLists` are converted into this on load.
   */
  lists?: ListsStore;
  /** Front of Mind: what's on the owner's mind that isn't a task yet (replaced the Ideas shelf 2026-11-14). */
  frontOfMind?: FrontOfMindStore;
  /** Notes to self (Daily Log); absent until the first note. */
  dailyLog?: DailyLogEntry[];
  /**
   * Link check "Not yet" holds; absent until the first one. A hold lasts until
   * the next Weekly Reality Review is saved after it.
   */
  linkCheckHolds?: LinkCheckHold[];
  /**
   * Hide obligation amounts from Claude (the connector). Absent means hidden;
   * only an explicit false lets Claude see or add amounts.
   */
  hideAmountsFromAI?: boolean;
  /** Manually maintained physical Assets and condition logs; absent until used. */
  assets?: Asset[];
  /** Owner-entered relationship follow-ups; absent until used. */
  people?: WorkspaceContact[];
  /** Non-secret credential renewal metadata; absent until used. */
  credentialRenewals?: CredentialRenewal[];
  /** Private supplier settings and invoice history; absent until configured. */
  invoiceSettings?: InvoiceSettings;
  /** Private business/customer invoice data; absent until used. */
  invoices?: InvoiceRecord[];
}

export interface SiteCard {
  id: string;
  title: string;
  category: string;
  purpose: string;
  url: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}
export interface DailyLogEntry {
  id: string;
  /** Adelaide-local day the note is about, YYYY-MM-DD. */
  date: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
/** Read-Do: read each step, then do it. Do-Confirm: do from memory, then confirm. */
export type ListKind = "read-do" | "do-confirm";
export interface ListSection {
  id: string;
  title: string;
}
export interface ListItem {
  id: string;
  text: string;
  /** null = the list's first, unnamed section. */
  sectionId: string | null;
  /** Added by Claude; shown dashed until the owner confirms it. */
  suggested: boolean;
  createdAt: string;
  updatedAt: string;
}
/** The master list. It is never ticked; runs are. */
export interface ListTemplate {
  id: string;
  title: string;
  kind: ListKind;
  /** The pause point, e.g. "before leaving for Kingston". Empty if none. */
  useWhen: string;
  sections: ListSection[];
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
}
/** An item added during one run only (offered to the template afterwards). */
export interface ListRunExtra {
  id: string;
  text: string;
  suggested: boolean;
  createdAt: string;
}
/** What a finished run looked like, kept even if the template changes later. */
export interface ListRunSnapshotItem {
  id: string;
  text: string;
  section: string;
  ticked: boolean;
  extra: boolean;
}
export interface ListRun {
  id: string;
  templateId: string;
  /** Adelaide-local day the run started, YYYY-MM-DD. */
  date: string;
  startedAt: string;
  finishedAt: string | null;
  /** Ticked item ids (template items or extras) and when they were ticked. */
  ticks: Record<string, string>;
  extras: ListRunExtra[];
  /** The task or project this run was started for, if any. */
  parent: { kind: "task" | "project"; id: string } | null;
  /** Filled when the run finishes. */
  snapshot: ListRunSnapshotItem[] | null;
  updatedAt: string;
}
/** A task, project or note pointing at a template. "attached" offers a run when the parent starts; "link" is a pointer only. */
export interface ListLink {
  id: string;
  templateId: string;
  target: { kind: "task" | "project" | "note"; id: string };
  mode: "attached" | "link";
  createdAt: string;
}
export interface ListsStore {
  templates: ListTemplate[];
  runs: ListRun[];
  links: ListLink[];
}
/** Legacy (before 2026-11-14): converted into `lists` on load. */
export interface ShoppingListItem {
  id: string;
  text: string;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ShoppingList {
  id: string;
  title: string;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt: string;
}
/** Pre-2026-11-14 shape, kept only so old backups convert (see assets.ts). */
export interface FrontOfMindEntry {
  at: string;
  by: "owner" | "claude";
  text: string;
  /** Earlier wording, on wording changes. */
  was?: string;
}
export interface FrontOfMindItem {
  id: string;
  text: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  addedBy: "owner" | "claude";
  /** "added by Claude" shows until the owner Keeps it. */
  claudeLabel: boolean;
  /** Last Keep (looked at). */
  lookedAt: string | null;
  letGoAt: string | null;
  /** Claude's suggestion; only the owner can act on it. */
  letGoSuggestion: { at: string; reason: string } | null;
  /** Waits for the Weekly Review's Imperatives step. */
  imperativeDraft: { title: string; reason: string; at: string } | null;
  /** Set once it became a task or an Imperative; it then leaves the list. */
  became: { kind: "task" | "imperative"; id: string; at: string } | null;
  /** Links it had as an idea. */
  projectId: string | null;
  imperativeIds: string[];
  history: FrontOfMindEntry[];
}
export interface FrontOfMindStore {
  items: FrontOfMindItem[];
}
export type LegacyAssetCondition =
  | "unknown"
  | "good"
  | "fair"
  | "worn"
  | "needs-attention";
export interface AssetWearLog {
  id: string;
  date: string;
  condition: LegacyAssetCondition;
  text: string;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LegacyAsset {
  id: string;
  name: string;
  category: string;
  condition: LegacyAssetCondition;
  status: "active" | "retired";
  projectId: string | null;
  wearLogs: AssetWearLog[];
  createdAt: string;
  updatedAt: string;
}

export type AssetType = "vehicle" | "place" | "equipment" | "appliance";
/** "unchecked" = not yet checked; shown without a chip. */
export type AssetCondition = "unchecked" | "good" | "fair" | "poor" | "needs-attention";
export type AssetMeterUnit = "km" | "h";
export type AssetLogKind = "service" | "repair" | "inspection" | "note";
export interface AssetDocument {
  label: string;
  url: string;
}
export interface AssetReading {
  id: string;
  date: string;
  value: number;
  createdAt: string;
}
export interface AssetServicePlan {
  id: string;
  name: string;
  everyMonths: number | null;
  everyMeter: number | null;
  /** Starting point when it has never been logged here. */
  startDate: string | null;
  startReading: number | null;
  /** Lists template offered when the service is due. */
  listTemplateId: string | null;
  /** The task created from Upkeep due for the current occurrence. */
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AssetRevisit {
  id: string;
  what: string;
  by: string;
  taskId: string | null;
  createdAt: string;
}
export interface AssetLogEntry {
  id: string;
  kind: AssetLogKind;
  date: string;
  /** Meter reading at the time (km or h), optional. */
  reading: number | null;
  /** Cost in cents, optional. */
  cost: number | null;
  by: string;
  notes: string;
  conditionAfter: AssetCondition | null;
  /** Service entries: which plan this was. */
  planId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  condition: AssetCondition;
  status: "active" | "retired";
  make: string;
  model: string;
  serial: string;
  purchaseDate: string | null;
  /** Cents. */
  purchasePrice: number | null;
  warrantyEnd: string | null;
  documents: AssetDocument[];
  pillarId: string | null;
  projectId: string | null;
  /** The Place asset this one is at (one level). */
  placeId: string | null;
  meter: AssetMeterUnit | null;
  readings: AssetReading[];
  plans: AssetServicePlan[];
  revisits: AssetRevisit[];
  logs: AssetLogEntry[];
  createdAt: string;
  updatedAt: string;
}
export interface WorkspaceContact {
  id: string;
  name: string;
  relationship: string;
  context: string;
  lastContactDate: string | null;
  nextContactDate: string | null;
  /** Optional birthday without retaining a birth year; MM-DD. */
  birthdayMonthDay?: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}
/**
 * A saved place. Coordinates sync with the workspace like other records;
 * the device's live location is never saved or sent anywhere.
 */
export interface Place {
  id: string;
  name: string;
  /** Address or note shown under the name (may be empty). */
  address: string;
  lat: number;
  lng: number;
  /** Arrival distance in metres. */
  radius: number;
}
export interface AttentionItem {
  task: Task;
  reason: string;
  kind: "action" | "review" | "followup" | "clarify";
}
export interface AttentionResult {
  items: AttentionItem[];
  commitments: Task[];
  reviewDue: Task[];
  eligibleCount: number;
  waitingCount: number;
  blockedCount: number;
  outstandingCount: number;
}
