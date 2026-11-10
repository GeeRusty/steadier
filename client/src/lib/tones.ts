/**
 * Gentle in-app tones, synthesised with Web Audio (no sound files). They play
 * only while Steadier is open; a phone's own calendar handles closed-app alarms.
 * Settings are per device, because sound suits a phone and not always a laptop.
 */

export type ToneSettings = {
  /** Master switch for every tone. */
  enabled: boolean;
  /** 0.05–1. */
  volume: number;
  /** Short vibration with each tone, where the phone supports it. */
  vibrate: boolean;
  /** Speak a short prompt after the tone (uses the device voice). */
  speak: boolean;
  /** A soft halfway check-in during focus blocks of 10 minutes or more. */
  halfway: boolean;
  /** Ring for task reminders while Steadier is open. */
  reminders: boolean;
};

export type ToneKind = "end" | "halfway" | "chime" | "test" | "reminder";

const STORAGE_KEY = "steadier.tones.v1";

export const DEFAULT_TONES: ToneSettings = {
  enabled: true,
  volume: 0.5,
  vibrate: true,
  speak: true,
  halfway: true,
  reminders: true,
};

export function readToneSettings(): ToneSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TONES };
    const parsed = JSON.parse(raw) as Partial<ToneSettings>;
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_TONES.enabled,
      volume:
        typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
          ? Math.min(1, Math.max(0.05, parsed.volume))
          : DEFAULT_TONES.volume,
      vibrate:
        typeof parsed.vibrate === "boolean"
          ? parsed.vibrate
          : DEFAULT_TONES.vibrate,
      speak:
        typeof parsed.speak === "boolean" ? parsed.speak : DEFAULT_TONES.speak,
      halfway:
        typeof parsed.halfway === "boolean"
          ? parsed.halfway
          : DEFAULT_TONES.halfway,
      reminders:
        typeof parsed.reminders === "boolean"
          ? parsed.reminders
          : DEFAULT_TONES.reminders,
    };
  } catch {
    return { ...DEFAULT_TONES };
  }
}

/** Calendar task timer cues stay automatic even if optional tones are off. */
export function alwaysOnFocusToneSettings(
  settings: ToneSettings
): ToneSettings {
  return { ...settings, enabled: true };
}

export function writeToneSettings(settings: ToneSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("steadier-tones-changed"));
    return true;
  } catch {
    return false;
  }
}

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/**
 * Phones only allow sound after a tap. Call once from any user gesture so a
 * later timer-driven tone can play.
 */
export function unlockTones(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended")
    void ctx.resume().catch(() => undefined);
}

/** A soft bell: a few sine partials with a slow natural decay. */
function bell(
  ctx: AudioContext,
  start: number,
  frequency: number,
  volume: number,
  length: number
) {
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.01, 0.35],
    [3.0, 0.12],
  ];
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, 0.32 * volume),
    start + 0.03
  );
  master.gain.exponentialRampToValueAtTime(0.0001, start + length);
  master.connect(ctx.destination);
  for (const [ratio, level] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * ratio, start);
    gain.gain.setValueAtTime(level, start);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

const VIBRATION: Record<ToneKind, number[]> = {
  end: [180, 120, 180],
  halfway: [90],
  chime: [90],
  test: [120],
  reminder: [200, 100, 200, 100, 300],
};

/** Plays a tone if enabled. Returns false when sound is off or unavailable. */
export function playTone(
  kind: ToneKind,
  settings: ToneSettings = readToneSettings()
): boolean {
  if (!settings.enabled) return false;
  if (
    settings.vibrate &&
    typeof navigator !== "undefined" &&
    "vibrate" in navigator
  ) {
    try {
      navigator.vibrate(VIBRATION[kind]);
    } catch {
      // Vibration is optional.
    }
  }
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const now = ctx.currentTime + 0.02;
  const v = settings.volume;
  if (kind === "end") {
    // Two rising notes (G5 → C6), then a quieter echo: "time's up", calmly.
    bell(ctx, now, 784, v, 1.6);
    bell(ctx, now + 0.38, 1047, v, 2.2);
    bell(ctx, now + 1.5, 1047, v * 0.4, 1.8);
  } else if (kind === "reminder") {
    // Three bright notes (E5 → G5 → C6), repeated softly: "heads up".
    bell(ctx, now, 659, v, 1.2);
    bell(ctx, now + 0.22, 784, v, 1.2);
    bell(ctx, now + 0.44, 1047, v, 1.8);
    bell(ctx, now + 1.6, 659, v * 0.5, 1.0);
    bell(ctx, now + 1.82, 784, v * 0.5, 1.0);
    bell(ctx, now + 2.04, 1047, v * 0.5, 1.6);
  } else if (kind === "halfway") {
    // One soft low note: a check-in, not an alarm.
    bell(ctx, now, 659, v * 0.7, 1.8);
  } else if (kind === "chime") {
    // A gentle single bell for an elapsed-time check-in.
    bell(ctx, now, 880, v * 0.75, 1.4);
  } else {
    bell(ctx, now, 880, v, 1.4);
  }
  return true;
}
