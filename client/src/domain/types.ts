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
  | "command-centre"
  | "all"
  | "review"
  | "waiting"
  | "areas"
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
  | "ideas";
export type LifeRole = "direction" | "support";
export type LifePattern = "timely" | "sustained";
export type LabelSource = "unclassified" | "suggested" | "confirmed";
export type ObligationKind =
  | "bill"
  | "renewal"
  | "licence"
  | "insurance"
  | "tax";
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
  area: string;
  nextAction: string;
  notes: string;
  state: TaskState;
  /** Legacy compatibility fact; new UI uses life role/pattern, not high/low value. */
  important: boolean;
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
  /** Owner-managed plain-text shopping lists; absent until used. */
  shoppingLists?: ShoppingList[];
  /** Notes to self (Daily Log); absent until the first note. */
  dailyLog?: DailyLogEntry[];
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
export type AssetCondition =
  | "unknown"
  | "good"
  | "fair"
  | "worn"
  | "needs-attention";
export interface AssetWearLog {
  id: string;
  date: string;
  condition: AssetCondition;
  text: string;
  /** One explicitly confirmed follow-up task; null means not linked. */
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Asset {
  id: string;
  name: string;
  category: string;
  condition: AssetCondition;
  status: "active" | "retired";
  projectId: string | null;
  wearLogs: AssetWearLog[];
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
