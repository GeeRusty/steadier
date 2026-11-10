import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { validateWorkspace } from "./transfer";
import {
  ARRIVAL_COOLDOWN_MS,
  addPlace,
  arrivalSpeech,
  arrivals,
  distanceMeters,
  googleMapsDirectionsUrl,
  nearGroups,
  parseCoordinates,
  removePlace,
  setTaskPlace,
  type VisitState,
} from "./places";
import type { Task, Workspace } from "./types";

const NOW = "2026-10-27";
const BUNNINGS = { lat: -34.9331437, lng: 138.5754276 };
const CBD = { lat: -34.9285, lng: 138.6007 };

function task(title: string, extra: Partial<Task> = {}): Task {
  return createTask({ title, createdAt: `${NOW}T09:00:00`, ...extra }, NOW);
}
function base(tasks: Task[]): Workspace {
  return validateWorkspace({ version: 1, tasks, focus: null });
}
function withBunnings(tasks: Task[]) {
  const r = addPlace(base(tasks), { name: "Bunnings", ...BUNNINGS });
  expect(r.error).toBeNull();
  return { workspace: r.workspace, place: r.place! };
}

describe("places", () => {
  it("measures distance sensibly", () => {
    const d = distanceMeters(BUNNINGS, CBD);
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3000);
  });

  it("reads coordinates and Google Maps links", () => {
    expect(parseCoordinates("-34.93, 138.58")).toEqual({
      lat: -34.93,
      lng: 138.58,
    });
    expect(
      parseCoordinates(
        "https://www.google.com/maps/place/Bunnings/@-34.9331,138.5754,17z"
      )
    ).toEqual({ lat: -34.9331, lng: 138.5754 });
    expect(
      parseCoordinates("https://maps.google.com/?q=-34.9331,138.5754")
    ).toEqual({ lat: -34.9331, lng: 138.5754 });
    expect(parseCoordinates("data=!3d-34.9331!4d138.5754")).toEqual({
      lat: -34.9331,
      lng: 138.5754,
    });
    expect(parseCoordinates("Bunnings")).toBeNull();
    expect(parseCoordinates("200, 10")).toBeNull();
  });

  it("builds directions from the saved Place coordinates and rejects invalid coordinates", () => {
    const { place } = withBunnings([]);
    expect(googleMapsDirectionsUrl(place)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-34.933144%2C138.575428"
    );
    expect(googleMapsDirectionsUrl({ lat: 123, lng: 0 })).toBeNull();
  });

  it("refuses duplicate names and bad locations", () => {
    const { workspace } = withBunnings([]);
    expect(addPlace(workspace, { name: "bunnings", ...CBD }).error).toMatch(
      /already/
    );
    expect(addPlace(workspace, { name: "X", lat: 0, lng: 0 }).error).toMatch(
      /could not be read/
    );
    expect(addPlace(workspace, { name: " ", ...CBD }).error).toMatch(/name/);
  });

  it("sets and clears a task's place with history; removing a place keeps tasks", () => {
    const t = task("Buy screws");
    const { workspace, place } = withBunnings([t]);
    const placed = setTaskPlace(
      workspace.tasks[0],
      place.id,
      workspace.places!,
      NOW
    );
    expect(placed.placeId).toBe(place.id);
    expect(placed.history.at(-1)!.text).toBe("Place set: Bunnings.");
    const cleared = setTaskPlace(placed, null, workspace.places!, NOW);
    expect("placeId" in cleared).toBe(false);
    const w2 = removePlace({ ...workspace, tasks: [placed] }, place.id, NOW);
    expect(w2.places).toEqual([]);
    expect(w2.tasks).toHaveLength(1);
    expect("placeId" in w2.tasks[0]).toBe(false);
  });

  it("groups nearby tasks: chosen place first, then where you are, then nearest", () => {
    const { workspace, place } = withBunnings([]);
    const work = addPlace(workspace, { name: "Work", ...CBD });
    const places = work.workspace.places!;
    const tasks = [
      { ...task("Buy screws"), placeId: place.id },
      { ...task("Print forms"), placeId: work.place!.id },
      { ...task("Done one", { state: "done" }), placeId: place.id },
    ];
    const atWork = nearGroups(tasks, places, { ...CBD, accuracy: 20 }, null);
    expect(atWork.map(g => [g.place.name, g.here])).toEqual([
      ["Work", true],
      ["Bunnings", false],
    ]);
    expect(atWork[1].tasks.map(t => t.title)).toEqual(["Buy screws"]);
    const chosen = nearGroups(
      tasks,
      places,
      { ...CBD, accuracy: 20 },
      place.id
    );
    expect(chosen[0].place.name).toBe("Bunnings");
    expect(chosen[0].here).toBe(true);
    expect(
      nearGroups(tasks, places, null, null).map(g => g.place.name)
    ).toEqual(["Bunnings", "Work"]);
  });

  it("rings once per visit, not at the edge, and not again within 30 minutes", () => {
    const { workspace, place } = withBunnings([]);
    const places = workspace.places!;
    const tasks = [{ ...task("Buy screws"), placeId: place.id }];
    let state: VisitState = {};
    const at = (
      p: { lat: number; lng: number },
      accuracy: number,
      ms: number
    ) => {
      const r = arrivals(state, places, tasks, { ...p, accuracy }, ms);
      state = r.state;
      return r.arrived.map(a => a.place.name);
    };
    expect(at(CBD, 20, 0)).toEqual([]);
    expect(at(BUNNINGS, 20, 1000)).toEqual(["Bunnings"]);
    expect(at(BUNNINGS, 20, 2000)).toEqual([]); // still there
    expect(
      at({ lat: BUNNINGS.lat + 0.0017, lng: BUNNINGS.lng }, 20, 3000)
    ).toEqual([]); // edge, ~190 m
    expect(at(CBD, 20, 4000)).toEqual([]); // left
    expect(at(BUNNINGS, 20, 5000)).toEqual([]); // back too soon
    expect(at(CBD, 20, 6000)).toEqual([]);
    expect(at(BUNNINGS, 20, 6000 + ARRIVAL_COOLDOWN_MS)).toEqual(["Bunnings"]);
    // A vague reading is ignored entirely.
    expect(
      arrivals({}, places, tasks, { ...BUNNINGS, accuracy: 5000 }, 0).arrived
    ).toEqual([]);
    // No open tasks there: no ring.
    expect(
      arrivals({}, places, [], { ...BUNNINGS, accuracy: 10 }, 0).arrived
    ).toEqual([]);
  });

  it("speaks a short arrival line", () => {
    const { place } = withBunnings([]);
    expect(arrivalSpeech(place, [task("Buy screws")])).toBe(
      "You're at Bunnings. One thing here: Buy screws."
    );
    const four = ["A", "B", "C", "D"].map(t => task(t));
    expect(arrivalSpeech(place, four)).toBe(
      "You're at Bunnings. 4 things here: A, B, C, and 1 more."
    );
  });

  it("saves and loads places and task links; old records stay unchanged", () => {
    const t = task("Buy screws");
    const { workspace, place } = withBunnings([t]);
    const placed = {
      ...workspace,
      tasks: [{ ...workspace.tasks[0], placeId: place.id }],
    };
    const loaded = validateWorkspace(JSON.parse(JSON.stringify(placed)));
    expect(loaded.places).toEqual([place]);
    expect(loaded.tasks[0].placeId).toBe(place.id);
    // A workspace without places has no places key at all.
    expect("places" in base([t])).toBe(false);
    // Links to a missing place are dropped, the task is kept.
    const orphan = JSON.parse(JSON.stringify({ ...placed, places: [] }));
    const reloaded = validateWorkspace(orphan);
    expect(reloaded.tasks).toHaveLength(1);
    expect("placeId" in reloaded.tasks[0]).toBe(false);
    // Extra or bad place fields are refused.
    const bad = JSON.parse(JSON.stringify(placed));
    bad.places[0].lat = 123;
    expect(() => validateWorkspace(bad)).toThrow();
  });
});
