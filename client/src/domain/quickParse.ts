/**
 * Natural-language quick add, Todoist-style, for typed or spoken capture:
 *   "call Sam tomorrow 3pm for 30 min every Tuesday remind me 15 min before"
 * Australian date order (12/11 = 12 November). Times are Adelaide wall-clock.
 * Only recognised phrases are removed from the title; everything else stays.
 */
import {
  emptyRepeat,
  emptyTaskSchedule,
  describeFlexibleWindow,
  isDate,
  minutesToTime,
  nextWeekWindow,
  nextOccurrence,
  shiftDays,
  thisWeekendWindow,
  weekdayOf,
  type FlexibleTimeWindow,
  type RepeatRule,
  type TaskSchedule,
} from "./time";

export interface QuickParse {
  title: string;
  date: string | null;
  time: string | null;
  minutes: number | null;
  flexibleWindow: FlexibleTimeWindow | null;
  deadline: string | null;
  deadlineTime: string | null;
  repeat: RepeatRule | null;
  reminders: { minutesBefore: number; anchor: "slot" | "deadline" }[];
  fixed: boolean;
  /** Human-readable pieces that were understood, for confirmation chips. */
  understood: string[];
}

export interface QuickParseScheduleOptions {
  fallbackDate?: string | null;
  fallbackTime?: string | null;
  flexibleWindowReminders?: "deadline" | "none";
}

/** Build a validator-compatible schedule without serializing absent optional fields. */
export function scheduleFromQuickParse(
  parsed: QuickParse,
  options: QuickParseScheduleOptions = {}
): TaskSchedule {
  const windowReminderPolicy = options.flexibleWindowReminders ?? "deadline";
  return {
    ...emptyTaskSchedule(),
    date: parsed.flexibleWindow
      ? null
      : (parsed.date ?? options.fallbackDate ?? null),
    time: parsed.flexibleWindow
      ? null
      : (parsed.time ?? options.fallbackTime ?? null),
    minutes: parsed.minutes,
    fixed: parsed.flexibleWindow ? false : parsed.fixed,
    ...(parsed.flexibleWindow ? { flexibleWindow: parsed.flexibleWindow } : {}),
    deadlineTime: parsed.deadlineTime,
    repeat: parsed.repeat,
    reminders: parsed.reminders
      .filter(
        reminder =>
          !parsed.flexibleWindow ||
          (windowReminderPolicy === "deadline" &&
            reminder.anchor === "deadline")
      )
      .map((reminder, index) => ({ id: `rem-${index + 1}`, ...reminder })),
  };
}

const DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};
const DAY_RE =
  "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  last: -1,
};
const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  "forty five": 45,
  ninety: 90,
};
const NUM =
  "(?:\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|ninety)";

function num(value: string): number {
  const v = value.toLowerCase();
  return NUM_WORDS[v] ?? Number(v);
}

function dayNumber(value: string): number {
  return (
    DAYS[value.toLowerCase().replace(/\.$/, "")] ??
    DAYS[value.toLowerCase().slice(0, 3)]
  );
}

function weekdayList(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${DAY_RE}\\b`, "gi")))
    out.push(dayNumber(m[1]));
  return [...new Set(out)].sort();
}

/** Next date (on or after today unless strictlyAfter) falling on weekday. */
function nextWeekday(
  today: string,
  weekday: number,
  strictlyAfter = false
): string {
  let diff = (weekday - weekdayOf(today) + 7) % 7;
  if (diff === 0 && strictlyAfter) diff = 7;
  return shiftDays(today, diff);
}

function buildDate(
  today: string,
  day: number,
  month0: number,
  year?: number
): string | null {
  const [ty] = today.split("-").map(Number);
  const make = (y: number) =>
    `${y}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (year !== undefined) {
    const full = year < 100 ? 2000 + year : year;
    const candidate = make(full);
    return isDate(candidate) ? candidate : null;
  }
  let candidate = make(ty);
  if (!isDate(candidate)) return null;
  if (candidate < today) candidate = make(ty + 1);
  return isDate(candidate) ? candidate : null;
}

