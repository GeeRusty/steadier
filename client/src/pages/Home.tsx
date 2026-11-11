import ClaudeConsent from "../components/steadier/ClaudeConsent";
import {
  OrphanBanner,
  OrphanPill,
  OrphanSheet,
} from "../components/steadier/OrphanUI";
import ClaudeChangesPanel from "../components/steadier/ClaudeChangesPanel";
import { useFocusTones } from "../hooks/useFocusTones";
import { useCalendarFocusAutostart } from "../hooks/useCalendarFocusAutostart";
import { useReminders } from "../hooks/useReminders";
import { useFocusTimeLog } from "../hooks/useFocusTimeLog";
import CalendarView from "../components/steadier/CalendarView";
import TodayVisualTimeline from "../components/steadier/TodayVisualTimeline";
import TaskViewPanel from "../components/steadier/TaskViewPanel";
import TodayViewSwitch from "../components/steadier/TodayViewSwitch";
import TodayNextThing from "../components/steadier/TodayNextThing";
import V2FoldableCard from "../components/steadier/V2FoldableCard";
import TodayCalendarMenuSheet, {
  CALENDAR_GUIDE,
  TODAY_GUIDE,
} from "../components/steadier/TodayCalendarMenuSheet";
import PagePurposeNote from "../components/steadier/PagePurposeNote";
import MyLifeNavigationButton from "../components/steadier/MyLifeNavigationButton";
import ImperativesView from "../components/steadier/ImperativesView";
import CompassStatusView from "../components/steadier/CompassStatusView";
import WeeklyReviewFlow from "../components/steadier/WeeklyReviewFlow";
import CompassMapView from "../components/steadier/CompassMapView";
import MapItemPage from "../components/steadier/MapItemPage";
import PillarsGoalsView from "../components/steadier/PillarsGoalsView";
import {
  TaskListContext,
  PlacesContext,
} from "../components/steadier/OrphanUI";
import {
  addSubtask,
  childrenOf,
  completeTaskTree,
  confirmTaskParent,
  openSubtasks,
  parentOf,
  rejectTaskParent,
  removeTaskAndReleaseChildren,
} from "../domain/subtasks";
import { clearNextThingForTask } from "../domain/nextThing";
import {
  applyTaskAutosaveToWorkspace,
  applyTaskDraftToWorkspace,
  autosaveSyncAdvanced,
  isServerConfirmedAutosave,
  taskDraftChanged,
  taskMatchesExpectedSnapshot,
  type PendingTaskAutosave,
  type TaskAutosaveCloudState,
  type TaskAutosaveSaveResult,
} from "../domain/taskAutosave";
import { linkAssetWearLogTask } from "../domain/assets";
import { setRoutineChecklistItem } from "../domain/routineRunner";
import {
  appendEvidenceEntry,
  createEvidenceId,
  removeEvidenceEntry,
  type EvidenceInput,
} from "../domain/evidence";
import {
  saveSiteCard as saveSiteCardRecord,
  setSiteCardStatus as setSiteCardStatusRecord,
  type SiteCardInput,
} from "../domain/siteCards";
import { chainsForProject, describeWhy, mapGaps } from "../domain/goals";
import { createStatusMarkData } from "../domain/statusMarkColor";
import { applyAppearance, persistAppearance, readAppearance, type Appearance } from "../domain/appearance";
import { MOBILE_QUICK_NAV_IDS } from "../domain/mobileQuickNavigation";
import { PILLAR_SLOTS, pillarStrip } from "../domain/pillarStrip";
import { buildCalendar } from "../domain/calendarModel";
import {
  commandCentreReadAloudText,
  commandCentreSnapshot,
  confirmActiveImperative,
} from "../domain/commandCentre";
import { latestWeeklyReviewDate } from "../domain/review";
import {
  adelaideClock,
  flexibleCompletionNote,
  focusPlanForTask,
  formatCompactDuration,
  formatDuration,
  formatTime,
  minutesToTime,
  slotMinutes,
  timeToMinutes,
} from "../domain/time";
import {
  CompassStrip,
  ReviewDueBanner,
  UnplacedPanel,
} from "../components/steadier/CompassPanels";
import TimeReview from "../components/steadier/TimeReview";
import { describeRepeat } from "../domain/time";
import RemindersPanel from "../components/steadier/RemindersPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  CircleDot,
  ListTodo,
  RefreshCw,
  Clock3,
  CalendarDays,
  FileText,
  Cloud,
  CloudSun,
  Map as MapIcon,
  Layers3,
  CheckCheck,
  ClipboardCheck,
  FlaskConical,
  Plus,
  Mic,
  Search,
  Volume2,
  Square,
  ArrowRight,
  Undo2,
  ShieldCheck,
  MoreVertical,
  X,
  Table2,
  MapPin,
  BookOpen,
  History,
  Activity,
  Globe,
  ShoppingCart,
  Package,
  Users,
} from "lucide-react";
import NearMeView from "../components/steadier/NearMeView";
import { useLocationReminders } from "../hooks/useLocationReminders";
import { placesOf } from "../domain/places";
import { toast } from "sonner";
import { useSharedWorkspace } from "../hooks/useSharedWorkspace";
import { useVoice } from "../hooks/useVoice";
import {
  attention,
  completeTask,
  reopenTaskOccurrence,
  updateTask,
  derivedState,
  today,
  addDays,
  repeatRuleOf,
} from "../domain/engine";
import type { Context, Task, View, Workspace } from "../domain/types";
import AttentionView from "../components/steadier/AttentionView";
import WorkViews from "../components/steadier/WorkViews";
import TaskEditor from "../components/steadier/TaskEditor";
import CaptureDialog from "../components/steadier/CaptureDialog";
import FocusDialog from "../components/steadier/FocusDialog";
import SettingsView from "../components/steadier/SettingsView";
import LifeView from "../components/steadier/LifeView";
import TodayFrame from "../components/steadier/TodayFrame";
import TodayNow from "../components/steadier/TodayNow";
import { TaskKindContext } from "../components/steadier/TaskStates";
import AppearanceToggle from "../components/steadier/AppearanceToggle";
import {
  IntentionBar,
  IntentionDialog,
  ReanchorDialog,
  RiskBanner,
  StatusMarker,
  TodayInfo,
  systemRisk,
} from "../components/steadier/TodayHeader";
import { PillarStrip } from "../components/steadier/PillarStrip";
import { kindContext } from "../domain/todayStates";
import { confirmPlacement } from "../domain/compass";
import { orphanReport } from "../domain/orphans";
import {
  hasTaskTimingCommitment,
  taskTimingChanged,
} from "../domain/timingShape";
import { adelaideTimestamp } from "../../../shared/time";
import {
  estimateAnchorFinish,
  setWorkspaceNextThing,
  poolTasks,
  recordNotNow,
  markStillOn,
  markDropped,
  reconsiderDropped,
} from "../domain/anchorPlanning";
import BackupPanel from "../components/steadier/BackupPanel";
import SharedDataPanel from "../components/steadier/SharedDataPanel";
import SheetView from "../components/steadier/SheetView";
import SharedStartupGate from "../components/steadier/SharedStartupGate";
import ObligationsView from "../components/steadier/ObligationsView";
import DailyLogView from "../components/steadier/DailyLogView";
import DecisionLogView from "../components/steadier/DecisionLogView";
import EvidenceFeedView from "../components/steadier/EvidenceFeedView";
import SiteCardsView from "../components/steadier/SiteCardsView";
import ShoppingListsView from "../components/steadier/ShoppingListsView";
import AssetsView from "../components/steadier/AssetsView";
import WorkPipelineView from "../components/steadier/WorkPipelineView";
import RoutineRunnerView from "../components/steadier/RoutineRunnerView";
import YearWheelView from "../components/steadier/YearWheelView";
import MoveEnergyView, {
  MoveFloorTodayCard,
} from "../components/steadier/MoveEnergyView";
import WeatherView from "../components/steadier/WeatherView";
import PeopleView from "../components/steadier/PeopleView";
import CredentialRenewalsView from "../components/steadier/CredentialRenewalsView";
import InvoicesView from "../components/steadier/InvoicesView";
import CommandCentreView from "../components/steadier/CommandCentreView";
import PageNavigation from "../components/steadier/PageNavigation";
const nav: { id: View; title: string; Icon: typeof CircleDot }[] = [
  { id: "attention", title: "My life today", Icon: CircleDot },
  { id: "command-centre", title: "Command Centre", Icon: ClipboardCheck },
  { id: "all", title: "All work", Icon: ListTodo },
  { id: "calendar", title: "Calendar", Icon: CalendarDays },
  { id: "review", title: "Review due / unplaced", Icon: RefreshCw },
  { id: "near", title: "Near me", Icon: MapPin },
  { id: "areas", title: "Life areas", Icon: Layers3 },
  { id: "imperatives", title: "Imperatives", Icon: Compass },
  { id: "compass-view", title: "Compass view", Icon: Compass },
  { id: "waiting", title: "Waiting & blocked", Icon: Clock3 },
  { id: "projects", title: "Project Outcomes", Icon: Layers3 },
  { id: "weekly", title: "Weekly Reality Review", Icon: RefreshCw },
  { id: "progress", title: "Completed steps", Icon: CheckCheck },
  { id: "matrix", title: "My life matrix", Icon: CircleDot },
  { id: "map", title: "Compass map", Icon: MapIcon },
  { id: "compass-directory", title: "Pillars & Goals", Icon: Layers3 },
  { id: "time", title: "Time / plans", Icon: Clock3 },
  { id: "settings", title: "Backups & trial", Icon: ShieldCheck },
  { id: "cloud", title: "Server & Compass", Icon: Cloud },
  { id: "sheet", title: "Server sheet", Icon: Table2 },
  { id: "obligations", title: "Obligations", Icon: FileText },
  { id: "journal", title: "Notes / Daily Log", Icon: BookOpen },
  { id: "decisions", title: "Decision Log", Icon: History },
  { id: "evidence", title: "Evidence Feed", Icon: Activity },
  { id: "sites", title: "Site Cards", Icon: Globe },
  { id: "shopping", title: "Shopping Lists", Icon: ShoppingCart },
  { id: "assets", title: "Assets & Wear Logs", Icon: Package },
  { id: "pipeline", title: "Work Pipeline", Icon: Layers3 },
  { id: "routine", title: "Routine Runner", Icon: RefreshCw },
  { id: "yearWheel", title: "Year Wheel", Icon: CalendarDays },
  { id: "moveEnergy", title: "Move & Energy", Icon: Activity },
  { id: "weather", title: "Weather / Forecast", Icon: CloudSun },
  { id: "people", title: "People & Follow-ups", Icon: Users },
  {
    id: "credentialRenewals",
    title: "Credential renewal dates",
    Icon: CalendarDays,
  },
  { id: "invoices", title: "Invoices", Icon: FileText },
];
const mobileQuickNav = MOBILE_QUICK_NAV_IDS.map(
  id => nav.find(item => item.id === id)!
);
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export default function Home() {
  const store = useSharedWorkspace();
  const storeRef = useRef(store);
  storeRef.current = store;
  const pendingAutosavesRef = useRef(new Map<string, PendingTaskAutosave>());
  const autosaveSequenceRef = useRef(0);
  const autosaveWashTimerRef = useRef<number | null>(null);
  const [autosaveWashId, setAutosaveWashId] = useState(0);
  const autosaveCloud: TaskAutosaveCloudState = {
    active: store.cloud.active,
    status: store.cloud.status,
    pending: store.cloud.pending,
    revision: store.cloud.revision,
    lastSyncedAt: store.cloud.lastSyncedAt,
  };
  const taskAutosaveResult = (
    task: Task,
    cloudAtWrite: TaskAutosaveCloudState,
    triggerWash = true
  ): TaskAutosaveSaveResult => {
    if (!cloudAtWrite.active)
      return { accepted: true, task, serverPending: false, ticket: null };
    const ticket: PendingTaskAutosave = {
      token: ++autosaveSequenceRef.current,
      task,
      baseRevision: cloudAtWrite.revision,
      baseLastSyncedAt: cloudAtWrite.lastSyncedAt,
    };
    if (triggerWash) pendingAutosavesRef.current.set(task.id, ticket);
    return { accepted: true, task, serverPending: true, ticket };
  };
  useEffect(() => {
    if (
      !store.cloud.active ||
      store.cloud.status !== "synced" ||
      store.cloud.pending
    )
      return;
    const cloud: TaskAutosaveCloudState = {
      active: store.cloud.active,
      status: store.cloud.status,
      pending: store.cloud.pending,
      revision: store.cloud.revision,
      lastSyncedAt: store.cloud.lastSyncedAt,
    };
    let confirmed = false;
    for (const [taskId, ticket] of pendingAutosavesRef.current) {
      const currentTask = store.workspace.tasks.find(task => task.id === taskId);
      if (isServerConfirmedAutosave(ticket, cloud, currentTask)) {
        pendingAutosavesRef.current.delete(taskId);
        confirmed = true;
      } else if (autosaveSyncAdvanced(ticket, cloud)) {
        // A newer or server-selected version won; do not celebrate a stale draft.
        pendingAutosavesRef.current.delete(taskId);
      }
    }
    if (!confirmed) return;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;
    setAutosaveWashId(current => {
      const next = current + 1;
      if (autosaveWashTimerRef.current !== null)
        window.clearTimeout(autosaveWashTimerRef.current);
      autosaveWashTimerRef.current = window.setTimeout(() => {
        setAutosaveWashId(value => (value === next ? 0 : value));
        autosaveWashTimerRef.current = null;
      }, 480);
      return next;
    });
  }, [
    store.cloud.active,
    store.cloud.lastSyncedAt,
    store.cloud.pending,
    store.cloud.revision,
    store.cloud.status,
    store.workspace,
  ]);
  useEffect(
    () => () => {
      if (autosaveWashTimerRef.current !== null)
        window.clearTimeout(autosaveWashTimerRef.current);
    },
    []
  );
  const commandCentreRefreshWaitersRef = useRef<Array<{
    revision: number;
    lastSyncedAt: string | null;
    status: string;
    resolve: () => void;
  }>>([]);
  useEffect(() => {
    const remaining: typeof commandCentreRefreshWaitersRef.current = [];
    for (const waiter of commandCentreRefreshWaitersRef.current) {
      if (
        store.cloud.revision !== waiter.revision ||
        store.cloud.lastSyncedAt !== waiter.lastSyncedAt ||
        store.cloud.status !== waiter.status
      ) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    commandCentreRefreshWaitersRef.current = remaining;
  }, [store.cloud.revision, store.cloud.lastSyncedAt, store.cloud.status]);
  const voice = useVoice();
  const consentTicket = new URLSearchParams(window.location.search).get(
    "compass_oauth"
  );
  const isConsent =
    !!consentTicket && /^[A-Za-z0-9_-]{32,128}$/.test(consentTicket);
  const [view, setView] = useState<View>("attention");
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());
  const [context, setContext] = useState<Context>("anywhere");
  const [minutes, setMinutes] = useState(0);
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [taskPanelMode, setTaskPanelMode] = useState<"view" | "edit">("view");
  const [orphanOpen, setOrphanOpen] = useState(false);
  // Today redesign (v2.8): Today / Overview switch, intention editor, re-anchor.
  const [todayTab, setTodayTab] = useState<"today" | "overview">("today");
  const [intentionOpen, setIntentionOpen] = useState<false | "type" | "listen">(
    false
  );
  const [reanchorOpen, setReanchorOpen] = useState(false);
  const [capture, setCapture] = useState(false);
  const [captureProjectId, setCaptureProjectId] = useState("");
  const [captureInitialText, setCaptureInitialText] = useState("");
  const [captureInitialNotes, setCaptureInitialNotes] = useState("");
  const [captureManualReviewOnly, setCaptureManualReviewOnly] = useState(false);
  const [captureAssetSource, setCaptureAssetSource] = useState<{
    assetId: string;
    logId: string;
  } | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [screenMenu, setScreenMenu] = useState<"app" | "page" | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const calendarReadRef = useRef<(() => void) | null>(null);
  const lastScreenVoiceError = useRef("");
  // Compass map pages have their own address (#map/<id>) so the phone back
  // button moves between them and an item can be referred to by link.
  const [mapItem, setMapItem] = useState<string | null>(null);
  const [addPillarPending, setAddPillarPending] = useState(false);
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);
  const [focusImperativeId, setFocusImperativeId] = useState<string | null>(
    null
  );
  const [focusObligationId, setFocusObligationId] = useState<string | null>(
    null
  );
  const viewBeforeMap = useRef<View>("attention");
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const tasks = store.workspace.tasks;
  const selectedTask = editing
    ? tasks.find(task => task.id === editing.id) ?? editing
    : null;
  const openTaskView = (task: Task) => {
    setEditing(task);
    setTaskPanelMode("view");
  };
  const openTaskEditor = (task: Task) => {
    setEditing(task);
    setTaskPanelMode("edit");
  };
  const closeTaskPanel = () => {
    setEditing(null);
    setTaskPanelMode("view");
  };
  const v2Screen = view === "calendar" || view === "attention";
  const v2Page = view === "calendar" ? "calendar" : "today";
  const changeAppearance = (next: Appearance) => {
    setAppearance(next);
    persistAppearance(next);
    applyAppearance(document.documentElement, next);
  };
  const focused = tasks.find(t => t.id === store.workspace.focus?.taskId);
  useEffect(() => {
    if (!v2Screen || !voice.error || lastScreenVoiceError.current === voice.error) return;
    lastScreenVoiceError.current = voice.error;
    toast.error(voice.error, { duration: 3200 });
  }, [v2Screen, voice.error]);
  useEffect(() => {
    if (!mobileMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenu(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenu]);
  const navigate = (v: View) => {
    if (v === "map") {
      if (viewRef.current !== "map") viewBeforeMap.current = viewRef.current;
      if (window.location.hash !== "#map") window.location.hash = "map";
      setMapItem(null);
    } else if (window.location.hash.startsWith("#map")) {
      // Leave the map with a new history entry so Back returns to the page.
      window.history.pushState(
        null,
        "",
        window.location.pathname + window.location.search
      );
      setMapItem(null);
    }
    if (v !== "obligations") setFocusObligationId(null);
    setView(v);
    setSearch("");
    setArea("");
    setFilter("");
    setMobileMenu(false);
    setScreenMenu(null);
  };
  const openGoal = (id: string) => {
    if (viewRef.current !== "map") viewBeforeMap.current = viewRef.current;
    if (window.location.hash !== `#map/${id}`)
      window.location.hash = `map/${id}`;
    setView("map");
    setMapItem(id);
    setMobileMenu(false);
  };
  const openProjectById = (id: string) => {
    setFocusProjectId(id);
    navigate("projects");
  };
  const openImperativeById = (id: string) => {
    setFocusImperativeId(id);
    navigate("imperatives");
  };
  const openObligationById = (id: string) => {
    navigate("obligations");
    setFocusObligationId(id);
  };
  useEffect(() => {
    const sync = () => {
      const m = /^#map(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(
        window.location.hash
      );
      if (m) {
        if (viewRef.current !== "map") viewBeforeMap.current = viewRef.current;
        setView("map");
        setMapItem(m[1] ?? null);
        setMobileMenu(false);
      } else if (viewRef.current === "map") {
        setMapItem(null);
        setView(
          viewBeforeMap.current === "map" ? "attention" : viewBeforeMap.current
        );
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const openAll = (f = "") => {
    navigate("all");
    setFilter(f);
  };
  useEffect(() => {
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const onNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
    };
  }, []);
  // Derived dates should refresh if the app remains open across local midnight.
  const [, setClock] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setClock(n => n + 1), 60000);
    return () => clearInterval(i);
  }, []);
  const now = today();
  const todayCalendar = useMemo(
    () => buildCalendar(tasks, store.workspace.projects, [now], now)[0],
    [tasks, store.workspace.projects, now]
  );
  const todayPillarCount = pillarStrip(store.workspace, now).slots.filter(
    slot => slot.kind === "pillar"
  ).length;
  const topbarDate = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date()).replace(/,/g, "");
  const lastSyncedLabel = store.cloud.lastSyncedAt
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Adelaide",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(store.cloud.lastSyncedAt))
    : "";
  const topbarConnectionText = !online || store.cloud.status === "offline"
    ? `Offline${lastSyncedLabel ? ` · synced ${lastSyncedLabel}` : ""}`
    : !store.cloud.active
      ? "Local only"
      : store.cloud.status === "synced"
        ? `Connected · synced ${lastSyncedLabel || "just now"}`
        : store.cloud.status === "saving"
          ? `Saving${lastSyncedLabel ? ` · synced ${lastSyncedLabel}` : ""}`
          : store.cloud.status === "loading"
            ? "Connecting"
              : store.cloud.status === "conflict"
                ? "Needs review"
                : "Connection issue";
  const topbarSyncText = !online || store.cloud.status === "offline"
    ? `Offline · ${lastSyncedLabel ? `synced ${lastSyncedLabel}` : "not synced yet"}`
    : !store.cloud.active
      ? "Local only"
      : store.cloud.status === "synced"
        ? `synced ${lastSyncedLabel || "just now"}`
        : store.cloud.status === "saving"
          ? `saving${lastSyncedLabel ? ` · synced ${lastSyncedLabel}` : ""}`
          : store.cloud.status === "loading"
            ? "connecting"
            : store.cloud.status === "conflict"
              ? "needs review"
              : "connection issue";
  const topbarConnectionTone = !online || store.cloud.status === "offline"
    ? "offline"
    : store.cloud.active && store.cloud.status === "synced"
      ? "connected"
      : store.cloud.status === "saving"
        ? "saving"
        : "offline";
  const liveResult = useMemo(
    () =>
      attention(tasks, {
        context,
        minutes,
        now,
        matrixWeights: store.workspace.matrixWeights,
      }),
    [tasks, context, minutes, now, store.workspace.matrixWeights]
  );
  // One of four states per open task, shared by every screen (display only).
  const kinds = useMemo(
    () => kindContext(store.workspace, liveResult, now),
    [store.workspace, liveResult, now]
  );
  const statusMarkData = useMemo(
    () => ({
      ...createStatusMarkData({
        projects: store.workspace.projects,
        goals: store.workspace.goals,
        imperatives: store.workspace.imperatives,
      }),
      lastWeeklyReviewDate: latestWeeklyReviewDate({
        reviews: store.workspace.reviews,
        trial: store.workspace.trial,
      }),
    }),
    [
      store.workspace.projects,
      store.workspace.goals,
      store.workspace.imperatives,
      store.workspace.reviews,
      store.workspace.trial.lastReviewAt,
    ]
  );
  const kindValue = useMemo(
    () => ({ ctx: kinds, tasks, statusMarkData, appearance }),
    [kinds, tasks, statusMarkData, appearance]
  );
  // Reopening with work in progress: land on the Now card.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || store.readOnly || !focused) return;
    landed.current = true;
    if (viewRef.current !== "attention") return;
    window.setTimeout(
      () =>
        document
          .getElementById("today-now")
          ?.scrollIntoView({ block: "start" }),
      120
    );
  }, [focused, store.readOnly]);
  useFocusTones(
    store.workspace.focus,
    focused ?? null,
    !!store.canTickFocus && !store.cloud.remoteFocus,
    voice
  );
  useFocusTimeLog(
    store.workspace.focus,
    !!store.canTickFocus && !store.cloud.remoteFocus,
    !!focused && focused.state !== "done",
    store.mutate
  );
  useReminders(tasks, voice, taskId => {
    const task = store.workspace.tasks.find(t => t.id === taskId);
    if (task) openTaskView(task);
  });
  // Location reminders while open (v2.7); off until switched on in Near me.
  const location = useLocationReminders(
    placesOf(store.workspace),
    tasks,
    voice,
    taskId => {
      const task = store.workspace.tasks.find(t => t.id === taskId);
      if (task) openTaskView(task);
    }
  );
  const [manualPlaceId, setManualPlaceId] = useState<string | null>(null);
  useEffect(() => {
    const focus = store.workspace.focus;
    const generation = store.generation;
    if (isConsent || !focus?.running || !focused || !store.canTickFocus) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - focus.updatedAt) / 1000);
      if (elapsed < 1) return;
      const remaining = Math.max(0, focus.remaining - elapsed);
      store.saveFocus(
        {
          ...focus,
          remaining,
          running: remaining > 0,
          updatedAt: Date.now(),
        },
        generation
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    store.workspace.focus,
    focused,
    store.saveFocus,
    store.generation,
    store.canTickFocus,
    isConsent,
  ]);
  const allowed = () => {
    if (store.readOnly) {
      toast.error(
        store.cloud.active
          ? "Shared data is loading or needs recovery. Open Server & Compass before changing it."
          : "This saved workspace could not be read. It is protected from overwrite."
      );
      return false;
    }
    return true;
  };
  const saveEvidence = (input: EvidenceInput): boolean => {
    if (!allowed()) return false;
    const id = createEvidenceId();
    const accepted = store.mutate(w =>
      appendEvidenceEntry(w, input, adelaideTimestamp(), id)
    );
    if (!accepted) {
      toast.error("Evidence was not saved. Check sync and try again.");
      return false;
    }
    toast.success("Evidence saved to this workspace.");
    return true;
  };
  const deleteEvidence = (id: string): boolean => {
    if (!allowed()) return false;
    const accepted = store.mutate(w => removeEvidenceEntry(w, id));
    if (!accepted) {
      toast.error("Evidence was not deleted. Check sync and try again.");
      return false;
    }
    return true;
  };
  const saveSiteCard = (input: SiteCardInput, id: string | null): boolean => {
    if (!allowed()) return false;
    const accepted = store.mutate(w =>
      saveSiteCardRecord(w, input, id, adelaideTimestamp())
    );
    if (!accepted) {
      toast.error("Site card was not saved. Check sync and try again.");
      return false;
    }
    toast.success(id ? "Site card updated." : "Site card saved.");
    return true;
  };
  const changeSiteCardStatus = (
    id: string,
    status: "active" | "archived"
  ): boolean => {
    if (!allowed()) return false;
    const accepted = store.mutate(w =>
      setSiteCardStatusRecord(w, id, status, adelaideTimestamp())
    );
    if (!accepted) {
      toast.error("Site card status was not saved. Check sync and try again.");
      return false;
    }
    return true;
  };
  const toggleRoutineChecklist = (
    taskId: string,
    itemId: string,
    checked: boolean
  ): boolean => {
    if (!allowed()) return false;
    let changed = false;
    const accepted = store.mutate(w => {
      const nextTasks = setRoutineChecklistItem(
        w.tasks,
        taskId,
        itemId,
        checked
      );
      if (nextTasks === w.tasks) return w;
      changed = true;
      return { ...w, tasks: nextTasks };
    });
    if (!accepted || !changed) {
      toast.error("Routine step was not saved. Check sync and try again.");
      return false;
    }
    return true;
  };
  const updateSuggestedSubtask = (
    id: string,
    expectedParentId: string,
    action: "confirm" | "dismiss"
  ): boolean => {
    if (!allowed()) return false;
    let changed = false;
    const accepted = store.mutate(w => {
      const child = w.tasks.find(task => task.id === id);
      if (
        !child?.parent?.suggested ||
        child.parent.id !== expectedParentId ||
        !w.tasks.some(task => task.id === expectedParentId)
      )
        return w;
      const nextTasks = action === "confirm"
        ? confirmTaskParent(w.tasks, id)
        : rejectTaskParent(w.tasks, id);
      if (nextTasks === w.tasks) return w;
      changed = true;
      return { ...w, tasks: nextTasks };
    });
    if (!accepted || !changed) {
      toast.error("This suggestion changed or was not saved. Reopen the task view and check sync.");
      return false;
    }
    toast.success(
      action === "confirm"
        ? "Suggested subtask confirmed."
        : "Suggestion dismissed; the task remains in All work."
    );
    return true;
  };
  const confirmAllSuggestedSubtasks = (parentId: string): boolean => {
    if (!allowed()) return false;
    let confirmed = 0;
    const accepted = store.mutate(w => {
      if (!w.tasks.some(task => task.id === parentId)) return w;
      const pending = childrenOf(w.tasks, parentId).filter(
        child => child.parent?.suggested
      );
      if (!pending.length) return w;
      const nextTasks = pending.reduce(
        (current, child) => confirmTaskParent(current, child.id),
        w.tasks
      );
      if (nextTasks === w.tasks) return w;
      confirmed = pending.length;
      return { ...w, tasks: nextTasks };
    });
    if (!accepted || !confirmed) {
      toast.error("No pending subtask suggestions were confirmed. Reopen the task view and check sync.");
      return false;
    }
    toast.success(`Confirmed ${confirmed} suggested subtask${confirmed === 1 ? "" : "s"}.`);
    return true;
  };
  const requestFocusHere = () => store.cloud.takeFocusHere();
  const reopenDoneTask = (id: string) => {
    if (!allowed()) return false;
    const current = storeRef.current.workspace.tasks.find(task => task.id === id);
    if (!current || current.state !== "done") {
      toast.error("This task is no longer marked done. Refresh the task view and check sync.");
      return false;
    }
    let reopened = false;
    const accepted = store.mutate(workspace => {
      const nextTasks = reopenTaskOccurrence(workspace.tasks, id);
      if (nextTasks === workspace.tasks) return workspace;
      reopened = true;
      return { ...workspace, tasks: nextTasks };
    });
    if (!accepted || !reopened) {
      toast.error("The task was not reopened. It remains done; check sync and try again.");
      return false;
    }
    toast.success(
      repeatRuleOf(current)
        ? "This occurrence is open again. Its next occurrence remains scheduled."
        : "Task reopened."
    );
    return true;
  };
  const done = (
    id: string,
    updated?: Task,
    stayOpen = false,
    completeOnly = false
  ) => {
    if (!allowed()) return false;
    const task = updated || tasks.find(t => t.id === id);
    if (!task || task.state === "done") return false;
    const openBelow = openSubtasks(store.workspace.tasks, id);
    let finishSubtasks = false;
    if (openBelow.length && !completeOnly) {
      const prompt = `“${task.title}” has ${openBelow.length} open subtask${openBelow.length === 1 ? "" : "s"}.\n\nOK: finish ${openBelow.length === 1 ? "it" : "them"} too.\nCancel: finish only this task and keep the subtasks open.`;
      voice.read(
        `${task.title} has ${openBelow.length} open subtask${openBelow.length === 1 ? "" : "s"}. Finish them too?`
      );
      finishSubtasks = window.confirm(prompt);
    }
    if (updated && editing?.id === id) {
      const current = store.workspace.tasks.find(t => t.id === id);
      if (JSON.stringify(current) !== JSON.stringify(editing)) {
        toast.error(
          "This responsibility changed while its draft was open. Keep or copy your draft, then reopen the updated version."
        );
        return false;
      }
    }
    const completedAt = adelaideTimestamp();
    const windowNote = flexibleCompletionNote(
      task.schedule,
      completedAt.slice(0, 10)
    );
    const accepted = store.mutate(w => {
      const nextTasks = completeTaskTree(
        updated
          ? w.tasks.map(t =>
              t.id === id
                ? updateTask(t, updated, "Saved completion evidence")
                : t
            )
          : w.tasks,
        id,
        finishSubtasks
      );
      const focusedAfter = w.focus
        ? nextTasks.find(t => t.id === w.focus?.taskId)
        : undefined;
      const selectedNext = w.nextThing?.taskId
        ? nextTasks.find(t => t.id === w.nextThing?.taskId)
        : undefined;
      const keepTimer = Boolean(
        w.focus?.continueAfterDone && focusedAfter?.state === "done"
      );
      return {
        ...w,
        tasks: nextTasks,
        nextThing:
          w.nextThing?.taskId === id || selectedNext?.state === "done"
            ? null
            : w.nextThing ?? null,
        projects: w.projects.map(p =>
          p.id === task.projectId
            ? {
                ...p,
                updatedAt: completedAt,
                progress: [
                  ...p.progress,
                  {
                    at: completedAt,
                    text:
                      (task.progressEvidence ||
                        `Completed step: ${task.title}`) +
                      (windowNote?.status === "late"
                        ? " (completed late, after its window closed)"
                        : ""),
                  },
                ],
              }
            : p
        ),
        focus:
          focusedAfter?.state === "done" && !keepTimer
            ? null
            : w.focus ?? null,
      };
    });
    if (!accepted) {
      toast.error(
        "This change was not saved. Check sync or take focus explicitly on this device first."
      );
      return false;
    }
    if (store.workspace.focus?.taskId === id) {
      setFocusOpen(!!store.workspace.focus.continueAfterDone);
    }
    if (!stayOpen) setEditing(null);
    // Finished the last open subtask: gently offer to finish the parent.
    const parent = parentOf(store.workspace.tasks, task);
    if (
      parent &&
      parent.state !== "done" &&
      openSubtasks(store.workspace.tasks, parent.id).length === 0
    ) {
      voice.read(`Every subtask of ${parent.title} is done. Finish it too?`);
      toast.success(`Every subtask of “${parent.title}” is done.`, {
        action: { label: "Finish it", onClick: () => done(parent.id) },
        duration: 10000,
      });
      return true;
    }
    if (windowNote) {
      toast.success(
        windowNote.status === "late"
          ? `Marked done (completed late). ${repeatRuleOf(task) ? "Next one created." : ""}`.trim()
          : `Marked done for this window. ${repeatRuleOf(task) ? "Next one created." : ""}`.trim(),
        {
          action: {
            label: "Undo",
            onClick: () => {
              if (!store.canUndo) return;
              store.undo();
              toast("Last change undone.");
            },
          },
          duration: 10000,
        }
      );
      return true;
    }
    toast.success(
      task && repeatRuleOf(task)
        ? `Completed. Next one: ${describeRepeat(repeatRuleOf(task)).toLowerCase()}.`
        : finishSubtasks
          ? `Completed with ${openBelow.length} subtask${openBelow.length === 1 ? "" : "s"}.`
          : "One responsibility moved forward."
    );
    return true;
  };
  const commandCentreWorkspaceFor = async (
    kind: "task" | "project" | "imperative",
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number,
    writeRequired = false
  ): Promise<Workspace | null> => {
    let current = storeRef.current;
    if (writeRequired && current.readOnly) {
      allowed();
      return null;
    }
    if (current.cloud.active) {
      const previousRevision = current.cloud.revision;
      const previousLastSyncedAt = current.cloud.lastSyncedAt;
      const previousStatus = current.cloud.status;
      const refreshed = await current.cloud.retry();
      if (!refreshed) {
        toast.error(
          "I couldn't refresh Steadier, so this check-in wasn't changed. Check sync and try again."
        );
        return null;
      }
      // Wait for the hook's post-refresh render before checking the question's
      // revision and updatedAt; do not rely on a guessed timeout.
      current = storeRef.current;
      if (
        current.cloud.revision === previousRevision &&
        current.cloud.lastSyncedAt === previousLastSyncedAt &&
        current.cloud.status === previousStatus
      ) {
        await new Promise<void>(resolve => {
          commandCentreRefreshWaitersRef.current.push({
            revision: previousRevision,
            lastSyncedAt: previousLastSyncedAt,
            status: previousStatus,
            resolve,
          });
        });
        current = storeRef.current;
      }
    }
    if (current.cloud.revision !== expectedRevision) {
      toast.message(
        "Steadier changed since this question was shown. The workspace is refreshed; review the current item before answering."
      );
      return null;
    }
    if (writeRequired && current.cloud.pending) {
      toast.message(
        "A Steadier change is still syncing. Nothing was changed here; wait for sync and tap again."
      );
      return null;
    }
    const record =
      kind === "task"
        ? current.workspace.tasks.find(item => item.id === id)
        : kind === "project"
          ? current.workspace.projects.find(item => item.id === id)
          : current.workspace.imperatives.find(item => item.id === id);
    if (!record || record.updatedAt !== expectedUpdatedAt) {
      toast.message(
        "This item changed after the check-in was built. Steadier has refreshed; review the latest version before answering."
      );
      if (current.cloud.active) void current.cloud.retry();
      return null;
    }
    return current.workspace;
  };
  const commandCentreOpenTask = async (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ): Promise<boolean> => {
    const workspace = await commandCentreWorkspaceFor(
      "task",
      id,
      expectedUpdatedAt,
      expectedRevision
    );
    const task = workspace?.tasks.find(item => item.id === id);
    if (!task) return false;
    openTaskView(task);
    return true;
  };
  const commandCentreCompleteTask = async (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ): Promise<boolean> => {
    const workspace = await commandCentreWorkspaceFor(
      "task",
      id,
      expectedUpdatedAt,
      expectedRevision,
      true
    );
    const task = workspace?.tasks.find(item => item.id === id);
    if (!task || task.state === "done") return false;
    return done(task.id);
  };
  const commandCentreOpenProject = async (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ): Promise<boolean> => {
    const workspace = await commandCentreWorkspaceFor(
      "project",
      id,
      expectedUpdatedAt,
      expectedRevision
    );
    if (!workspace?.projects.some(item => item.id === id)) return false;
    openProjectById(id);
    return true;
  };
  const commandCentreOpenImperative = async (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ): Promise<boolean> => {
    const workspace = await commandCentreWorkspaceFor(
      "imperative",
      id,
      expectedUpdatedAt,
      expectedRevision
    );
    if (!workspace?.imperatives.some(item => item.id === id)) return false;
    openImperativeById(id);
    return true;
  };
  const commandCentreConfirmImperative = async (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ): Promise<boolean> => {
    const workspace = await commandCentreWorkspaceFor(
      "imperative",
      id,
      expectedUpdatedAt,
      expectedRevision,
      true
    );
    const imperative = workspace?.imperatives.find(item => item.id === id);
    if (!imperative || imperative.status !== "active") {
      toast.message("That Imperative is no longer Active; refresh and review it.");
      return false;
    }
    const current = storeRef.current;
    if (current.cloud.revision !== expectedRevision || current.readOnly || current.cloud.pending) {
      toast.message("Steadier changed before the confirmation could be saved. Refresh and try again.");
      if (current.cloud.active) void current.cloud.retry();
      return false;
    }
    const stamp = adelaideTimestamp();
    let changed = false;
    const accepted = current.mutate(w => {
      const next = confirmActiveImperative(w, id, expectedUpdatedAt, stamp);
      changed = next !== w;
      return next;
    });
    if (accepted === false || !changed) {
      toast.error("That confirmation wasn't saved. Steadier will refresh; review it and try again.");
      if (current.cloud.active) void current.cloud.retry();
      return false;
    }
    toast.success(`Confirmed Active: ${imperative.title}.`);
    return true;
  };
  // Finished early: the block is shortened to end now, then completed.
  // Repeating tasks keep their usual length for the next occurrence.
  const finishEarly = (task: Task) => {
    if (!allowed()) return false;
    const clock = adelaideClock();
    const s = task.schedule;
    if (s.time && s.date === clock.date && !repeatRuleOf(task)) {
      const startAt = timeToMinutes(s.time);
      const used = Math.max(5, clock.minutes - startAt);
      if (used < slotMinutes(task)) {
        const ok = store.mutate(w => ({
          ...w,
          tasks: w.tasks.map(t =>
            t.id === task.id
              ? updateTask(
                  t,
                  { schedule: { ...t.schedule, minutes: used } },
                  `Finished early: block shortened to end at ${formatTime(minutesToTime(startAt + used))}`
                )
              : t
          ),
        }));
        if (ok === false) {
          toast.error("That was not saved. Check sync and try again.");
          return false;
        }
      }
    }
    return done(task.id);
  };
  // The owner confirms a suggested home (from Steadier, Claude or ChatGPT).
  const confirmHome = (task: Task) => {
    if (!allowed()) return;
    const stamp = adelaideTimestamp();
    const ok = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === task.id
          ? {
              ...confirmPlacement(t),
              updatedAt: stamp,
              history: [
                ...t.history,
                { at: stamp, text: "Confirmed the suggested placement." },
              ],
            }
          : t
      ),
    }));
    if (ok === false)
      toast.error("That was not saved. Check sync and try again.");
    else toast.success(`Confirmed: ${task.title}.`);
  };
  const chooseNextThing = (
    taskId: string,
    when: string,
    doAction: string
  ): boolean => {
    if (!allowed()) return false;
    const cleanWhen = when.trim();
    const cleanDo = doAction.trim();
    if (!cleanWhen || cleanWhen.length > 300 || !cleanDo || cleanDo.length > 500) {
      toast.error("Add a short WHEN trigger and one small physical DO action.");
      return false;
    }
    const stamp = adelaideTimestamp();
    let error = "";
    const accepted = store.mutate(w => {
      const task = w.tasks.find(item => item.id === taskId);
      if (
        !task ||
        !poolTasks(w.tasks, today(), adelaideClock().minutes).some(item => item.id === taskId)
      ) {
        error = "That task is no longer available in the pool.";
        return w;
      }
      const needsTaskUpdate =
        task.nextAction.trim() !== cleanDo || task.state === "inbox";
      const nextTasks = !needsTaskUpdate
        ? w.tasks
        : w.tasks.map(item =>
            item.id === taskId
              ? updateTask(
                  item,
                  {
                    nextAction: cleanDo,
                    ...(item.state === "inbox" ? { state: "ready" as const } : {}),
                  },
                  "Set the small DO action for today's Next thing"
                )
              : item
          );
      const next = setWorkspaceNextThing(
        { ...w, tasks: nextTasks },
        taskId,
        cleanWhen,
        today(),
        stamp
      );
      if (next === w) error = "That task could not be selected as today's Next thing.";
      return next;
    });
    if (!accepted || error) {
      toast.error(error || "That choice was not saved. Check sync and try again.");
      return false;
    }
    toast.success("Next thing saved. The task remains untimed.");
    return true;
  };
  const notNow = (taskId: string): boolean => {
    if (!allowed()) return false;
    const stamp = adelaideTimestamp();
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(task => task.id === taskId ? recordNotNow(task, stamp) : task),
      nextThing: w.nextThing?.taskId === taskId ? null : w.nextThing,
      focus: w.focus?.taskId === taskId ? null : w.focus,
    }));
    if (!accepted) {
      toast.error("That task was not returned to the pool. Check sync and try again.");
      return false;
    }
    setFocusOpen(false);
    toast("Returned to the untimed pool. No penalty.");
    return true;
  };
  const stillOn = (taskId: string): boolean => {
    if (!allowed()) return false;
    const stamp = adelaideTimestamp();
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(task => task.id === taskId ? markStillOn(task, stamp) : task),
    }));
    if (!accepted) {
      toast.error("That decision was not saved. Check sync and try again.");
      return false;
    }
    toast.success("Still on. Pass-over count reset.");
    return true;
  };
  const dropFromPool = (taskId: string): boolean => {
    if (!allowed()) return false;
    const stamp = adelaideTimestamp();
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(task => task.id === taskId ? markDropped(task, stamp) : task),
      nextThing: w.nextThing?.taskId === taskId ? null : w.nextThing,
      focus: w.focus?.taskId === taskId ? null : w.focus,
    }));
    if (!accepted) {
      toast.error("The Dropped decision was not saved. Check sync and try again.");
      return false;
    }
    setFocusOpen(false);
    toast.success("Dropped — kept in All Work, not deleted.");
    return true;
  };
  const reopenDropped = (taskId: string): boolean => {
    if (!allowed()) return false;
    const stamp = adelaideTimestamp();
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(task => task.id === taskId ? reconsiderDropped(task, stamp) : task),
    }));
    if (!accepted) {
      toast.error("That decision was not reopened. Check sync and try again.");
      return false;
    }
    toast.success("Task returned to the untimed pool.");
    return true;
  };
  const newSubtask = (parentId: string, title: string): string | null => {
    if (!allowed()) return "Not saved.";
    let error: string | null = null;
    const accepted = store.mutate(w => {
      const r = addSubtask(w.tasks, parentId, title);
      error = r.error;
      return r.error ? w : { ...w, tasks: r.tasks };
    });
    if (error) return error;
    if (!accepted)
      return "That subtask was not saved. Check sync and try again.";
    toast.success(`Subtask added: ${title.trim()}.`);
    return null;
  };
  const deleteSubtask = (id: string): boolean => {
    if (!allowed()) return false;
    const stamp = adelaideTimestamp();
    let removedTitle: string | null = null;
    let removedWasFocused = false;
    const accepted = store.mutate(w => {
      const result = removeTaskAndReleaseChildren(w.tasks, id, stamp);
      if (!result.removed || result.removed.parent?.id !== editing?.id) return w;
      removedTitle = result.removed.title;
      removedWasFocused = w.focus?.taskId === id;
      return clearNextThingForTask({
        ...w,
        tasks: result.tasks,
        focus: removedWasFocused ? null : w.focus,
        intention:
          w.intention?.taskId === id
            ? { ...w.intention, taskId: null }
            : w.intention,
      }, id);
    });
    if (!accepted) {
      toast.error("The subtask was not deleted. Check sync and try again.");
      return false;
    }
    if (!removedTitle) {
      toast.error("That subtask is no longer in this task's Subtasks list.");
      return false;
    }
    if (removedWasFocused) setFocusOpen(false);
    toast.success(`Deleted subtask: ${removedTitle}.`);
    return true;
  };
  const defer = (id: string) => {
    if (!allowed()) return false;
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === id
          ? updateTask(
              t,
              { deferredUntil: addDays(today(), 1) },
              "Set aside until tomorrow"
            )
          : t
      ),
      focus: w.focus?.taskId === id ? null : w.focus,
    }));
    if (!accepted) {
      toast.error(
        "This change was not saved. Check sync or take focus explicitly on this device first."
      );
      return false;
    }
    setFocusOpen(false);
    toast("Set aside until tomorrow. Still visible in All work.");
    return true;
  };
  const start = (
    task: Task,
    silent = false,
    bookedDurationMinutes?: number,
    automaticBookedStart = false
  ): boolean => {
    if (!allowed()) return false;
    if (store.cloud.remoteFocus) {
      if (!silent) {
        toast(
          "Focus is running on another device. Take it here explicitly before changing the focused task."
        );
        setFocusOpen(true);
      }
      return false;
    }
    if (derivedState(task, tasks) !== "ready") {
      if (!silent) openTaskView(task);
      return false;
    }
    const existingFocus = store.workspace.focus;
    if (
      existingFocus?.taskId !== task.id ||
      (automaticBookedStart &&
        (!existingFocus.running || existingFocus.remaining <= 0))
    ) {
      const plan = focusPlanForTask(task);
      const duration = (bookedDurationMinutes ?? plan.durationMinutes) * 60;
      const accepted = store.saveFocus({
        taskId: task.id,
        remaining: duration,
        duration,
        running: true,
        updatedAt: Date.now(),
        step: task.nextAction,
        continueAfterDone:
          bookedDurationMinutes !== undefined || plan.continueAfterDone,
      });
      if (!accepted) {
        if (!silent) {
          toast.error(
            "Focus was not started. Check sync or take focus explicitly first."
          );
        }
        return false;
      }
    }
    setFocusOpen(true);
    return true;
  };
  useCalendarFocusAutostart({
    tasks,
    projects: store.workspace.projects ?? [],
    focus: store.workspace.focus,
    enabled: !isConsent && !store.readOnly,
    canStart: !!store.canTickFocus,
    remoteFocus: !!store.cloud.remoteFocus,
    onStart: (task, durationMinutes) =>
      start(task, true, durationMinutes, true),
  });
  const openCapture = (
    listen = false,
    projectId = "",
    initialText = "",
    initialNotes = "",
    manualReviewOnly = false,
    assetSource: { assetId: string; logId: string } | null = null
  ) => {
    setCaptureProjectId(projectId);
    setCaptureInitialText(initialText);
    setCaptureInitialNotes(initialNotes);
    setCaptureManualReviewOnly(manualReviewOnly);
    setCaptureAssetSource(assetSource);
    voice.clear();
    setCapture(true);
    setFocusOpen(false);
    if (listen) voice.start();
  };
  const openNoteAsTask = (sourceNote: string) => {
    const firstLine = sourceNote.trim().split(/\r?\n/)[0]?.trim() || "";
    const suggestion =
      firstLine.length > 160
        ? `${firstLine.slice(0, 157).trimEnd()}…`
        : firstLine;
    openCapture(false, "", suggestion || "Task from note", sourceNote, true);
  };
  const openAssetLogAsTask = (
    assetId: string,
    logId: string,
    sourceText: string
  ) => {
    const asset = store.workspace.assets?.find(item => item.id === assetId);
    const log = asset?.wearLogs.find(item => item.id === logId);
    if (!asset || !log) {
      toast.error(
        "That Asset log changed. Refresh the view before proposing a Task."
      );
      return;
    }
    const linkedTask = log.taskId
      ? store.workspace.tasks.find(task => task.id === log.taskId)
      : undefined;
    if (linkedTask) {
      openTaskView(linkedTask);
      return;
    }
    const firstLine = sourceText.trim().split(/\r?\n/)[0]?.trim() || "";
    const suggestion =
      firstLine.length > 160
        ? `${firstLine.slice(0, 157).trimEnd()}…`
        : firstLine;
    const linkedProjectId =
      asset.projectId &&
      store.workspace.projects.some(project => project.id === asset.projectId)
        ? asset.projectId
        : "";
    openCapture(
      false,
      linkedProjectId,
      suggestion || `Follow up on ${asset.name}`,
      sourceText,
      true,
      { assetId, logId }
    );
  };
  const saveTaskDraft = (
    draft: Task,
    baseline: Task,
    autosave: boolean
  ): TaskAutosaveSaveResult => {
    const currentStore = storeRef.current;
    if (currentStore.readOnly)
      return {
        accepted: false,
        reason: "blocked",
        message: "Not saved. This workspace is read-only or still recovering.",
      };
    const cloudAtWrite: TaskAutosaveCloudState = {
      active: currentStore.cloud.active,
      status: currentStore.cloud.status,
      pending: currentStore.cloud.pending,
      revision: currentStore.cloud.revision,
      lastSyncedAt: currentStore.cloud.lastSyncedAt,
    };
    let failure: Extract<TaskAutosaveSaveResult, { accepted: false }> | null =
      null;
    const acceptedWorkspaceRef: { current: Workspace | null } = {
      current: null,
    };
    const accepted = currentStore.mutate(
      workspace => {
        const current = workspace.tasks.find(task => task.id === baseline.id);
        const notes = [
          current ? parentChangeNote(workspace.tasks, current, draft) : null,
          current &&
          hasTaskTimingCommitment(current) &&
          taskTimingChanged(current, draft)
            ? "Rescheduled task timing."
            : null,
        ].filter((note): note is string => Boolean(note));
        const applied = applyTaskDraftToWorkspace(
          workspace,
          baseline,
          draft,
          notes.join(" ") ||
            (autosave
              ? "Autosaved task details."
              : "Updated responsibility and next step.")
        );
        if (!applied.accepted) {
          failure = {
            accepted: false,
            reason: applied.reason,
            message: applied.message,
          };
          return workspace;
        }
        return applied.workspace;
      },
      workspace => {
        acceptedWorkspaceRef.current = workspace;
      }
    );
    if (failure) return failure;
    const acceptedWorkspace = acceptedWorkspaceRef.current;
    if (!accepted || !acceptedWorkspace) {
      return {
        accepted: false,
        reason: "blocked",
        message:
          currentStore.cloud.status === "conflict"
            ? "Not saved. Resolve the shared-workspace conflict before trying again; your draft is preserved."
            : currentStore.cloud.error ||
              "Not saved. Check sync/storage and try again; your draft remains open.",
      };
    }
    const savedTask = acceptedWorkspace.tasks.find(
      task => task.id === baseline.id
    );
    if (!savedTask)
      return {
        accepted: false,
        reason: "blocked",
        message: "Not saved. The accepted task snapshot could not be confirmed.",
      };
    setEditing(savedTask);
    if (autosave) return taskAutosaveResult(savedTask, cloudAtWrite);
    return {
      accepted: true,
      task: savedTask,
      serverPending: false,
      ticket: null,
    };
  };
  const saveCapturedTask = (
    task: Task,
    announce = false,
    autosave = false,
    baseline: Task | null = null,
    returnServerResult = false
  ): TaskAutosaveSaveResult | boolean => {
    if (storeRef.current.readOnly) {
      if (!autosave) allowed();
      return autosave
        ? {
            accepted: false as const,
            reason: "blocked" as const,
            message: "Not saved. This workspace is read-only or still recovering.",
          }
        : false;
    }
    const cloudAtWrite: TaskAutosaveCloudState = {
      active: storeRef.current.cloud.active,
      status: storeRef.current.cloud.status,
      pending: storeRef.current.cloud.pending,
      revision: storeRef.current.cloud.revision,
      lastSyncedAt: storeRef.current.cloud.lastSyncedAt,
    };
    const currentWorkspace = storeRef.current.workspace;
    const currentTask = currentWorkspace.tasks.find(item => item.id === task.id);
    if (
      baseline &&
      taskMatchesExpectedSnapshot(currentTask, baseline) &&
      !taskDraftChanged(task, baseline) &&
      !captureAssetSource
    ) {
      if (autosave || returnServerResult) {
        const ticket = pendingAutosavesRef.current.get(task.id) ?? null;
        if (
          !ticket &&
          cloudAtWrite.active &&
          (cloudAtWrite.status !== "synced" || cloudAtWrite.pending)
        )
          return {
            accepted: false,
            reason: "blocked",
            message:
              "Not saved. The shared workspace has not confirmed the current task yet; keep this draft open and check sync.",
          };
        return {
          accepted: true,
          task: baseline,
          serverPending: Boolean(ticket),
          ticket,
        };
      }
      return true;
    }
    const acceptedWorkspaceRef: { current: Workspace | null } = {
      current: null,
    };
    const failureRef: {
      current: Extract<TaskAutosaveSaveResult, { accepted: false }> | null;
    } = { current: null };
    let assetLinkFailure = false;
    const accepted = storeRef.current.mutate(w => {
      const applied = applyTaskAutosaveToWorkspace(
        w,
        baseline,
        task,
        autosave ? "Autosaved captured task details." : "Saved captured task."
      );
      if (!applied.accepted) {
        failureRef.current = {
          accepted: false,
          reason: applied.reason,
          message: applied.message,
        };
        return w;
      }
      let next = applied.workspace;
      if (captureAssetSource) {
        const log = w.assets
          ?.find(asset => asset.id === captureAssetSource.assetId)
          ?.wearLogs.find(item => item.id === captureAssetSource.logId);
        if (
          !log ||
          (log.taskId &&
            log.taskId !== task.id &&
            w.tasks.some(item => item.id === log.taskId))
        ) {
          assetLinkFailure = true;
          failureRef.current = {
            accepted: false,
            reason: "stale",
            message:
              "The Asset log changed while the draft was open. No task was saved; review the current log and try again.",
          };
          return w;
        }
        next = linkAssetWearLogTask(
          next,
          captureAssetSource.assetId,
          captureAssetSource.logId,
          task.id,
          adelaideTimestamp()
        );
        const linked = next.assets
          ?.find(asset => asset.id === captureAssetSource.assetId)
          ?.wearLogs.some(
            item =>
              item.id === captureAssetSource.logId && item.taskId === task.id
          );
        if (!linked) {
          assetLinkFailure = true;
          failureRef.current = {
            accepted: false,
            reason: "stale",
            message:
              "The Asset log could not be linked safely. No task was saved; review the current log and try again.",
          };
          return w;
        }
      }
      return next;
    }, workspace => {
      acceptedWorkspaceRef.current = workspace;
    });
    if (!accepted || assetLinkFailure) {
      const failure = failureRef.current;
      const message = failure?.message ?? (assetLinkFailure
        ? "The Asset log changed while the draft was open. No task was saved; review the current log and try again."
        : storeRef.current.cloud.status === "conflict"
          ? "Not saved. Resolve the shared-workspace conflict before trying again; your draft is preserved."
          : storeRef.current.cloud.error ||
            "Capture was not saved. Keep the draft open and check sync/storage.");
      if (announce)
        toast.error(
          message
        );
      return autosave
        ? {
            accepted: false as const,
            reason: failure?.reason ?? (assetLinkFailure ? ("stale" as const) : ("blocked" as const)),
            message,
          }
        : returnServerResult
          ? {
              accepted: false as const,
              reason: failure?.reason ?? (assetLinkFailure ? ("stale" as const) : ("blocked" as const)),
              message,
            }
          : false;
    }
    if (captureAssetSource) setCaptureAssetSource(null);
    if (announce)
      toast.success(
        task.nextAction
          ? "Captured with a clear next step."
          : "Captured. It can be clarified in Review."
      );
    if (autosave || returnServerResult) {
      const savedTask =
        acceptedWorkspaceRef.current?.tasks.find(item => item.id === task.id) ??
        storeRef.current.workspace.tasks.find(item => item.id === task.id);
      if (!savedTask)
        return {
          accepted: false as const,
          reason: "blocked" as const,
          message: "Not saved. The accepted capture snapshot could not be confirmed.",
        };
      return taskAutosaveResult(savedTask, cloudAtWrite, autosave);
    }
    return true;
  };
  // A plain explanation shown beside "Save today's intention" when saving is
  // paused, so a refused save is never silent.
  const intentionBlockedReason = store.cloud.active
    ? store.cloud.status === "loading"
      ? "Your shared space is still connecting. Wait a moment, then tap save again."
      : store.cloud.status === "conflict"
        ? "Another device changed your shared space. Choose which version to keep under Server & Compass, then save."
        : store.cloud.status === "error"
          ? `Your shared space needs reconnecting${store.cloud.error ? `: ${store.cloud.error}` : "."} Tap Retry connection, or sign in again under Server & Compass.`
          : store.cloud.remoteFocus
            ? "Another device owns the running focus session. Take focus here first, then save."
            : "The shared space did not accept this change. Tap Retry connection, then save again."
    : store.readOnly
      ? "This saved space could not be read, so it is protected from changes. Open Backups & trial to recover it."
      : "This browser could not store the change, often because private browsing or storage is blocked. Download a backup under Backups & trial before closing.";
  const todaySummaryText = () => {
    const count = liveResult.commitments.length;
    const intention =
      store.workspace.intention?.date === today()
        ? `Your chosen intention: ${store.workspace.intention.text}. `
        : "";
    return `${intention}${liveResult.outstandingCount} responsibilities are held here. ${count ? `${count} approaching or passed commitments. ` : "Nothing time critical. "}${liveResult.items.length} suggestions. ${liveResult.items.map(i => `${i.task.title}. ${i.reason}. Next step: ${i.task.nextAction || "Choose one small next step."}`).join(" ")} The rest remains in your collection.`;
  };
  const v2TodaySummaryText = () => {
    const clock = adelaideClock();
    const eligible = poolTasks(tasks, now, clock.minutes);
    const selected = store.workspace.nextThing?.date === now
      ? eligible.find(task => task.id === store.workspace.nextThing?.taskId)
      : undefined;
    const parent = selected ? parentOf(tasks, selected) : undefined;
    const anchors = todayCalendar.timed
      .filter(item => item.fixed && item.kind !== "deadline")
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const anchorText = anchors.length
      ? anchors.map(item => `${item.title} at ${formatTime(minutesToTime(item.start ?? 0))} for ${formatCompactDuration(item.minutes ?? 0)}`).join("; ")
      : "no timed booked anchors";
    const selectedText = selected
      ? `Next thing: when ${store.workspace.nextThing?.when || "no trigger set"}; do ${selected.nextAction || "no action set"}; for ${parent?.title || selected.title}.`
      : "No Next thing is selected.";
    const last = anchors[anchors.length - 1];
    const allDay = todayCalendar.allDay.some(item => item.fixed);
    const lastTask = last?.taskId ? tasks.find(task => task.id === last.taskId) : undefined;
    const estimate = lastTask ? estimateAnchorFinish(lastTask, tasks) : null;
    const plannedEnd = last ? (last.start ?? 0) + (last.minutes ?? 0) : timeToMinutes(store.workspace.planning?.dayStart ?? "07:00");
    const finish = allDay ? timeToMinutes(store.workspace.planning?.dayEnd ?? "18:00") : Math.max(plannedEnd, estimate?.likelyEnd ?? plannedEnd);
    const freeAfter = Math.max(0, timeToMinutes(store.workspace.planning?.dayEnd ?? "18:00") - finish);
    const freeText = allDay ? "No clock capacity remains after an all-day booked anchor." : `Free after ${last?.title ?? "now"}: ${formatCompactDuration(freeAfter)}.`;
    return `${TODAY_GUIDE} Booked anchors: ${anchorText}. ${selectedText} Pool: ${eligible.filter(task => task.id !== selected?.id).length} untimed tasks. ${freeText} Pillars: ${todayPillarCount} of ${PILLAR_SLOTS} set.`;
  };
  const readOutLoud = (text: string) => {
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    if (!voice.speechSupported) {
      toast.error("Read-aloud is not available in this browser.", { duration: 3200 });
      return;
    }
    voice.read(text);
  };
  const summary = () => {
    if (voice.speaking) voice.stopSpeaking();
    else if (view === "command-centre")
      readOutLoud(commandCentreReadAloudText(commandCentreSnapshot(store.workspace)));
    else voice.read(todaySummaryText());
  };
  const readCurrentScreen = () => {
    if (v2Page === "calendar") {
      if (voice.speaking) voice.stopSpeaking();
      else if (!voice.speechSupported) {
        toast.error("Read-aloud is not available in this browser.", { duration: 3200 });
      } else if (calendarReadRef.current) calendarReadRef.current();
      else readOutLoud(CALENDAR_GUIDE);
      return;
    }
    readOutLoud(todayTab === "overview" ? todaySummaryText() : v2TodaySummaryText());
  };
  const review = (id: string) => {
    if (!allowed()) return;
    const accepted = store.mutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === id
          ? updateTask(
              t,
              { reviewDate: addDays(today(), 7) },
              "Reviewed; next check-in in seven days"
            )
          : t
      ),
    }));
    if (!accepted) {
      toast.error(
        "This change was not saved. Check sync or take focus explicitly on this device first."
      );
      return false;
    }
    toast("Reviewed, not completed. Next check-in in seven days.");
  };
  const changeWorkspace = (kind: "demo" | "personal") => {
    voice.abort();
    voice.stopSpeaking();
    closeTaskPanel();
    setCapture(false);
    setFocusOpen(false);
    store.switchKind(kind);
    navigate("attention");
  };
  if (isConsent && consentTicket) {
    return (
      <ClaudeConsent
        ticket={consentTicket}
        onRead={voice.read}
        onStopReading={voice.stopSpeaking}
      />
    );
  }
  if (store.cloud.startupBlocked) {
    return (
      <SharedStartupGate
        store={store}
        onRead={voice.read}
        onStopReading={voice.stopSpeaking}
      />
    );
  }
  const risk = systemRisk({
    personal: store.kind === "personal",
    hasData: tasks.length > 0 || store.workspace.projects.length > 0,
    lastExportAt: store.workspace.trial.lastExportAt,
    cloudActive: store.cloud.active,
    status: store.cloud.status,
    storageError: store.storageError,
  });
  // What the Now card shows: a block in progress, focus, chosen, suggested.
  const nowClock = adelaideClock();
  const nowBlock = tasks.find(
    t =>
      t.state !== "done" &&
      t.schedule.date === nowClock.date &&
      t.schedule.time &&
      timeToMinutes(t.schedule.time) <= nowClock.minutes &&
      timeToMinutes(t.schedule.time) + slotMinutes(t) > nowClock.minutes
  );
  const intentionTask =
    store.workspace.intention?.date === now
      ? tasks.find(
          t => t.id === store.workspace.intention?.taskId && t.state !== "done"
        )
      : undefined;
  const nowTask =
    nowBlock ?? focused ?? intentionTask ?? liveResult.items[0]?.task;
  const nowIds = nowTask ? [nowTask.id] : [];
  return (
    <TaskListContext.Provider value={tasks}>
      <TaskKindContext.Provider value={kindValue}>
        <PlacesContext.Provider value={placesOf(store.workspace)}>
          <div className={`app-shell${v2Screen ? " v2-shell" : ""}`}>
            {autosaveWashId > 0 && (
              <div
                key={autosaveWashId}
                className="autosave-confirmation-wash"
                aria-hidden="true"
              />
            )}
            <a className="skip-link" href="#main-content">
              Skip to attention
            </a>
            {mobileMenu && (
              <button
                type="button"
                className="mobile-nav-scrim"
                aria-label="Close My Life navigation"
                onClick={() => setMobileMenu(false)}
              />
            )}
            <aside
              id="my-life-navigation"
              className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}
              aria-label="My Life navigation"
              role={mobileMenu ? "dialog" : undefined}
              aria-modal={mobileMenu ? true : undefined}
            >
              <div className="sidebar-mobile-header">
                <strong>My Life · All pages</strong>
                <button
                  type="button"
                  className="sidebar-mobile-close"
                  aria-label="Close My Life navigation"
                  onClick={() => setMobileMenu(false)}
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>
              <a className="wordmark" href="/" aria-label="Steadier home">
                <img src="/icon.svg" alt="" />
                <span>
                  steadier<span className="wordmark-period">.</span>
                </span>
              </a>
              <div className="sidebar-tagline">
                A little less noise.
                <br />A little more direction.
              </div>
              <PageNavigation
                items={nav}
                active={view}
                outstandingCount={liveResult.outstandingCount}
                reviewCount={liveResult.reviewDue.length}
                onNavigate={nextView => {
                  navigate(nextView);
                  setMobileMenu(false);
                }}
                onSpeakTask={() => {
                  setMobileMenu(false);
                  openCapture(true);
                }}
              />
              <div className="sidebar-bottom">
                {v2Screen && (
                  <button
                    type="button"
                    className="nav-item sidebar-app-options"
                    onClick={() => {
                      setMobileMenu(false);
                      setScreenMenu("app");
                    }}
                  >
                    <MoreVertical size={18} aria-hidden="true" />
                    <span>App options</span>
                  </button>
                )}
                <div className="sidebar-appearance"><AppearanceToggle appearance={appearance} onChange={changeAppearance} /></div>
                <div className="sidebar-philosophy">
                  <span className="tiny-orbit" />
                  <p>
                    You don't need to do everything.
                    <br />
                    <strong>Just the next right thing.</strong>
                  </p>
                </div>
                <button
                  className="workspace-switch"
                  onClick={() =>
                    changeWorkspace(store.kind === "demo" ? "personal" : "demo")
                  }
                >
                  <span className="workspace-avatar">
                    {store.kind === "demo" ? "S" : "P"}
                  </span>
                  <span>
                    <strong>
                      {store.kind === "demo"
                        ? "Sample workspace"
                        : "My personal space"}
                    </strong>
                    <span>
                      {store.kind === "demo"
                        ? "Explore safely"
                        : store.cloud.active
                          ? `Server · ${store.cloud.status}`
                          : "Saved on this browser"}
                    </span>
                  </span>
                  <RefreshCw size={14} />
                </button>
              </div>
            </aside>
            <div className="main-shell">
              <header className={`topbar${v2Screen ? " v2-topbar" : ""}`}>
                {v2Screen ? (
                  <>
                    <MyLifeNavigationButton
                      expanded={mobileMenu}
                      onToggle={() => setMobileMenu(value => !value)}
                    />
                    <div className="v2-topbar-center" aria-live="polite">
                      <strong>{view === "calendar" ? "Calendar" : "Today"}</strong>
                      <span className={`v2-sync-status ${topbarConnectionTone}`}>
                        <span>{topbarDate}</span><span aria-hidden="true"> · </span><i aria-hidden="true" />
                        <span>{topbarSyncText}</span>
                      </span>
                    </div>
                    <div className="v2-topbar-actions">
                      {view === "attention" && (
                        <button
                          className="icon-button v2-mic-button"
                          aria-label="Speak"
                          onClick={() => openCapture(true)}
                        >
                          <Mic size={19} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        className="icon-button v2-page-menu-button"
                        aria-label="Open This page menu"
                        onClick={() => setScreenMenu("page")}
                      >
                        <MoreVertical size={21} aria-hidden="true" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <MyLifeNavigationButton
                      expanded={mobileMenu}
                      onToggle={() => setMobileMenu(value => !value)}
                    />
                    <div className="breadcrumb">
                      {view === "all" ? (
                        <strong>{nav.find(n => n.id === view)?.title}</strong>
                      ) : (
                        <>
                          My life<span>/</span>
                          <strong>{nav.find(n => n.id === view)?.title}</strong>
                        </>
                      )}
                    </div>
                    <div className="topbar-actions">
                      <div className="topbar-appearance"><AppearanceToggle appearance={appearance} onChange={changeAppearance} /></div>
                      <OrphanPill
                        workspace={store.workspace}
                        onOpen={() => setOrphanOpen(true)}
                        compact
                      />
                      {!risk && (
                        <StatusMarker
                          demo={store.kind === "demo"}
                          cloudActive={store.cloud.active}
                          status={store.cloud.status}
                          pending={!!store.cloud.pending}
                          onOpen={() => navigate("cloud")}
                        />
                      )}
                      <button
                        className="icon-button search-button"
                        aria-label="Search all work"
                        onClick={() => {
                          navigate("all");
                          setTimeout(
                            () => document.querySelector<HTMLInputElement>(".library-search input")?.focus(),
                            0
                          );
                        }}
                      >
                        <Search size={19} />
                      </button>
                      <button className="button secondary voice-top" onClick={() => openCapture(true)}>
                        <Mic size={16} /><span>Speak</span>
                      </button>
                      <button className="button primary capture-top" onClick={() => openCapture()}>
                        <Plus size={17} /><span>Capture</span>
                      </button>
                    </div>
                  </>
                )}
              </header>
              <main
                id="main-content"
                tabIndex={-1}
                className={`main-content${v2Screen ? " v2-main-content" : ""}`}
              >
                {risk && (
                  <RiskBanner
                    risk={risk}
                    onAct={() =>
                      navigate(risk.kind === "sync" ? "cloud" : "settings")
                    }
                  />
                )}
                {!online && !v2Screen && (
                  <div className="notice small">
                    You are offline. Browser edits may remain pending; they are
                    not visible to the server or Compass until sync is
                    confirmed. Voice recognition may need a connection.
                  </div>
                )}
                {focused && store.workspace.focus && !(v2Screen && (view === "calendar" || todayTab === "today")) && (
                  <div className="resume-strip">
                    <span className="tiny-orbit" />
                    <div>
                      <strong>
                        {focused.state === "done"
                          ? `Complete: ${focused.title}`
                          : `Your place is saved: ${focused.title}`}
                      </strong>
                      <span>
                        {focused.state === "done"
                          ? store.workspace.focus.running
                            ? "The scheduled timer continues; remaining time is not logged as task work."
                            : store.workspace.focus.remaining === 0
                              ? "The timebox has ended."
                              : "The timer is paused; the task stays complete."
                          : store.workspace.focus.step}
                      </span>
                    </div>
                    {store.cloud.active &&
                      store.workspace.focus.running &&
                      !store.canTickFocus && (
                        <button
                          className="button secondary small-button"
                          onClick={() => {
                            requestFocusHere();
                            setFocusOpen(true);
                          }}
                        >
                          Take focus on this device
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => setFocusOpen(true)}
                    >
                      Return to focus
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {view === "attention" && !v2Screen && (
                  <IntentionBar
                    workspace={store.workspace}
                    day={now}
                    readOnly={store.readOnly}
                    onEdit={listen =>
                      setIntentionOpen(listen ? "listen" : "type")
                    }
                    onReanchor={() => setReanchorOpen(true)}
                  />
                )}
                {!v2Screen && <div className="page-utility">
                  <span className="utility-date">
                    {new Date().toLocaleDateString("en-AU", {
                      timeZone: "Australia/Adelaide",
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                  <div>
                    {voice.speaking ? (
                      <button
                        className="text-button"
                        onClick={voice.stopSpeaking}
                      >
                        <Square size={15} />
                        Stop reading
                      </button>
                    ) : (
                      <button className="text-button" onClick={summary}>
                        <Volume2 size={16} />
                        <span className="utility-label">Read aloud</span>
                      </button>
                    )}
                    {store.canUndo && (
                      <button
                        className="text-button"
                        onClick={() => {
                          store.undo();
                          toast("Last change undone.");
                        }}
                      >
                        <Undo2 size={15} />
                        Undo
                      </button>
                    )}
                  </div>
                </div>}
                {voice.error && !capture && !v2Screen && (
                  <p className="error small" role="alert">
                    {voice.error}
                  </p>
                )}
                {view === "attention" && (
                  <TodayViewSwitch
                    value={todayTab}
                    onChange={tab => {
                      setTodayTab(tab);
                      window.scrollTo({ top: 0 });
                    }}
                  />
                )}
                {view === "review" && (
                  <h1 className="page-purpose-heading">Review due / unplaced</h1>
                )}
                <PagePurposeNote view={view} />
                {view === "attention" && todayTab === "overview" && (
                  <OrphanBanner
                    workspace={store.workspace}
                    onOpen={() => setOrphanOpen(true)}
                    onRead={voice.read}
                  />
                )}
                {view === "attention" && todayTab === "overview" && (
                  <CompassStrip
                    workspace={store.workspace}
                    onOpenImperatives={() => navigate("imperatives")}
                    onOpenUnplaced={() => setOrphanOpen(true)}
                    onOpenReview={() => navigate("weekly")}
                    onOpenMap={() => navigate("map")}
                    mapGapCount={
                      mapGaps(store.workspace, adelaideClock().date).length
                    }
                    onRead={voice.read}
                  />
                )}
                {view === "attention" && todayTab === "today" && (
                  <div className="v2-today-card-stack">
                    <TodayNextThing
                      workspace={store.workspace}
                      tasks={tasks}
                      day={now}
                      minute={adelaideClock().minutes}
                      readOnly={store.readOnly}
                      onChoose={chooseNextThing}
                      onDone={done}
                      onNotNow={notNow}
                      onStillOn={stillOn}
                      onDrop={dropFromPool}
                      onOpenPastDue={() => openAll("pastdue")}
                      afterNextThing={
                        <TodayVisualTimeline
                          tasks={tasks}
                          projects={store.workspace.projects}
                          planning={store.workspace.planning}
                          syncStatus={
                            !store.cloud.active
                              ? "local"
                              : store.cloud.status === "synced" ||
                                  store.cloud.status === "saving" ||
                                  store.cloud.status === "loading" ||
                                  store.cloud.status === "offline" ||
                                  store.cloud.status === "conflict"
                                ? store.cloud.status
                                : "error"
                          }
                          lastSyncedAt={store.cloud.lastSyncedAt}
                          pendingSync={!!store.cloud.pending}
                          online={online}
                          onCalendar={() => navigate("calendar")}
                          onOpenTask={openTaskView}
                          onRead={voice.read}
                        />
                      }
                    />
                    <V2FoldableCard
                      title="Pillars"
                      count={`${todayPillarCount} of ${PILLAR_SLOTS} set`}
                      storageKey="today-pillars"
                      defaultOpen={false}
                      className="v2-pillars-card"
                    >
                      <PillarStrip
                        workspace={store.workspace}
                        today={now}
                        readOnly={store.readOnly}
                        onOpenGoal={openGoal}
                        onAddPillar={() => {
                          setAddPillarPending(true);
                          navigate("map");
                        }}
                        onOpenMap={() => navigate("map")}
                        onRead={voice.read}
                        todayV2
                      />
                    </V2FoldableCard>
                  </div>
                )}
                {view === "attention" && todayTab === "overview" && (
                  <>
                    <TodayNow
                      workspace={store.workspace}
                      tasks={tasks}
                      result={liveResult}
                      orphanCount={orphanReport(tasks).count}
                      readOnly={store.readOnly}
                      onDone={id => done(id)}
                      onNotNow={notNow}
                      onStart={start}
                      onOpenFocus={() => setFocusOpen(true)}
                      onFinishedEarly={finishEarly}
                      onOpen={openTaskView}
                      onConfirmPlacement={confirmHome}
                      onOpenOrphans={() => setOrphanOpen(true)}
                      onReview={() => navigate("review")}
                      onCommitments={() => openAll("commitments")}
                      onCalendar={() => navigate("calendar")}
                      onImperatives={() => navigate("imperatives")}
                    />
                    <ClaudeChangesPanel store={store} voice={voice} compact />
                    <MoveFloorTodayCard day={now} onOpen={() => navigate("moveEnergy")} />
                  </>
                )}
                {view === "review" && (
                  <ReviewDueBanner
                    workspace={store.workspace}
                    onStart={() => navigate("weekly")}
                  />
                )}
                {view === "review" && (
                  <UnplacedPanel
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    onRead={voice.read}
                    readOnly={store.readOnly}
                  />
                )}
                {view === "attention" && todayTab === "today" && (
                  <MoveFloorTodayCard
                    day={now}
                    onOpen={() => navigate("moveEnergy")}
                  />
                )}
                {view === "attention" && todayTab === "overview" ? (
                  <AttentionView
                    tasks={tasks}
                    projects={store.workspace.projects}
                    part="overview"
                    excludeIds={nowIds}
                    onProjects={() => navigate("projects")}
                    result={liveResult}
                    context={context}
                    minutes={minutes}
                    onContext={setContext}
                    onMinutes={setMinutes}
                    onOpen={openTaskView}
                    onStart={start}
                    onDone={done}
                    onDefer={defer}
                    onArea={a => {
                      navigate("areas");
                      setArea(a);
                    }}
                    onAll={openAll}
                    onReview={() => navigate("review")}
                    onWaiting={() => navigate("waiting")}
                  />
                ) : view === "time" ? (
                  <TimeReview
                    tasks={tasks}
                    projects={store.workspace.projects}
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    readOnly={store.readOnly}
                  />
                ) : view === "map" && mapItem ? (
                  <MapItemPage
                    workspace={store.workspace}
                    goalId={mapItem}
                    onMutate={store.mutate}
                    onOpenGoal={openGoal}
                    onOpenProject={openProjectById}
                    onOpenImperatives={() => navigate("imperatives")}
                    onBack={() =>
                      navigate(
                        viewBeforeMap.current === "compass-directory"
                          ? "compass-directory"
                          : "map"
                      )
                    }
                    backLabel={
                      viewBeforeMap.current === "compass-directory"
                        ? "Pillars & Goals"
                        : "Compass map"
                    }
                    voice={voice}
                    readOnly={store.readOnly}
                  />
                ) : view === "map" ? (
                  <CompassMapView
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    onOpenProject={p => openProjectById(p.id)}
                    onOpenGoal={openGoal}
                    onOpenImperatives={() => navigate("imperatives")}
                    onOpenCompassView={() => navigate("compass-view")}
                    voice={voice}
                    readOnly={store.readOnly}
                    addPillarPending={addPillarPending}
                    onAddPillarHandled={() => setAddPillarPending(false)}
                  />
                ) : view === "compass-directory" ? (
                  <PillarsGoalsView
                    workspace={store.workspace}
                    onOpenGoal={openGoal}
                    onOpenMap={() => navigate("map")}
                    voice={voice}
                  />
                ) : view === "weekly" ? (
                  <WeeklyReviewFlow
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    onDone={() => navigate("attention")}
                    onOpenMap={() => navigate("map")}
                    voice={voice}
                    readOnly={store.readOnly}
                  />
                ) : view === "command-centre" ? (
                  <CommandCentreView
                    workspace={store.workspace}
                    revision={store.cloud.revision}
                    readOnly={store.readOnly}
                    lastSyncedAt={store.cloud.lastSyncedAt}
                    dataSource={
                      store.cloud.active
                        ? `Steadier server · ${store.cloud.status}`
                        : store.kind === "demo"
                          ? "Sample workspace · this browser"
                        : "Personal workspace · this browser"
                    }
                    onConfirmImperative={commandCentreConfirmImperative}
                    onOpenTask={commandCentreOpenTask}
                    onCompleteTask={commandCentreCompleteTask}
                    onOpenProject={commandCentreOpenProject}
                    onOpenImperative={commandCentreOpenImperative}
                    onOpenCalendar={() => navigate("calendar")}
                    onOpenReview={() => navigate("weekly")}
                    onOpenObligation={openObligationById}
                    onOpenPeople={() => navigate("people")}
                    onOpenCredentialRenewals={() => navigate("credentialRenewals")}
                  />
                ) : view === "near" ? (
                  <NearMeView
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    location={location}
                    manualPlaceId={manualPlaceId}
                    onManualPlace={setManualPlaceId}
                    voice={voice}
                    readOnly={store.readOnly}
                  />
                ) : view === "compass-view" ? (
                  <CompassStatusView
                    workspace={store.workspace}
                    onOpenProject={openProjectById}
                    onOpenImperative={openImperativeById}
                    onRead={voice.read}
                  />
                ) : view === "imperatives" ? (
                  <ImperativesView
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    onOpenGoal={openGoal}
                    onRead={voice.read}
                    readOnly={store.readOnly}
                    focusId={focusImperativeId}
                    onFocusDone={() => setFocusImperativeId(null)}
                  />
                ) : view === "calendar" ? (
                  <CalendarView
                    workspace={store.workspace}
                    tasks={tasks}
                    projects={store.workspace.projects}
                    onMutate={store.mutate}
                    onAutoSave={(task, baseline, triggerWash) =>
                      saveCapturedTask(
                        task,
                        false,
                        triggerWash !== false,
                        baseline,
                        true
                      ) as TaskAutosaveSaveResult
                    }
                    autosaveCloud={autosaveCloud}
                    onOpenTask={openTaskView}
                    onOpenProject={openProjectById}
                    readOnly={store.readOnly}
                    onReadText={readOutLoud}
                    onRegisterRead={reader => { calendarReadRef.current = reader; }}
                  />
                ) : view === "obligations" ? (
                  <ObligationsView
                    workspace={store.workspace}
                    day={now}
                    readOnly={store.readOnly}
                    voice={voice}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    focusId={focusObligationId}
                  />
                ) : view === "journal" ? (
                  <DailyLogView
                    voice={voice}
                    onConvertToTask={openNoteAsTask}
                  />
                ) : view === "decisions" ? (
                  <DecisionLogView workspace={store.workspace} voice={voice} />
                ) : view === "evidence" ? (
                  <EvidenceFeedView
                    workspace={store.workspace}
                    readOnly={store.readOnly}
                    onOpenTask={openTaskView}
                    onOpenProject={openProjectById}
                    onSaveEvidence={saveEvidence}
                    onDeleteEvidence={deleteEvidence}
                    voice={voice}
                  />
                ) : view === "sites" ? (
                  <SiteCardsView
                    workspace={store.workspace}
                    readOnly={store.readOnly}
                    voice={voice}
                    onSave={saveSiteCard}
                    onStatusChange={changeSiteCardStatus}
                  />
                ) : view === "shopping" ? (
                  <ShoppingListsView
                    workspace={store.workspace}
                    readOnly={store.readOnly}
                    voice={voice}
                    onMutate={update => {
                      if (!allowed()) return false;
                      const accepted = store.mutate(update);
                      if (!accepted) {
                        toast.error(
                          "Shopping list change was not saved. Check sync and try again."
                        );
                      }
                      return accepted;
                    }}
                  />
                ) : view === "assets" ? (
                  <AssetsView
                    workspace={store.workspace}
                    readOnly={store.readOnly}
                    voice={voice}
                    onMutate={update => {
                      if (!allowed()) return false;
                      const accepted = store.mutate(update);
                      if (!accepted) {
                        toast.error(
                          "Asset change was not saved. Check sync and try again."
                        );
                      }
                      return accepted;
                    }}
                    onTaskDraft={openAssetLogAsTask}
                    onOpenTask={openTaskView}
                  />
                ) : view === "pipeline" ? (
                  <WorkPipelineView
                    workspace={store.workspace}
                    kinds={kinds}
                    onOpenTask={openTaskView}
                    onDone={id => done(id)}
                    onOpenProject={openProjectById}
                  />
                ) : view === "routine" ? (
                  <RoutineRunnerView
                    workspace={store.workspace}
                    kinds={kinds}
                    readOnly={store.readOnly}
                    onToggleChecklist={toggleRoutineChecklist}
                    onCompleteTask={id => done(id)}
                    onOpenTask={openTaskView}
                    onRead={voice.read}
                  />
                ) : view === "yearWheel" ? (
                  <YearWheelView
                    workspace={store.workspace}
                    day={now}
                    kinds={kinds}
                    onOpenTask={openTaskView}
                    onOpenProject={openProjectById}
                    onOpenObligation={openObligationById}
                    onOpenReview={() => navigate("weekly")}
                    onRead={voice.read}
                  />
                ) : view === "moveEnergy" ? (
                  <MoveEnergyView day={now} />
                ) : view === "weather" ? (
                  <WeatherView />
                ) : view === "people" ? (
                  <PeopleView
                    workspace={store.workspace}
                    day={now}
                    readOnly={store.readOnly}
                    onMutate={store.mutate}
                    voice={voice}
                  />
                ) : view === "credentialRenewals" ? (
                  <CredentialRenewalsView
                    workspace={store.workspace}
                    day={now}
                    readOnly={store.readOnly}
                    voice={voice}
                    onMutate={store.mutate}
                  />
                ) : view === "invoices" ? (
                  <InvoicesView
                    workspace={store.workspace}
                    day={now}
                    readOnly={store.readOnly}
                    voice={voice}
                    onMutate={store.mutate}
                  />
                ) : view === "projects" || view === "matrix" ? (
                  <LifeView
                    view={view}
                    workspace={store.workspace}
                    onMutate={store.mutate}
                    onOpenTask={openTaskView}
                    onAddTask={id => openCapture(false, id)}
                    onOpenGoal={openGoal}
                    focusProjectId={focusProjectId}
                    onFocusDone={() => setFocusProjectId(null)}
                    readOnly={store.readOnly}
                  />
                ) : view === "cloud" ? (
                  <SharedDataPanel
                    store={store}
                    onSheet={() => navigate("sheet")}
                    voice={voice}
                  />
                ) : view === "sheet" ? (
                  <SheetView
                    store={store}
                    onConnect={() => navigate("cloud")}
                    onOpen={openTaskView}
                  />
                ) : view === "settings" ? (
                  <SettingsView
                    tasks={tasks}
                    kind={store.kind}
                    remindersPanel={
                      <RemindersPanel store={store} voice={voice} />
                    }
                    backupPanel={
                      <BackupPanel
                        store={store}
                        shared={store.cloud.active}
                        onRead={voice.read}
                        onStopReading={voice.stopSpeaking}
                        onRestore={
                          store.cloud.active
                            ? store.cloud.restoreBackup
                            : undefined
                        }
                        onRestored={() => {
                          closeTaskPanel();
                          setCapture(false);
                          setFocusOpen(false);
                          navigate("attention");
                          toast.success(
                            "Backup restored with its original identities and links."
                          );
                        }}
                      />
                    }
                    onScenario={s => {
                      store.loadDemo(s);
                      navigate("attention");
                      toast(
                        "Sample scenario loaded. Personal data was not touched."
                      );
                    }}
                    onImport={added => {
                      if (allowed())
                        store.mutate(w => ({
                          ...w,
                          tasks: [...w.tasks, ...added],
                        }));
                    }}
                    onPersonal={() => changeWorkspace("personal")}
                    onDemo={() => changeWorkspace("demo")}
                    installAvailable={!!install}
                    onInstall={async () => {
                      if (install) {
                        await install.prompt();
                        await install.userChoice;
                        setInstall(null);
                      }
                    }}
                    readOnly={store.readOnly}
                  />
                ) : (
                  <WorkViews
                    view={view}
                    tasks={tasks}
                    projects={store.workspace.projects}
                    search={search}
                    area={area}
                    filter={filter}
                    onSearch={setSearch}
                    onArea={setArea}
                    onFilter={setFilter}
                    onOpen={openTaskView}
                    onStart={start}
                    onDone={done}
                    onReview={review}
                    onAdd={() => openCapture()}
                  />
                )}
                {(!v2Screen || (view === "attention" && todayTab === "overview")) && <footer className="app-footer">
                  <span>
                    <ShieldCheck size={13} />
                    {store.kind === "demo"
                      ? "Sample data · browser only"
                      : store.cloud.active
                        ? `Personal server space · ${store.cloud.status}`
                        : "Personal browser space · not shared"}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => navigate("settings")}
                  >
                    Portable by design
                    <ArrowUpRightIcon />
                  </button>
                </footer>}
              </main>
            </div>
            <nav className="mobile-bottom" aria-label="Quick navigation">
              {mobileQuickNav.map(({ id, title, Icon }) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  aria-current={view === id ? "page" : undefined}
                  aria-label={
                    id === "compass-view" ? "Open Compass view" : undefined
                  }
                  title={id === "compass-view" ? "Compass view" : undefined}
                  onClick={() => {
                    navigate(id);
                    setMobileMenu(false);
                  }}
                >
                  <Icon size={19} />
                  <span>
                    {id === "compass-view"
                      ? "Compass"
                      : id === "settings"
                        ? "Backups"
                        : id === "attention"
                          ? "Today"
                          : id === "projects"
                            ? "Projects"
                            : title}
                  </span>
                </button>
              ))}
            </nav>
            {v2Screen && screenMenu && (
              <TodayCalendarMenuSheet
                kind={screenMenu}
                page={v2Page}
                appearance={appearance}
                onAppearance={changeAppearance}
                connectionText={topbarConnectionText}
                flagCount={orphanReport(tasks).count}
                canUndo={store.canUndo}
                onClose={() => setScreenMenu(null)}
                onFlag={() => setOrphanOpen(true)}
                onConnection={() => navigate("cloud")}
                onIntention={() => setIntentionOpen("listen")}
                onReanchor={() => setReanchorOpen(true)}
                onBackups={() => navigate("settings")}
                onSpeak={() => openCapture(true)}
                onRead={readCurrentScreen}
                onUndo={() => {
                  if (!store.canUndo) return;
                  store.undo();
                  toast("Last change undone.");
                }}
              />
            )}
            {view === "attention" && todayTab === "today" && (
              <button
                type="button"
                className="v2-floating-capture"
                aria-label="Capture a task"
                onClick={() => openCapture()}
              >
                <Plus size={23} aria-hidden="true" />
              </button>
            )}
            <a
              href="/voice"
              className={`v2-floating-talk${view === "attention" && todayTab === "today" ? " v2-floating-talk--stacked" : ""}`}
              aria-label="Talk to Steadier"
              title="Talk to Steadier"
            >
              <Mic size={22} aria-hidden="true" />
            </a>
            <OrphanSheet
              open={orphanOpen}
              onClose={() => setOrphanOpen(false)}
              workspace={store.workspace}
              onMutate={store.mutate}
              onOpenTask={openTaskView}
              onRead={voice.read}
              readOnly={store.readOnly}
            />
            {selectedTask && taskPanelMode === "view" && (
              <TaskViewPanel
                key={`view-${selectedTask.id}`}
                task={selectedTask}
                tasks={tasks}
                places={placesOf(store.workspace)}
                today={now}
                projectTitle={store.workspace.projects.find(
                  project => project.id === (tasks.find(task => task.id === selectedTask.id)?.projectId ?? selectedTask.projectId)
                )?.title}
                readOnly={store.readOnly}
                onClose={closeTaskPanel}
                onEdit={openTaskEditor}
                onOpenTask={openTaskView}
                onDone={id => done(id, undefined, true)}
                onReopen={reopenDoneTask}
                onCompleteSubtask={id => done(id, undefined, true, true)}
                onConfirmSuggestion={(id, parentId) =>
                  updateSuggestedSubtask(id, parentId, "confirm")
                }
                onDismissSuggestion={(id, parentId) =>
                  updateSuggestedSubtask(id, parentId, "dismiss")
                }
                onConfirmAll={confirmAllSuggestedSubtasks}
                onRead={voice.read}
              />
            )}
            {selectedTask && taskPanelMode === "edit" && (
              <TaskEditor
                key={selectedTask.id}
                task={selectedTask}
                tasks={tasks}
                projects={store.workspace.projects}
                imperatives={store.workspace.imperatives}
                whyChains={projectId =>
                  projectId ? chainsForProject(store.workspace, projectId) : []
                }
                onOpenGoal={id => {
                  closeTaskPanel();
                  openGoal(id);
                }}
                whyFor={projectId =>
                  describeWhy(
                    store.workspace,
                    store.workspace.projects.find(p => p.id === projectId)
                  )
                }
                onClose={() => setTaskPanelMode("view")}
                onOpenTask={openTaskView}
                onAddSubtask={newSubtask}
                places={placesOf(store.workspace)}
                onManagePlaces={() => {
                  closeTaskPanel();
                  navigate("near");
                }}
                onCompleteSubtask={id => done(id, undefined, true, true)}
                onDeleteSubtask={store.readOnly ? undefined : deleteSubtask}
                onReopenDropped={store.readOnly ? undefined : reopenDropped}
                onSave={task => {
                  if (!selectedTask) return false;
                  const result = saveTaskDraft(task, selectedTask, false);
                  if (!result.accepted) {
                    toast.error(result.message);
                    return false;
                  }
                  setTaskPanelMode("view");
                  toast.success(
                    storeRef.current.cloud.active
                      ? "Your edit is held here. Check sync confirmation above."
                      : "Your next step is saved."
                  );
                  return true;
                }}
                onAutosave={(task, baseline) =>
                  saveTaskDraft(task, baseline, true)
                }
                autosaveCloud={autosaveCloud}
                onDone={done}
                onRead={voice.read}
              />
            )}
            {capture && (
              <CaptureDialog
                voice={voice}
                focused={focused}
                initialText={captureInitialText}
                initialNotes={captureInitialNotes}
                manualReviewOnly={captureManualReviewOnly}
                sourceAlreadyShared={captureAssetSource !== null}
                projects={store.workspace.projects}
                tasks={tasks}
                autosaveCloud={autosaveCloud}
                initialProjectId={captureProjectId}
                onAdd={(task, baseline) =>
                  saveCapturedTask(task, true, false, baseline, true)
                }
                onAutoSave={(task, baseline) =>
                  saveCapturedTask(task, false, true, baseline) as TaskAutosaveSaveResult
                }
                onClose={() => {
                  setCapture(false);
                  setCaptureAssetSource(null);
                }}
                onCommand={command => {
                  if (!focused || focused.state === "done") return false;
                  if (command === "complete") return done(focused.id);
                  else if (command === "defer") return defer(focused.id);
                  else
                    voice.read(
                      `${focused.title}. Next step: ${store.workspace.focus?.step || focused.nextAction}`
                    );
                  return true;
                }}
              />
            )}
            {focusOpen && focused && store.workspace.focus && !capture && (
              <FocusDialog
                task={focused}
                projectTitle={
                  store.workspace.projects.find(p => p.id === focused.projectId)
                    ?.title
                }
                focus={store.workspace.focus}
                remoteFocus={store.cloud.remoteFocus}
                takeoverPending={store.cloud.focusTransferPending}
                takeoverBlocked={store.readOnly}
                takeoverStatus={store.cloud.status}
                takeoverError={store.cloud.error}
                onTakeFocus={requestFocusHere}
                onFocus={focus => {
                  const accepted = store.saveFocus(focus, store.generation);
                  if (!accepted)
                    toast.error(
                      "Focus was not changed. Check sync or use explicit takeover."
                    );
                  return accepted;
                }}
                onClose={() => setFocusOpen(false)}
                onDone={done}
                onEdit={openTaskEditor}
                onRead={voice.read}
                onVoice={() => openCapture(true)}
              />
            )}
          </div>
          {intentionOpen && (
            <IntentionDialog onClose={() => setIntentionOpen(false)}>
              <TodayFrame
                workspace={store.workspace}
                onMutate={store.mutate}
                onOpenTask={t => {
                  setIntentionOpen(false);
                  openTaskView(t);
                }}
                onStartTask={t => {
                  setIntentionOpen(false);
                  start(t);
                }}
                readOnly={store.readOnly}
                blockedReason={intentionBlockedReason}
                syncStatus={store.cloud.active ? store.cloud.status : "local"}
                onRetry={store.cloud.active ? store.cloud.retry : undefined}
                voice={capture ? undefined : voice}
                autoListen={intentionOpen === "listen"}
              />
            </IntentionDialog>
          )}
          {reanchorOpen && (
            <ReanchorDialog
              workspace={store.workspace}
              day={now}
              nowTask={nowTask}
              onRead={voice.read}
              onClose={() => {
                voice.stopSpeaking();
                setReanchorOpen(false);
                if (view === "attention") {
                  setTodayTab("today");
                  setTimeout(
                    () =>
                      document.getElementById("today-now")?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      }),
                    50
                  );
                }
              }}
              onSetIntention={() => {
                voice.stopSpeaking();
                setReanchorOpen(false);
                setIntentionOpen("listen");
              }}
            />
          )}
        </PlacesContext.Provider>
      </TaskKindContext.Provider>
    </TaskListContext.Provider>
  );
}
function ArrowUpRightIcon() {
  return <span aria-hidden="true">↗</span>;
}
/** History line when a save changes which task this one sits under. */
function parentChangeNote(
  tasks: Task[],
  before: Task,
  after: Task
): string | null {
  const was = before.parent;
  const now = after.parent;
  if (was?.id === now?.id && was?.suggested === now?.suggested) return null;
  const title = (id: string) =>
    `“${tasks.find(t => t.id === id)?.title ?? "a task"}”`;
  if (!now)
    return was?.suggested
      ? `Rejected suggested parent ${title(was.id)}.`
      : "Moved to the top level.";
  if (was?.id === now.id && was.suggested && !now.suggested)
    return `Confirmed suggested parent ${title(now.id)}.`;
  return `Made it a subtask of ${title(now.id)}.`;
}
