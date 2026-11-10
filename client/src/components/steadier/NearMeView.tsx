import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Crosshair,
  MapPin,
  Navigation,
  Plus,
  Search,
  Trash2,
  Volume2,
} from "lucide-react";
import type { Task, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";
import {
  DEFAULT_RADIUS,
  addPlace,
  describeDistance,
  distanceMeters,
  nearGroups,
  openTasksAt,
  parseCoordinates,
  placesOf,
  removePlace,
  updatePlace,
} from "../../domain/places";
import type { LocationControls } from "../../hooks/useLocationReminders";
import type { VoiceControls } from "../../hooks/useVoice";
import { privateJSON } from "../../lib/cloudApi";

const RADII = [50, 100, 150, 250, 500, 1000, 2000];

interface SearchResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (task: Task) => void;
  location: LocationControls;
  manualPlaceId: string | null;
  onManualPlace: (id: string | null) => void;
  voice: VoiceControls;
  readOnly?: boolean;
}

function statusLine(location: LocationControls): string {
  switch (location.status) {
    case "on":
      return "On. Watching for your places while Steadier is open.";
    case "starting":
      return "Starting… allow location if Chrome asks.";
    case "denied":
      return "Location is blocked for this site.";
    case "unavailable":
      return "This browser cannot share a location.";
    case "error":
      return "Waiting for a location fix.";
    default:
      return "Off.";
  }
}

