/**
 * Places and location reminders (v2.7).
 *
 * A place is a saved spot ("Bunnings", "Work") with an arrival distance.
 * Tasks can belong to one place. While Steadier is open, the device's
 * position is compared with saved places to remind once per visit. The
 * live position is only ever held in memory on the device.
 */
import { adelaideTimestamp } from "../../../shared/time";
import type { Place, Task, Workspace } from "./types";

export const MAX_PLACES = 50;
export const MIN_RADIUS = 50;
export const MAX_RADIUS = 2000;
export const DEFAULT_RADIUS = 150;
/** Readings vaguer than this are ignored for arrivals. */
export const MAX_USEFUL_ACCURACY = 1000;
/** A place cannot ring again within this time, even after leaving. */
export const ARRIVAL_COOLDOWN_MS = 30 * 60_000;

export interface Position {
  lat: number;
  lng: number;
  /** Metres (95% radius as reported by the device). */
  accuracy: number;
}

function stampFor(now?: string): string {
  return now === undefined
    ? adelaideTimestamp()
    : `${now.slice(0, 10)}T12:00:00`;
}
function freshId(): string {
  return `place-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function placesOf(workspace: Workspace): Place[] {
  return workspace.places ?? [];
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function describeDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

function validCoordinates(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Build a Google Maps directions URL for a saved place without duplicating its address. */
export function googleMapsDirectionsUrl(
  place: Pick<Place, "lat" | "lng">
): string | null {
  if (!validCoordinates(place.lat, place.lng)) return null;
  const destination = encodeURIComponent(`${place.lat},${place.lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/**
 * Read coordinates from "-34.92, 138.60" or a Google Maps link
 * (…/@-34.92,138.60,17z, ?q=-34.92,138.60, or !3d-34.92!4d138.60).
 */
export function parseCoordinates(
  text: string
): { lat: number; lng: number } | null {
  const t = text.trim();
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (validCoordinates(lat, lng)) return { lat, lng };
  }
  return null;
}

export function clampRadius(radius: number): number {
  if (!Number.isFinite(radius)) return DEFAULT_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.round(radius)));
}

export type PlaceResult =
  | { workspace: Workspace; place: Place; error: null }
  | { workspace: Workspace; place: null; error: string };

export function addPlace(
  workspace: Workspace,
  input: {
    name: string;
    address?: string;
    lat: number;
    lng: number;
    radius?: number;
  }
): PlaceResult {
  const name = input.name.trim().slice(0, 120);
  const places = placesOf(workspace);
  if (!name) return { workspace, place: null, error: "Give the place a name." };
  if (!validCoordinates(input.lat, input.lng))
    return {
      workspace,
      place: null,
      error: "That location could not be read.",
    };
  if (places.length >= MAX_PLACES)
    return {
      workspace,
      place: null,
      error: `You can save up to ${MAX_PLACES} places.`,
    };
  if (places.some(p => p.name.toLowerCase() === name.toLowerCase()))
    return {
      workspace,
      place: null,
      error: `You already have a place called ${name}.`,
    };
  const place: Place = {
    id: freshId(),
    name,
    address: (input.address ?? "").trim().slice(0, 300),
    lat: Math.round(input.lat * 1e6) / 1e6,
    lng: Math.round(input.lng * 1e6) / 1e6,
    radius: clampRadius(input.radius ?? DEFAULT_RADIUS),
  };
  return {
    workspace: { ...workspace, places: [...places, place] },
    place,
    error: null,
  };
}

export function updatePlace(
  workspace: Workspace,
  placeId: string,
  changes: Partial<Pick<Place, "name" | "radius">>
): Workspace {
  return {
    ...workspace,
    places: placesOf(workspace).map(p =>
      p.id !== placeId
        ? p
        : {
            ...p,
            ...(changes.name !== undefined && changes.name.trim()
              ? { name: changes.name.trim().slice(0, 120) }
              : {}),
            ...(changes.radius !== undefined
              ? { radius: clampRadius(changes.radius) }
              : {}),
          }
    ),
  };
}

/** Remove a place; its tasks are kept and simply lose the place. */
export function removePlace(
  workspace: Workspace,
  placeId: string,
  now?: string
): Workspace {
  const place = placesOf(workspace).find(p => p.id === placeId);
  if (!place) return workspace;
  const stamp = stampFor(now);
  return {
    ...workspace,
    places: placesOf(workspace).filter(p => p.id !== placeId),
    tasks: workspace.tasks.map(task => {
      if (task.placeId !== placeId) return task;
      const { placeId: _drop, ...rest } = task;
      return {
        ...rest,
        updatedAt: stamp,
        history: [
          ...task.history,
          { at: stamp, text: `Place ${place.name} was removed; task kept.` },
        ],
      };
    }),
  };
}

