import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Place, Task } from "../domain/types";
import {
  arrivalSpeech,
  arrivals,
  type Position,
  type VisitState,
} from "../domain/places";
import { playTone, readToneSettings } from "../lib/tones";
import { systemNotify } from "./useReminders";

const SETTINGS_KEY = "steadier.location.v1";
const VISITS_KEY = "steadier.location.visits.v1";

export type LocationStatus =
  | "off"
  | "starting"
  | "on"
  | "denied"
  | "unavailable"
  | "error";

export interface LocationControls {
  enabled: boolean;
  status: LocationStatus;
  /** Latest reading; kept in memory only. */
  position: Position | null;
  message: string;
  enable: () => void;
  disable: () => void;
  /** One reading now (for "Near me" and "use my current location"). */
  locateOnce: () => Promise<Position | null>;
}

type Speaker = { read: (text: string) => void; speechSupported: boolean };

function readEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw).enabled === true : false;
  } catch {
    return false;
  }
}
function writeEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled }));
  } catch {
    // Without storage the switch resets on reload; harmless.
  }
}
function readVisits(): VisitState {
  try {
    const raw = window.localStorage.getItem(VISITS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeVisits(state: VisitState) {
  try {
    window.localStorage.setItem(VISITS_KEY, JSON.stringify(state));
  } catch {
    // A place may ring again after reload; harmless.
  }
}

function geo(): Geolocation | null {
  return typeof navigator !== "undefined" && navigator.geolocation
    ? navigator.geolocation
    : null;
}
function toPosition(p: GeolocationPosition): Position {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
  };
}
function explain(error: GeolocationPositionError): {
  status: LocationStatus;
  message: string;
} {
  if (error.code === error.PERMISSION_DENIED)
    return {
      status: "denied",
      message:
        "Location is blocked for Steadier. Allow it in Chrome: tap the icon left of the address, then Permissions, then Location.",
    };
  if (error.code === error.TIMEOUT)
    return {
      status: "error",
      message: "Could not get a location fix yet. It will keep trying.",
    };
  return {
    status: "error",
    message:
      "Location is not available right now. Check that phone location is on.",
  };
}

/**
 * Location reminders while Steadier is open. Off until the owner turns it
 * on. Each place rings once per visit (and not again within 30 minutes).
 */
export function useLocationReminders(
  places: Place[],
  tasks: Task[],
  voice: Speaker,
  onOpen: (taskId: string) => void
): LocationControls {
  const [enabled, setEnabled] = useState<boolean>(() => readEnabled());
  const [status, setStatus] = useState<LocationStatus>(() =>
    geo() ? "off" : "unavailable"
  );
  const [position, setPosition] = useState<Position | null>(null);
  const [message, setMessage] = useState("");
  const latest = useRef({ places, tasks, voice, onOpen });
  latest.current = { places, tasks, voice, onOpen };

  const handleReading = useCallback((reading: Position) => {
    setPosition(reading);
    const { places, tasks, voice, onOpen } = latest.current;
    if (!places.length) return;
    const result = arrivals(readVisits(), places, tasks, reading, Date.now());
    writeVisits(result.state);
    if (!result.arrived.length) return;
    const settings = readToneSettings();
    if (settings.reminders) playTone("reminder", settings);
    for (const { place, tasks: here } of result.arrived) {
      const body = here
        .slice(0, 3)
        .map(t => t.title)
        .join(" · ");
      toast(`You're at ${place.name}`, {
        description: here.length > 3 ? `${body} · +${here.length - 3}` : body,
        duration: 120_000,
        action: { label: "Open", onClick: () => onOpen(here[0].id) },
      });
      if (document.visibilityState !== "visible")
        void systemNotify(`You're at ${place.name}`, body);
    }
    if (settings.speak && voice.speechSupported) {
      const first = result.arrived[0];
      voice.read(arrivalSpeech(first.place, first.tasks));
    }
  }, []);

  // Watch while switched on and the page is open on screen.
  useEffect(() => {
    const g = geo();
    if (!enabled || !g) return;
    let watchId: number | null = null;
    const start = () => {
      if (watchId !== null || document.visibilityState !== "visible") return;
      setStatus(s => (s === "on" ? s : "starting"));
      watchId = g.watchPosition(
        p => {
          setStatus("on");
          setMessage("");
          handleReading(toPosition(p));
        },
        error => {
          const e = explain(error);
          setStatus(e.status);
          setMessage(e.message);
        },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 }
      );
    };
    const stop = () => {
      if (watchId !== null) g.clearWatch(watchId);
      watchId = null;
    };
    const onVisibility = () =>
      document.visibilityState === "visible" ? start() : stop();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, handleReading]);

  const locateOnce = useCallback(
    () =>
      new Promise<Position | null>(resolve => {
        const g = geo();
        if (!g) {
          setStatus("unavailable");
          setMessage("This browser cannot share a location.");
          resolve(null);
          return;
        }
        g.getCurrentPosition(
          p => {
            const reading = toPosition(p);
            setPosition(reading);
            setMessage("");
            resolve(reading);
          },
          error => {
            const e = explain(error);
            setMessage(e.message);
            if (e.status === "denied") setStatus("denied");
            resolve(null);
          },
          { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
        );
      }),
    []
  );

  const enable = useCallback(() => {
    writeEnabled(true);
    setEnabled(true);
    setStatus(geo() ? "starting" : "unavailable");
  }, []);
  const disable = useCallback(() => {
    writeEnabled(false);
    setEnabled(false);
    setStatus(geo() ? "off" : "unavailable");
    setMessage("");
  }, []);

  return { enabled, status, position, message, enable, disable, locateOnce };
}
