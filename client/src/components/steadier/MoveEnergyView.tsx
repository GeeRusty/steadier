import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  adjustMovementCount,
  correctMovementCount,
  movementCountFor,
  movementHistory,
  readMovementFloor,
  withDailyFloor,
  writeMovementFloor,
  type MovementFloorState,
  type MovementStorage,
} from "../../domain/movementFloor";
import {
  readEnergyWindows,
  removeEnergyWindow,
  saveEnergyWindow,
  writeEnergyWindows,
  type EnergyBand,
  type EnergyWindow,
} from "../../domain/energyWindows";
import { WEEKDAY_NAMES, weekdayOf } from "../../domain/time";
import { adelaideTimestamp } from "../../../../shared/time";

type StorageLike = MovementStorage;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function dateLabel(value: string, includeYear = false): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(parsed);
}

function floorCopy(count: number, floor: number | null): string {
  if (floor === null) return "No daily floor set.";
  if (count >= floor)
    return `Your personal floor is met (${count} of ${floor}).`;
  return `${count} of your personal floor of ${floor}; log a break only when one happened.`;
}

function createWindowId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `energy-${uuid}`
    : `energy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const BAND_LABEL: Record<EnergyBand, string> = {
  light: "Light",
  steady: "Steady",
  deep: "Deep",
};

export function MoveFloorTodayCard({
  day,
  onOpen,
}: {
  day: string;
  onOpen: () => void;
}) {
  const [storage] = useState<StorageLike | null>(browserStorage);
  const [read, setRead] = useState(() => readMovementFloor(storage, day));
  const [status, setStatus] = useState("");
  useEffect(() => {
    setRead(readMovementFloor(storage, day));
  }, [day, storage]);

  const change = (delta: -1 | 1) => {
    if (!read.ok) return;
    try {
      const next = adjustMovementCount(
        read.state,
        day,
        delta,
        adelaideTimestamp(),
        day
      );
      const saved = writeMovementFloor(storage, next, day);
      if (!saved.ok || !saved.state) {
        setStatus(saved.error ?? "The movement count was not saved.");
        return;
      }
      setRead({ ok: true, state: saved.state, error: null });
      setStatus("Saved on this device.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "The count was not saved."
      );
    }
  };

  const count = read.ok ? movementCountFor(read.state, day) : 0;
  return (
    <section className="move-today-card" aria-labelledby="move-today-title">
      <div className="move-today-copy">
        <p className="eyebrow">Optional · local to this browser</p>
        <h2 id="move-today-title">Movement breaks</h2>
        <p>
          <strong>{count}</strong> logged today ·{" "}
          {floorCopy(count, read.state.dailyFloor)}
        </p>
        {read.error && (
          <p role="alert" className="danger-text">
            {read.error}
          </p>
        )}
        {status && (
          <p className="move-status" role="status">
            {status}
          </p>
        )}
      </div>
      <div className="move-today-actions">
        <button
          className="button primary"
          type="button"
          disabled={!read.ok}
          onClick={() => change(1)}
        >
          Log one break
        </button>
        <button
          className="button"
          type="button"
          disabled={!read.ok || count === 0}
          onClick={() => change(-1)}
        >
          Undo
        </button>
        <button className="button subtle" type="button" onClick={onOpen}>
          Move &amp; Energy
        </button>
      </div>
    </section>
  );
}

interface WindowDraft extends EnergyWindow {}

export default function MoveEnergyView({ day }: { day: string }) {
  const [storage] = useState<StorageLike | null>(browserStorage);
  const [movement, setMovement] = useState(() =>
    readMovementFloor(storage, day)
  );
  const [energy, setEnergy] = useState(() => readEnergyWindows(storage));
  const [floorDraft, setFloorDraft] = useState("");
  const [movementStatus, setMovementStatus] = useState("");
  const [energyStatus, setEnergyStatus] = useState("");
  const [windowDraft, setWindowDraft] = useState<WindowDraft | null>(null);
  const [editingWindowId, setEditingWindowId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnergyWindow | null>(null);
  const [resetTodayOpen, setResetTodayOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const nextMovement = readMovementFloor(storage, day);
      const nextEnergy = readEnergyWindows(storage);
      setMovement(nextMovement);
      setEnergy(nextEnergy);
      if (nextMovement.ok)
        setFloorDraft(nextMovement.state.dailyFloor?.toString() ?? "");
    };
    refresh();
    if (typeof window === "undefined") return;
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [day, storage]);

  useEffect(() => {
    if (movement.ok) setFloorDraft(movement.state.dailyFloor?.toString() ?? "");
  }, [movement.ok, movement.state.dailyFloor]);

  const todayCount = movement.ok ? movementCountFor(movement.state, day) : 0;
  const week = movementHistory(movement.state, day, 7);
  const saveMovement = (next: MovementFloorState): boolean => {
    if (!movement.ok) return false;
    const result = writeMovementFloor(storage, next, day);
    if (!result.ok || !result.state) {
      setMovementStatus(result.error ?? "Movement data was not saved.");
      return false;
    }
    setMovement({ ok: true, state: result.state, error: null });
    setMovementStatus("Saved on this device.");
    return true;
  };
  const adjustDay = (date: string, delta: -1 | 1) => {
    if (!movement.ok) return;
    try {
      const next = adjustMovementCount(
        movement.state,
        date,
        delta,
        adelaideTimestamp(),
        day
      );
      saveMovement(next);
    } catch (error) {
      setMovementStatus(
        error instanceof Error ? error.message : "Count was not changed."
      );
    }
  };
  const saveFloor = () => {
    if (!movement.ok) return;
    const raw = floorDraft.trim();
    const value = raw === "" ? null : Number(raw);
    try {
      saveMovement(withDailyFloor(movement.state, value));
    } catch (error) {
      setMovementStatus(
        error instanceof Error ? error.message : "Floor was not saved."
      );
    }
  };
  const resetToday = () => {
    if (!movement.ok) return;
    try {
      const next = correctMovementCount(
        movement.state,
        day,
        0,
        adelaideTimestamp(),
        day
      );
      if (saveMovement(next)) setResetTodayOpen(false);
    } catch (error) {
      setMovementStatus(
        error instanceof Error ? error.message : "Count was not reset."
      );
    }
  };

  const openNewWindow = () => {
    setEditingWindowId(null);
    setWindowDraft({
      id: createWindowId(),
      weekday: weekdayOf(day),
      startTime: "09:00",
      endTime: "11:00",
      band: "steady",
    });
    setEnergyStatus("");
  };
  const openEditWindow = (item: EnergyWindow) => {
    setEditingWindowId(item.id);
    setWindowDraft({ ...item });
    setEnergyStatus("");
  };
  const saveWindow = () => {
    if (!energy.ok || !windowDraft) return;
    try {
      const next = saveEnergyWindow(
        energy.windows,
        windowDraft,
        editingWindowId
      );
      const result = writeEnergyWindows(storage, next);
      if (!result.ok || !result.windows) {
        setEnergyStatus(result.error ?? "Planning window was not saved.");
        return;
      }
      setEnergy({ ok: true, windows: result.windows, error: null });
      setWindowDraft(null);
      setEditingWindowId(null);
      setEnergyStatus("Saved on this device.");
    } catch (error) {
      setEnergyStatus(
        error instanceof Error
          ? error.message
          : "Planning window was not saved."
      );
    }
  };
  const confirmDeleteWindow = () => {
    if (!energy.ok || !deleteTarget) return;
    const result = writeEnergyWindows(
      storage,
      removeEnergyWindow(energy.windows, deleteTarget.id)
    );
    if (!result.ok || !result.windows) {
      setEnergyStatus(result.error ?? "Planning window was not removed.");
      return;
    }
    setEnergy({ ok: true, windows: result.windows, error: null });
    setDeleteTarget(null);
    setEnergyStatus("Planning window removed.");
  };

  return (
    <main className="move-energy-view">
      <header className="move-energy-heading">
        <div>
          <p className="eyebrow">Owner-entered context · no sensors</p>
          <h1>Move &amp; Energy</h1>
          <p>
            Manual movement-break counts and planning windows. Neither changes a
            task.
          </p>
        </div>
      </header>
      <p className="notice move-energy-privacy">
        These details stay in this browser only: they are not synced, backed up
        or sent to Claude/ChatGPT. “Movement break” is a personal count, not a
        step, calorie or health measure. No wearable is connected.
      </p>

      <section
        className="move-energy-section"
        aria-labelledby="movement-floor-heading"
      >
        <div className="move-section-heading">
          <div>
            <p className="eyebrow">
              Australia / Adelaide date · {dateLabel(day, true)}
            </p>
            <h2 id="movement-floor-heading">Movement floor</h2>
          </div>
          <span className="move-count-pill">{todayCount} today</span>
        </div>
        <p className="move-explainer">
          One entry means you chose to count one movement break. There is no
          default floor or streak. A floor is your own reference—not a health
          recommendation.
        </p>
        {movement.error && (
          <p role="alert" className="move-error">
            {movement.error}
          </p>
        )}
        <div className="move-count-actions">
          <button
            className="button primary"
            type="button"
            disabled={!movement.ok}
            onClick={() => adjustDay(day, 1)}
          >
            Log one movement break
          </button>
          <button
            className="button"
            type="button"
            disabled={!movement.ok || todayCount === 0}
            onClick={() => adjustDay(day, -1)}
          >
            Undo one
          </button>
          <button
            className="button subtle"
            type="button"
            disabled={!movement.ok || todayCount === 0}
            onClick={() => setResetTodayOpen(true)}
          >
            Reset today
          </button>
        </div>
        <p className="move-floor-status" role="status">
          {floorCopy(todayCount, movement.state.dailyFloor)}
        </p>
        <div className="move-floor-form">
          <label className="field">
            <span>Optional daily floor (1–{20} breaks, or blank to unset)</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={floorDraft}
              disabled={!movement.ok}
              onChange={event => setFloorDraft(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            className="button"
            type="button"
            disabled={!movement.ok}
            onClick={saveFloor}
          >
            Save floor
          </button>
        </div>
        {movementStatus && (
          <p className="move-status" role="status">
            {movementStatus}
          </p>
        )}
        <div className="move-history">
          <h3>Last 7 Adelaide-local days</h3>
          <ul>
            {week.map(item => (
              <li key={item.date}>
                <time dateTime={item.date}>
                  {item.date === day
                    ? `Today · ${dateLabel(item.date)}`
                    : dateLabel(item.date, true)}
                </time>
                <strong>{item.count}</strong>
                <span>movement {item.count === 1 ? "break" : "breaks"}</span>
                <div className="move-history-actions">
                  <button
                    className="button small"
                    type="button"
                    aria-label={`Undo one movement break for ${item.date}`}
                    disabled={!movement.ok || item.count === 0}
                    onClick={() => adjustDay(item.date, -1)}
                  >
                    −1
                  </button>
                  <button
                    className="button small"
                    type="button"
                    aria-label={`Add one movement break for ${item.date}`}
                    disabled={!movement.ok}
                    onClick={() => adjustDay(item.date, 1)}
                  >
                    +1
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="small">
            History is retained for up to 90 days on this browser. Older days
            are removed when a new count is saved.
          </p>
        </div>
      </section>

      <section
        className="move-energy-section"
        aria-labelledby="energy-windows-heading"
      >
        <div className="move-section-heading">
          <div>
            <p className="eyebrow">Self-authored · no wearable data</p>
            <h2 id="energy-windows-heading">Planning windows</h2>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={!energy.ok}
            onClick={openNewWindow}
          >
            Add window
          </button>
        </div>
        <p className="move-explainer">
          Record the times and words that you want to use when planning. These
          are preferences you set, not measured energy. Steadier does not
          schedule tasks from them.
        </p>
        {energy.error && (
          <p role="alert" className="move-error">
            {energy.error}
          </p>
        )}
        {energy.windows.length ? (
          <ul className="energy-window-list">
            {energy.windows.map(item => (
              <li key={item.id}>
                <div>
                  <strong>{WEEKDAY_NAMES[item.weekday]}</strong>
                  <span>
                    {item.startTime}–{item.endTime}
                  </span>
                  <small>{BAND_LABEL[item.band]} · your label</small>
                </div>
                <div className="energy-window-actions">
                  <button
                    className="button small"
                    type="button"
                    disabled={!energy.ok}
                    onClick={() => openEditWindow(item)}
                  >
                    Edit
                  </button>
                  <button
                    className="button small danger-text"
                    type="button"
                    disabled={!energy.ok}
                    onClick={() => setDeleteTarget(item)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="move-empty">
            No planning windows saved. Add one only if it helps your planning.
          </p>
        )}
        {energyStatus && (
          <p className="move-status" role="status">
            {energyStatus}
          </p>
        )}
        {windowDraft && (
          <form
            className="energy-window-editor"
            onSubmit={event => {
              event.preventDefault();
              saveWindow();
            }}
          >
            <h3>
              {editingWindowId ? "Edit planning window" : "New planning window"}
            </h3>
            <div className="energy-window-fields">
              <label className="field">
                <span>Day</span>
                <select
                  value={windowDraft.weekday}
                  onChange={event =>
                    setWindowDraft(current =>
                      current
                        ? { ...current, weekday: Number(event.target.value) }
                        : current
                    )
                  }
                >
                  {WEEKDAY_NAMES.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Start</span>
                <input
                  type="time"
                  required
                  value={windowDraft.startTime}
                  onChange={event =>
                    setWindowDraft(current =>
                      current
                        ? { ...current, startTime: event.target.value }
                        : current
                    )
                  }
                />
              </label>
              <label className="field">
                <span>End</span>
                <input
                  type="time"
                  required
                  value={windowDraft.endTime}
                  onChange={event =>
                    setWindowDraft(current =>
                      current
                        ? { ...current, endTime: event.target.value }
                        : current
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Your planning label</span>
                <select
                  value={windowDraft.band}
                  onChange={event =>
                    setWindowDraft(current =>
                      current
                        ? { ...current, band: event.target.value as EnergyBand }
                        : current
                    )
                  }
                >
                  <option value="light">Light</option>
                  <option value="steady">Steady</option>
                  <option value="deep">Deep</option>
                </select>
              </label>
            </div>
            <div className="button-row">
              <button
                className="button primary"
                type="submit"
                disabled={!energy.ok}
              >
                Save window
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setWindowDraft(null);
                  setEditingWindowId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <AlertDialog open={resetTodayOpen} onOpenChange={setResetTodayOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset today's movement count?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears only the manual count for {dateLabel(day, true)}.
              Other dates and your optional floor are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep count</AlertDialogCancel>
            <button
              className="button primary"
              type="button"
              disabled={!movement.ok}
              onClick={resetToday}
            >
              Reset today
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this planning window?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes only the local planning preference. It does not
              change any task or schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep window</AlertDialogCancel>
            <button
              className="button primary"
              type="button"
              disabled={!energy.ok}
              onClick={confirmDeleteWindow}
            >
              Remove window
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
