/**
 * Steadier keeps every calendar date and every human-facing time in one zone,
 * regardless of the device, browser or server clock zone. Instants remain
 * valid ISO-8601 strings; only their presentation offset is Adelaide's.
 */
export const STEADIER_TIME_ZONE = "Australia/Adelaide";

type WallClock = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

const wallClockFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STEADIER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallClock(now: Date): WallClock {
  const values = Object.fromEntries(
    wallClockFormat
      .formatToParts(now)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  ) as Record<string, string>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // Some engines render midnight as "24" even with h23.
    hour: values.hour === "24" ? "00" : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

/** Today's (or the given instant's) calendar date in Adelaide, YYYY-MM-DD. */
export function adelaideDate(now: Date = new Date()): string {
  const clock = wallClock(now);
  return `${clock.year}-${clock.month}-${clock.day}`;
}

/** Adelaide's UTC offset in minutes at an instant (+570 ACST, +630 ACDT). */
export function adelaideOffsetMinutes(now: Date = new Date()): number {
  const clock = wallClock(now);
  const asUtc = Date.UTC(
    Number(clock.year),
    Number(clock.month) - 1,
    Number(clock.day),
    Number(clock.hour),
    Number(clock.minute),
    Number(clock.second)
  );
  const wholeSeconds = Math.floor(now.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
}

function offsetLabel(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const rest = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${rest}`;
}

/** An ISO-8601 instant written in Adelaide wall-clock time with its offset. */
export function adelaideTimestamp(now: Date = new Date()): string {
  const clock = wallClock(now);
  return `${clock.year}-${clock.month}-${clock.day}T${clock.hour}:${clock.minute}:${clock.second}${offsetLabel(adelaideOffsetMinutes(now))}`;
}

const ZONED_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** True when a stored stamp carries an actual time and zone, not a day placeholder. */
export function hasRecordedTime(value: string | null | undefined): boolean {
  return typeof value === "string" && ZONED_INSTANT.test(value);
}

/**
 * Present an instant in Adelaide. Older day-only stamps (YYYY-MM-DDT12:00:00
 * without a zone) were already Adelaide calendar days, so they pass through.
 */
export function toAdelaideIso(value: string): string;
export function toAdelaideIso(value: string | null): string | null;
export function toAdelaideIso(value: string | null): string | null {
  if (value === null) return null;
  if (!hasRecordedTime(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : adelaideTimestamp(parsed);
}

const displayDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: STEADIER_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const displayDateTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: STEADIER_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** Human display in Adelaide, e.g. "25 Oct 2026, 2:42 pm". */
export function formatAdelaide(
  value: string | null | undefined,
  options: { time?: boolean } = {}
): string {
  if (!value) return "";
  if (!hasRecordedTime(value)) {
    // A day-only placeholder: show its calendar date without inventing a time.
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return value;
    return displayDate.format(
      new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
      )
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return (options.time === false ? displayDate : displayDateTime).format(
    parsed
  );
}