export default function NearMeView({
  workspace,
  onMutate,
  onOpenTask,
  location,
  manualPlaceId,
  onManualPlace,
  voice,
  readOnly,
}: Props) {
  const places = placesOf(workspace);
  const groups = useMemo(
    () => nearGroups(workspace.tasks, places, location.position, manualPlaceId),
    [workspace.tasks, places, location.position, manualPlaceId]
  );
  const [placesOpen, setPlacesOpen] = useState(places.length === 0);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const wakeSupported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;

  const toggleWake = async () => {
    if (wakeLock) {
      await wakeLock.release().catch(() => undefined);
      setWakeLock(null);
      return;
    }
    try {
      const lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => setWakeLock(null));
      setWakeLock(lock);
    } catch {
      toast("Could not keep the screen on. Plug in or check battery saver.");
    }
  };

  const readAloud = () => {
    if (!voice.speechSupported) return;
    if (!groups.length) {
      voice.read(
        places.length
          ? "No open tasks are linked to your places."
          : "You have no saved places yet."
      );
      return;
    }
    const parts = groups.slice(0, 3).map(g => {
      const where = g.here
        ? `At ${g.place.name}`
        : g.distance !== null
          ? `${g.place.name}, ${describeDistance(g.distance)} away`
          : g.place.name;
      const names = g.tasks
        .slice(0, 3)
        .map(t => t.title)
        .join(", ");
      return `${where}: ${names}${g.tasks.length > 3 ? `, and ${g.tasks.length - 3} more` : ""}.`;
    });
    voice.read(parts.join(" "));
  };

  return (
    <section className="near-view" aria-labelledby="near-title">
      <header className="near-head">
        <p className="eyebrow">Location reminders</p>
        <h2 id="near-title">Near me</h2>
        <p className="quiet-note">
          Tasks for the places you are at, and a reminder when you arrive. Your
          live location stays on this phone; only the places you save are kept
          with your records.
        </p>
      </header>

      <div className="near-card">
        <div className="near-switch-row">
          <div>
            <strong>Remind me when I arrive</strong>
            <p className="small" role="status">
              {statusLine(location)}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={location.enabled}
            aria-label="Remind me when I arrive"
            className={`switch${location.enabled ? " on" : ""}`}
            disabled={location.status === "unavailable"}
            onClick={() =>
              location.enabled ? location.disable() : location.enable()
            }
          >
            <span />
          </button>
        </div>
        <p className="small near-limit">
          Works while Steadier is open on screen, for example on the phone in
          the car. It plays your reminder tone, reads the tasks aloud and shows
          a notice, once per visit.
        </p>
        {location.message && (
          <p className="error" role="alert">
            {location.message}
          </p>
        )}
        <div className="near-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => void location.locateOnce()}
          >
            <Crosshair size={16} /> Check where I am
          </button>
          {wakeSupported && (
            <button
              type="button"
              className="button secondary"
              aria-pressed={!!wakeLock}
              onClick={() => void toggleWake()}
            >
              {wakeLock ? "Screen stays on" : "Keep screen on"}
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={readAloud}
            disabled={!voice.speechSupported}
          >
            <Volume2 size={16} /> Read aloud
          </button>
        </div>
      </div>

      {places.length > 0 && (
        <div className="near-card">
          <strong id="im-at-label">I'm at…</strong>
          <div className="chip-row" role="group" aria-labelledby="im-at-label">
            {places.map(p => (
              <button
                key={p.id}
                type="button"
                className={`chip-toggle${manualPlaceId === p.id ? " on" : ""}`}
                aria-pressed={manualPlaceId === p.id}
                onClick={() =>
                  onManualPlace(manualPlaceId === p.id ? null : p.id)
                }
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="near-groups">
        {groups.length === 0 ? (
          <p className="quiet-note">
            {places.length
              ? "No open tasks are linked to your places. Give a task a place in its editor."
              : "Save a place below, then give tasks that place in their editor."}
          </p>
        ) : (
          groups.map(g => (
            <article
              key={g.place.id}
              className={`near-group${g.here ? " is-here" : ""}`}
              aria-label={`${g.place.name}: ${g.tasks.length} open`}
            >
              <header>
                <MapPin size={16} aria-hidden />
                <strong>{g.place.name}</strong>
                <span className="small">
                  {g.here
                    ? "You're here"
                    : g.distance !== null
                      ? `${describeDistance(g.distance)} away`
                      : ""}
                </span>
              </header>
              <ul>
                {g.tasks.map(t => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="near-task"
                      onClick={() => onOpenTask(t)}
                    >
                      <span>
                        <TimingShapeMark task={t} /> {t.title}
                      </span>
                      {t.nextAction && (
                        <span className="small">{t.nextAction}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </div>

      <details
        className="near-card near-places"
        open={placesOpen}
        onToggle={e => setPlacesOpen(e.currentTarget.open)}
      >
        <summary>Your places · {places.length}</summary>
        <ul className="near-place-list">
          {places.map(p => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong>
                {p.address && <span className="small">{p.address}</span>}
                <span className="small">
                  {openTasksAt(workspace.tasks, p.id).length} open
                  {location.position
                    ? ` · ${describeDistance(distanceMeters(location.position, p))} away`
                    : ""}
                </span>
              </div>
              <label className="small">
                Arrive within
                <select
                  value={p.radius}
                  disabled={readOnly}
                  aria-label={`Arrival distance for ${p.name}`}
                  onChange={e =>
                    onMutate(w =>
                      updatePlace(w, p.id, { radius: Number(e.target.value) })
                    )
                  }
                >
                  {RADII.map(r => (
                    <option key={r} value={r}>
                      {describeDistance(r)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove place ${p.name}`}
                disabled={readOnly}
                onClick={() => {
                  const count = workspace.tasks.filter(
                    t => t.placeId === p.id
                  ).length;
                  if (
                    !window.confirm(
                      count
                        ? `Remove ${p.name}? Its ${count} task(s) are kept, just without a place.`
                        : `Remove ${p.name}?`
                    )
                  )
                    return;
                  if (manualPlaceId === p.id) onManualPlace(null);
                  onMutate(w => removePlace(w, p.id));
                }}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <AddPlaceForm
            onMutate={onMutate}
            location={location}
            nearHint={location.position}
          />
        )}
      </details>
    </section>
  );
}

function AddPlaceForm({
  onMutate,
  location,
  nearHint,
}: {
  onMutate: Props["onMutate"];
  location: LocationControls;
  nearHint: { lat: number; lng: number } | null;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [link, setLink] = useState("");
  const [spot, setSpot] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setError("Type at least 2 characters to search.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const near = nearHint
        ? `&near=${nearHint.lat.toFixed(2)},${nearHint.lng.toFixed(2)}`
        : "";
      const body = await privateJSON<{ results: SearchResult[] }>(
        `/api/steadier/places/search?q=${encodeURIComponent(q)}${near}`
      );
      setResults(body.results);
      if (!body.results.length) setError("No matches. Try adding the suburb.");
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      setError(
        /sign in/i.test(text)
          ? "Sign in (Server & Compass) to search addresses. You can still use your current location or paste a map link."
          : text || "Search failed."
      );
    } finally {
      setSearching(false);
    }
  };

  const useHere = async () => {
    setError("");
    const here = await location.locateOnce();
    if (!here) {
      setError(location.message || "Could not get your location.");
      return;
    }
    setSpot({ lat: here.lat, lng: here.lng, address: "Where I was standing" });
    setResults([]);
  };

  const readLink = (text: string) => {
    setLink(text);
    const coords = parseCoordinates(text);
    if (coords) {
      setSpot({ ...coords, address: "" });
      setError("");
    }
  };

  const save = () => {
    if (!spot) {
      setError(
        "Choose a search result, use your location, or paste a map link."
      );
      return;
    }
    let message = "";
    const ok = onMutate(w => {
      const r = addPlace(w, { name, ...spot, radius });
      if (r.error) {
        message = r.error;
        return w;
      }
      return r.workspace;
    });
    if (message) {
      setError(message);
      return;
    }
    if (ok === false) {
      setError("The place was not saved. Check sync and try again.");
      return;
    }
    toast(`Saved place ${name.trim()}`);
    setName("");
    setQuery("");
    setResults([]);
    setLink("");
    setSpot(null);
    setRadius(DEFAULT_RADIUS);
    setError("");
  };

  return (
    <form
      className="near-add"
      aria-label="Add a place"
      onSubmit={e => {
        e.preventDefault();
        save();
      }}
    >
      <strong>Add a place</strong>
      <label>
        Name
        <input
          ref={nameRef}
          value={name}
          maxLength={120}
          placeholder="e.g. Bunnings, Work, Mum's"
          onChange={e => setName(e.target.value)}
        />
      </label>
      <div className="near-search">
        <label>
          Search an address or business
          <input
            value={query}
            maxLength={200}
            placeholder="Bunnings Mile End"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => void search()}
          disabled={searching}
        >
          <Search size={16} /> {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="near-results" aria-label="Search results">
          {results.map(r => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                className={
                  spot && spot.lat === r.lat && spot.lng === r.lng
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setSpot({ lat: r.lat, lng: r.lng, address: r.address });
                  if (!name.trim()) setName(r.name);
                }}
              >
                <strong>{r.name}</strong>
                <span className="small">{r.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="near-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => void useHere()}
        >
          <Navigation size={16} /> Use my current location
        </button>
      </div>
      <label>
        Or paste a Google Maps link or coordinates
        <input
          value={link}
          placeholder="-34.93, 138.58"
          onChange={e => readLink(e.target.value)}
        />
      </label>
      {spot && (
        <p className="small" role="status">
          Location chosen{spot.address ? `: ${spot.address}` : ""} (
          {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)})
        </p>
      )}
      <label>
        Remind me within
        <select
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
        >
          {RADII.map(r => (
            <option key={r} value={r}>
              {describeDistance(r)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button primary">
        <Plus size={16} /> Save place
      </button>
    </form>
  );
}