/** Set or clear a task's place, with a history line. */
export function setTaskPlace(
  task: Task,
  placeId: string | null,
  places: Place[],
  now?: string
): Task {
  if ((task.placeId ?? null) === placeId) return task;
  const stamp = stampFor(now);
  const place = placeId ? places.find(p => p.id === placeId) : undefined;
  if (placeId && !place) return task;
  const { placeId: _old, ...rest } = task;
  return {
    ...rest,
    ...(place ? { placeId: place.id } : {}),
    updatedAt: stamp,
    history: [
      ...task.history,
      {
        at: stamp,
        text: place ? `Place set: ${place.name}.` : "Place cleared.",
      },
    ],
  };
}

/** Drop task links to places that no longer exist (e.g. after a restore). */
export function prunePlaceLinks(workspace: Workspace): Workspace {
  const ids = new Set(placesOf(workspace).map(p => p.id));
  if (!workspace.tasks.some(t => t.placeId && !ids.has(t.placeId)))
    return workspace;
  return {
    ...workspace,
    tasks: workspace.tasks.map(t => {
      if (!t.placeId || ids.has(t.placeId)) return t;
      const { placeId: _drop, ...rest } = t;
      return rest;
    }),
  };
}

function isOpen(task: Task): boolean {
  return task.state !== "done";
}

export function openTasksAt(tasks: Task[], placeId: string): Task[] {
  return tasks.filter(t => t.placeId === placeId && isOpen(t));
}

export interface NearGroup {
  place: Place;
  /** Metres from the device, when known. */
  distance: number | null;
  /** Within the arrival distance now (or chosen with "I'm at…"). */
  here: boolean;
  tasks: Task[];
}

/**
 * Places that have open tasks: the place you said you are at first, then
 * places you are at, then nearest first (alphabetical when unknown).
 */
export function nearGroups(
  tasks: Task[],
  places: Place[],
  position: Position | null,
  manualPlaceId: string | null
): NearGroup[] {
  const groups = places
    .map(place => {
      const distance = position ? distanceMeters(position, place) : null;
      const here =
        place.id === manualPlaceId ||
        (distance !== null &&
          position !== null &&
          position.accuracy <= MAX_USEFUL_ACCURACY &&
          distance <= place.radius + Math.min(position.accuracy, place.radius));
      return { place, distance, here, tasks: openTasksAt(tasks, place.id) };
    })
    .filter(g => g.tasks.length > 0 || g.place.id === manualPlaceId);
  return groups.sort((a, b) => {
    if ((a.place.id === manualPlaceId) !== (b.place.id === manualPlaceId))
      return a.place.id === manualPlaceId ? -1 : 1;
    if (a.here !== b.here) return a.here ? -1 : 1;
    if (a.distance !== null && b.distance !== null)
      return a.distance - b.distance;
    if (a.distance !== null) return -1;
    if (b.distance !== null) return 1;
    return a.place.name.localeCompare(b.place.name);
  });
}

/** Per-place visit memory kept on the device. */
export interface VisitState {
  [placeId: string]: { inside: boolean; lastRang: number | null };
}

/**
 * Compare a new reading with saved places. A place "arrives" when you go
 * from outside (or unknown) to inside it, it has open tasks, and it has not
 * rung in the last 30 minutes. Leaving needs a clear margin so standing at
 * the edge does not ring repeatedly.
 */
export function arrivals(
  state: VisitState,
  places: Place[],
  tasks: Task[],
  position: Position,
  nowMs: number
): { state: VisitState; arrived: { place: Place; tasks: Task[] }[] } {
  if (
    !Number.isFinite(position.accuracy) ||
    position.accuracy > MAX_USEFUL_ACCURACY
  )
    return { state, arrived: [] };
  const next: VisitState = {};
  const arrived: { place: Place; tasks: Task[] }[] = [];
  for (const place of places) {
    const before = state[place.id] ?? { inside: false, lastRang: null };
    const slack = Math.min(position.accuracy, place.radius);
    const distance = distanceMeters(position, place);
    let inside = before.inside;
    if (!before.inside && distance <= place.radius + slack) inside = true;
    else if (before.inside && distance > place.radius * 1.5 + slack)
      inside = false;
    let lastRang = before.lastRang;
    if (inside && !before.inside) {
      const open = openTasksAt(tasks, place.id);
      const cooled =
        lastRang === null || nowMs - lastRang >= ARRIVAL_COOLDOWN_MS;
      if (open.length && cooled) {
        arrived.push({ place, tasks: open });
        lastRang = nowMs;
      }
    }
    next[place.id] = { inside, lastRang };
  }
  return { state: next, arrived };
}

export function arrivalSpeech(place: Place, tasks: Task[]): string {
  const names = tasks.slice(0, 3).map(t => t.title);
  const more = tasks.length > 3 ? `, and ${tasks.length - 3} more` : "";
  return tasks.length === 1
    ? `You're at ${place.name}. One thing here: ${names[0]}.`
    : `You're at ${place.name}. ${tasks.length} things here: ${names.join(", ")}${more}.`;
}