function parseClock(
  hour: string,
  minute: string | undefined,
  meridiem: string | undefined
): string | null {
  let h = Number(hour);
  const m = minute ? Number(minute) : 0;
  if (Number.isNaN(h) || h > 23 || m > 59) return null;
  const mer = meridiem?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 6) h += 12; // "at 3" means 3 pm for everyday tasks
  return minutesToTime(h * 60 + m);
}

type Found = { start: number; end: number };

export function parseQuickAdd(
  input: string,
  today: string,
  nowMinutes = 0
): QuickParse {
  let text = ` ${input.replace(/\s+/g, " ").trim()} `;
  const result: QuickParse = {
    title: input.trim(),
    date: null,
    time: null,
    minutes: null,
    flexibleWindow: null,
    deadline: null,
    deadlineTime: null,
    repeat: null,
    reminders: [],
    fixed: false,
    understood: [],
  };
  const cut = (re: RegExp): RegExpExecArray | null => {
    const match = re.exec(text);
    if (!match) return null;
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    return match;
  };

  // ---- Reminders ----------------------------------------------------------
  for (;;) {
    const m = cut(
      new RegExp(
        `\\bremind(?: me)?(?: (${NUM}) ?(min(?:ute)?s?|m|hours?|hrs?|h|days?|d) (?:before|earlier|ahead)| (the )?day before| (?:at the time|on time))\\b`,
        "i"
      )
    );
    if (!m) break;
    let minutes = 0;
    if (m[1]) {
      const n = num(m[1]);
      const unit = m[2].toLowerCase();
      minutes = unit.startsWith("d")
        ? n * 1440
        : unit.startsWith("h")
          ? n * 60
          : n;
    } else if (/day before/i.test(m[0])) {
      minutes = 1440;
    }
    result.reminders.push({
      minutesBefore: Math.round(minutes),
      anchor: "slot",
    });
  }

  // ---- Repeat -------------------------------------------------------------
  let repeat: RepeatRule | null = null;
  let m: RegExpExecArray | null;
  if (
    (m = cut(
      new RegExp(
        `\\b(?:every|each) (${NUM}) ?(days?|weeks?) (?:after|from) (?:i )?(?:done|completion|finish(?:ing|ed)?|complet(?:e|ed|ing))\\b`,
        "i"
      )
    ))
  ) {
    const n = num(m[1]);
    repeat = {
      ...emptyRepeat("after"),
      interval: m[2].toLowerCase().startsWith("w") ? n * 7 : n,
    };
  } else if (
    (m = cut(
      new RegExp(
        `\\b(${NUM}) ?(days?|weeks?) after (?:done|completion|finishing|completed)\\b`,
        "i"
      )
    ))
  ) {
    const n = num(m[1]);
    repeat = {
      ...emptyRepeat("after"),
      interval: m[2].toLowerCase().startsWith("w") ? n * 7 : n,
    };
  } else if (
    (m = cut(
      new RegExp(
        `\\b(?:every|each|on the) (first|1st|second|2nd|third|3rd|fourth|4th|last) ${DAY_RE}(?: of (?:the|every|each) month)?\\b`,
        "i"
      )
    ))
  ) {
    repeat = {
      ...emptyRepeat("monthly"),
      nthWeekday: { n: ORD[m[1].toLowerCase()], weekday: dayNumber(m[2]) },
    };
  } else if (
    (m = cut(
      /\b(?:on )?(?:the )?last day of (?:the |every |each )?month\b|\bevery month on the last day\b/i
    ))
  ) {
    repeat = { ...emptyRepeat("monthly"), monthDay: -1 };
  } else if (
    (m = cut(
      /\b(?:every|each) month on the (\d{1,2})(?:st|nd|rd|th)?\b|\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)? of (?:every|each) month\b|\bmonthly on the (\d{1,2})(?:st|nd|rd|th)?\b/i
    ))
  ) {
    const day = Number(m[1] ?? m[2] ?? m[3]);
    if (day >= 1 && day <= 31)
      repeat = { ...emptyRepeat("monthly"), monthDay: day };
  } else if (
    (m = cut(/\b(?:every|each) weekday\b|\bweekdays\b|\bon weekdays\b/i))
  ) {
    repeat = { ...emptyRepeat("weekly"), weekdays: [1, 2, 3, 4, 5] };
  } else if ((m = cut(/\b(?:every|each) weekend\b|\bweekends\b/i))) {
    // One recurring weekend is a Sat–Sun availability window, not two
    // independent appointments. The next window is created only on completion.
    repeat = { ...emptyRepeat("weekly"), weekdays: [6] };
    result.flexibleWindow = thisWeekendWindow(today);
  } else if (
    (m = cut(
      new RegExp(
        `\\b(?:every|each)(?: (other|${NUM}) weeks? on)? ${DAY_RE}(?:(?:,| and|, and| &) ${DAY_RE})*\\b`,
        "i"
      )
    ))
  ) {
    const interval = m[1]
      ? m[1].toLowerCase() === "other"
        ? 2
        : num(m[1])
      : 1;
    repeat = {
      ...emptyRepeat("weekly"),
      interval,
      weekdays: weekdayList(m[0]),
    };
  } else if (
    (m = cut(
      new RegExp(
        `\\bevery (other|${NUM}) (days?|weeks?|months?|years?)\\b`,
        "i"
      )
    ))
  ) {
    const interval = m[1].toLowerCase() === "other" ? 2 : num(m[1]);
    const unit = m[2].toLowerCase();
    repeat = {
      ...emptyRepeat(
        unit.startsWith("d")
          ? "daily"
          : unit.startsWith("w")
            ? "weekly"
            : unit.startsWith("m")
              ? "monthly"
              : "yearly"
      ),
      interval,
    };
  } else if (
    (m = cut(
      /\b(?:every|each) (day|week|fortnight|month|year)\b|\b(daily|weekly|fortnightly|monthly|yearly|annually)\b/i
    ))
  ) {
    const word = (m[1] ?? m[2]).toLowerCase();
    if (word === "day" || word === "daily") repeat = emptyRepeat("daily");
    else if (word === "week" || word === "weekly")
      repeat = emptyRepeat("weekly");
    else if (word === "fortnight" || word === "fortnightly")
      repeat = { ...emptyRepeat("weekly"), interval: 2 };
    else if (word === "month" || word === "monthly")
      repeat = emptyRepeat("monthly");
    else repeat = emptyRepeat("yearly");
  }
  if (repeat) {
    const until = cut(
      new RegExp(
        `\\buntil (\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)? ${MONTH_RE}(?: \\d{2,4})?|${MONTH_RE} \\d{1,2}(?:st|nd|rd|th)?(?: \\d{2,4})?)\\b`,
        "i"
      )
    );
    if (until) repeat.until = dateFromPhrase(until[1], today);
    const times = cut(/\bfor (\d+) times\b|\b(\d+) times\b/i);
    if (times) repeat.count = Number(times[1] ?? times[2]);
  }

  // ---- Duration -----------------------------------------------------------
  if (
    (m = cut(
      new RegExp(
        `\\bfor (${NUM}) ?(?:and a half )?(hours?|hrs?|h)(?: and (\\d+) ?(?:min(?:ute)?s?|m))?\\b`,
        "i"
      )
    ))
  ) {
    let minutes = num(m[1]) * 60 + (m[3] ? Number(m[3]) : 0);
    if (/and a half/i.test(m[0])) minutes += 30;
    result.minutes = Math.round(minutes);
  } else if (
    (m = cut(new RegExp(`\\bfor (${NUM}) ?(?:min(?:ute)?s?|m)\\b`, "i")))
  ) {
    result.minutes = Math.round(num(m[1]));
  } else if ((m = cut(/\bfor (?:half an hour|a half hour)\b/i))) {
    result.minutes = 30;
  } else if (
    (m = cut(
      new RegExp(
        `\\b(${NUM}) ?(?:hours?|hrs?)(?: and (\\d+) ?(?:min(?:ute)?s?|m))?\\b`,
        "i"
      )
    ))
  ) {
    result.minutes = Math.round(num(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
  } else if ((m = cut(/\b(\d+)h(\d{1,2})?\b|\b(\d+) ?(?:min|mins|m)\b/i))) {
    result.minutes = m[1]
      ? Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)
      : Number(m[3]);
  }

  // ---- Deadline ("by …" / "due …") ---------------------------------------
  const datePhrase = `(today|tonight|tomorrow|tmrw?|tmr|the day after tomorrow|(?:this |next )?${DAY_RE}|this weekend|next week|end of (?:the )?(?:week|month)|in ${NUM} (?:days?|weeks?|months?)|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?${MONTH_RE}(?: \\d{4})?|${MONTH_RE} \\d{1,2}(?:st|nd|rd|th)?(?: \\d{4})?)`;
  const clock = `(?:at )?(\\d{1,2})(?::(\\d{2}))? ?(am|pm|a\\.m\\.|p\\.m\\.)?`;
  if (
    (m = cut(
      new RegExp(
        `\\b(?:by|due|due by|deadline) ${datePhrase}(?: ${clock}(?=\\s|$))?`,
        "i"
      )
    ))
  ) {
    result.deadline = dateFromPhrase(m[1], today);
    if (m[m.length - 3] && (m[m.length - 1] || m[m.length - 2])) {
      result.deadlineTime = parseClock(
        m[m.length - 3],
        m[m.length - 2],
        m[m.length - 1]
      );
    }
  }

  // Explicit availability phrases become inclusive windows. Bare "today" or
  // "tomorrow" keeps its existing fixed-date meaning; users can choose the
  // one-day flexible preset or say "available today" / "within tomorrow".
  if (
    (m = cut(
      /\b(?:(?:do|finish|work on|within|during|available|anytime|any time|flexible(?: window)? for)\s+)?(this weekend|next week)\b/i
    ))
  ) {
    const phrase = m[1].toLowerCase();
    result.flexibleWindow =
      phrase === "this weekend"
        ? thisWeekendWindow(today)
        : nextWeekWindow(today);
  } else if (
    (m = cut(
      /\b(?:available|anytime|any time|within|do|finish|flexible(?: window)? for)\s+(today|tomorrow|tmrw?|tmr)\b/i
    ))
  ) {
    const date = /today/i.test(m[1]) ? today : shiftDays(today, 1);
    result.flexibleWindow = { startDate: date, endDate: date };
  }

  // ---- Planned date -------------------------------------------------------
  if (
    !result.flexibleWindow &&
    (m = cut(new RegExp(`\\b(?:on |for )?${datePhrase}\\b(?!['’]s)`, "i")))
  ) {
    result.date = dateFromPhrase(m[1], today);
    if (/^tonight$/i.test(m[1])) result.time = "19:00";
  }

  // ---- Time of day --------------------------------------------------------
  if (!result.time) {
    if ((m = cut(/\b(?:at )?(noon|midday)\b/i))) result.time = "12:00";
    else if ((m = cut(/\b(?:at )?midnight\b/i))) result.time = "00:00";
    else if (
      (m = cut(
        /\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)(?=\s|$)/i
      ))
    )
      result.time = parseClock(m[1], m[2], m[3]);
    else if ((m = cut(/\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)\b/i)))
      result.time = parseClock(
        m[1],
        m[2],
        m[1].length === 2 || Number(m[1]) > 12 ? "x" : undefined
      );
    else if ((m = cut(/\bat (\d{1,2})\b/i)))
      result.time = parseClock(m[1], undefined, undefined);
    else if ((m = cut(/\b(?:in the |this )?(morning|afternoon|evening)\b/i))) {
      result.time = { morning: "09:00", afternoon: "14:00", evening: "18:00" }[
        m[1].toLowerCase() as "morning"
      ];
    }
  }

  // An explicit clock time turns a parsed availability phrase into a normal
  // fixed day/time placement. Saving remains a separate owner action.
  if (result.flexibleWindow && result.time) {
    result.date = result.flexibleWindow.startDate;
    result.flexibleWindow = null;
  }

  // ---- Fill sensible defaults ---------------------------------------------
  if (repeat) {
    if (!result.date && !result.flexibleWindow) {
      // First occurrence: today if it fits the rule, else the next one.
      const probe = shiftDays(today, -1);
      result.date = nextOccurrence(repeat, probe, today) ?? today;
      if (repeat.freq === "weekly" && repeat.weekdays.length) {
        result.date =
          nextOccurrence(
            repeat,
            probe,
            nextWeekday(today, repeat.weekdays[0])
          ) ?? today;
      }
    }
    result.repeat = repeat;
  }
  if (result.time && !result.date) {
    result.date =
      nowMinutes &&
      Number(result.time.slice(0, 2)) * 60 + Number(result.time.slice(3)) <=
        nowMinutes
        ? shiftDays(today, 1)
        : today;
  }
  if (result.reminders.length && !result.time && result.deadline) {
    result.reminders = result.reminders.map(r => ({
      ...r,
      anchor: "deadline",
    }));
  }
  if (
    /\b(appointment|appt|meeting|doctor|dentist|interview|flight)\b/i.test(
      input
    ) &&
    result.time
  ) {
    result.fixed = true;
  }

  result.title = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(?:\s|^)(?:at|on|for|by|and|from|,)\s*$/i, "")
    .replace(/^\s*(?:,|and)\s+/i, "")
    .replace(/^\s*[-–—,;:]+\s*/, "")
    .replace(/\s*[-–—,;:]+\s*$/, "")
    .trim();
  if (!result.title) result.title = input.trim();
  result.understood = describeParse(result, today);
  return result;
}

function dateFromPhrase(phrase: string, today: string): string | null {
  const p = phrase.toLowerCase().trim();
  if (p === "today" || p === "tonight") return today;
  if (/^(tomorrow|tmrw?|tmr)$/.test(p)) return shiftDays(today, 1);
  if (p === "the day after tomorrow") return shiftDays(today, 2);
  if (p === "this weekend") return nextWeekday(today, 6);
  if (p === "next week") return nextWeekday(today, 1, true);
  if (/^end of (the )?week$/.test(p)) return nextWeekday(today, 5);
  if (/^end of (the )?month$/.test(p)) {
    const [y, mo] = today.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0, 12)).toISOString().slice(0, 10);
  }
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^in (${NUM}) (days?|weeks?|months?)$`).exec(p))) {
    const n = num(m[1]);
    if (m[2].startsWith("d")) return shiftDays(today, n);
    if (m[2].startsWith("w")) return shiftDays(today, n * 7);
    const [y, mo, d] = today.split("-").map(Number);
    const target = new Date(Date.UTC(y, mo - 1 + n, 1, 12));
    const max = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)
    ).getUTCDate();
    target.setUTCDate(Math.min(d, max));
    return target.toISOString().slice(0, 10);
  }
  if ((m = new RegExp(`^(this |next )?${DAY_RE}$`).exec(p))) {
    const wd = dayNumber(m[2]);
    if (m[1]?.trim() === "next") {
      // "next Tuesday" = the Tuesday of next week.
      const mondayNext = nextWeekday(today, 1, true);
      return shiftDays(mondayNext, (wd + 6) % 7);
    }
    return nextWeekday(today, wd);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return isDate(p) ? p : null;
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(p))) {
    return buildDate(
      today,
      Number(m[1]),
      Number(m[2]) - 1,
      m[3] ? Number(m[3]) : undefined
    );
  }
  if (
    (m = new RegExp(
      `^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}(?: (\\d{4}))?$`
    ).exec(p))
  ) {
    return buildDate(
      today,
      Number(m[1]),
      MONTHS[m[2]],
      m[3] ? Number(m[3]) : undefined
    );
  }
  if (
    (m = new RegExp(
      `^${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`
    ).exec(p))
  ) {
    return buildDate(
      today,
      Number(m[2]),
      MONTHS[m[1]],
      m[3] ? Number(m[3]) : undefined
    );
  }
  return null;
}

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function friendlyDate(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDays(today, 1)) return "Tomorrow";
  if (date === shiftDays(today, -1)) return "Yesterday";
  const [y, mo, d] = date.split("-").map(Number);
  const label = `${SHORT_DAY[weekdayOf(date)]} ${d} ${SHORT_MONTH[mo - 1]}`;
  return y === Number(today.slice(0, 4)) ? label : `${label} ${y}`;
}

function friendlyTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

function friendlyReminder(minutes: number): string {
  if (minutes === 0) return "Remind at the time";
  if (minutes % 1440 === 0)
    return `Remind ${minutes / 1440} day${minutes === 1440 ? "" : "s"} before`;
  if (minutes % 60 === 0) return `Remind ${minutes / 60} h before`;
  return `Remind ${minutes} min before`;
}

function describeParse(r: QuickParse, today: string): string[] {
  const out: string[] = [];
  if (r.flexibleWindow)
    out.push(`Window: ${describeFlexibleWindow(r.flexibleWindow, today)}`);
  else if (r.date)
    out.push(
      `${friendlyDate(r.date, today)}${r.time ? ` ${friendlyTime(r.time)}` : ""}`
    );
  else if (r.time) out.push(friendlyTime(r.time));
  if (r.minutes)
    out.push(
      r.minutes >= 60
        ? `${Math.floor(r.minutes / 60)} h${r.minutes % 60 ? ` ${r.minutes % 60} min` : ""}`
        : `${r.minutes} min`
    );
  if (r.deadline)
    out.push(
      `Due ${friendlyDate(r.deadline, today)}${r.deadlineTime ? ` ${friendlyTime(r.deadlineTime)}` : ""}`
    );
  if (r.repeat) out.push(repeatChip(r.repeat));
  for (const reminder of r.reminders)
    out.push(friendlyReminder(reminder.minutesBefore));
  if (r.fixed) out.push("Fixed appointment");
  return out;
}

function repeatChip(rule: RepeatRule): string {
  // Lazy import avoided: small local copy of describeRepeat's common cases.
  const n = rule.interval;
  switch (rule.freq) {
    case "after":
      return `${n} day${n === 1 ? "" : "s"} after done`;
    case "daily":
      return n === 1 ? "Every day" : `Every ${n} days`;
    case "weekly": {
      const days = rule.weekdays;
      const weekdays =
        days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d));
      const list = weekdays
        ? "weekday"
        : days.map(d => SHORT_DAY[d]).join(", ");
      if (n === 1) return days.length ? `Every ${list}` : "Every week";
      return `Every ${n} weeks${days.length ? ` on ${list}` : ""}`;
    }
    case "monthly":
      if (rule.nthWeekday) {
        const ord =
          rule.nthWeekday.n === -1
            ? "last"
            : ["", "1st", "2nd", "3rd", "4th", "5th"][rule.nthWeekday.n];
        return `Every ${ord} ${SHORT_DAY[rule.nthWeekday.weekday]}`;
      }
      if (rule.monthDay === -1) return "Last day of each month";
      if (rule.monthDay) return `Monthly on the ${rule.monthDay}`;
      return n === 1 ? "Every month" : `Every ${n} months`;
    case "yearly":
      return n === 1 ? "Every year" : `Every ${n} years`;
  }
}
