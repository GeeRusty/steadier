/**
 * Voice assistant: turn one spoken sentence into a Steadier action.
 *
 * Flow: the browser transcribes speech on the phone, POSTs the text to
 * /api/voice/interpret, and Claude returns a structured intent. Reads (what's
 * next, today) are answered at once. Writes come back as a proposal with a
 * spoken confirmation; nothing is saved until the browser POSTs that proposal
 * to /api/voice/confirm. The server re-validates the proposal there, so the
 * browser can't save anything a normal task edit couldn't.
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Express, Request, Response } from "express";
import * as z from "zod/v4";
import { buildCalendar, dateRange } from "../../client/src/domain/calendarModel";
import { adelaideClock, shiftDays } from "../../client/src/domain/time";
import type { Workspace } from "../../client/src/domain/types";
import { sdk } from "../_core/sdk";
import { applyGuardedChange, ChangeError, type WorkspaceChangeRepository } from "./changes";
import { planCreateTask } from "./connectorOps";
import { createProductionRepository } from "./repository";

export const VOICE_MODEL = "claude-opus-5-5";

// ---------------------------------------------------------------------------
// What Claude returns

export const VoiceIntent = z.object({
  intent: z
    .enum(["add_task", "whats_next", "today", "unclear"])
    .describe("add_task: create a task or calendar booking. whats_next: next booked item today. today: list today's bookings. unclear: anything else."),
  title: z.string().nullable().describe("Short task title in the user's words, e.g. 'Call the mechanic'. null unless add_task."),
  date: z.string().nullable().describe("YYYY-MM-DD in Adelaide, resolved from words like 'tomorrow' or 'Friday'. null if no day was said."),
  time: z.string().nullable().describe("Start time HH:MM 24-hour, e.g. '16:00'. null if no time was said."),
  minutes: z.number().int().nullable().describe("Length in minutes from 'for an hour' or '4 till 8'. null if not said."),
  remind_minutes_before: z
    .number()
    .int()
    .nullable()
    .describe("Only if the user asked for a reminder: minutes before the start (0 = at the time). null otherwise."),
  clarify: z.string().nullable().describe("For unclear only: one short spoken sentence asking what they meant."),
});
export type VoiceIntent = z.infer<typeof VoiceIntent>;

/** A task ready to save, exactly as it will be written. */
export const TaskProposal = z
  .object({
    kind: z.literal("add_task"),
    title: z.string().trim().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    minutes: z.number().int().min(5).max(1440).nullable(),
    remindMinutesBefore: z.number().int().min(0).max(10080).nullable(),
  })
  .strict();
export type TaskProposal = z.infer<typeof TaskProposal>;

export type VoiceReply =
  | { kind: "confirm"; speech: string; proposal: TaskProposal }
  | { kind: "answer"; speech: string }
  | { kind: "unclear"; speech: string };

// ---------------------------------------------------------------------------
// Prompt

const SYSTEM_PROMPT = `You turn one spoken sentence from a Steadier user into a structured intent. Steadier is a personal planner: tasks, calendar bookings (shifts, jobs, appointments) and reminders.

The text comes from phone speech recognition, so expect missing punctuation and misheard words; read it for the most likely meaning.

Rules:
- add_task when they want something added, booked, scheduled or remembered. Keep the title short and in their words. Drop filler like "remind me to" or "put in".
- Resolve dates and times relative to the current Adelaide date and time given in the message. "Tonight" means today. A bare weekday means the next one after today. "4 till 8" means time 16:00 and 240 minutes, unless morning is clearly meant.
- Set remind_minutes_before only when they ask for a reminder. "Remind me to X at 10" means a task at 10:00 with remind_minutes_before 0.
- Never invent a date, time or length that wasn't said.
- whats_next for questions like "what's next" or "what am I doing now". today for "what's on today" or "what have I got today".
- If a current draft is given, the sentence may be a correction ("make it 5", "change it to Saturday"). Return the whole updated draft as add_task.
- unclear for anything else, with a short spoken question in clarify.`;

export function interpretMessage(text: string, now: Date, draft: TaskProposal | null): string {
  const clock = adelaideClock(now);
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Adelaide", weekday: "long" }).format(now);
  const hh = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
  const mm = String(clock.minutes % 60).padStart(2, "0");
  const lines = [`Now in Adelaide: ${weekday} ${clock.date}, ${hh}:${mm}.`];
  if (draft) lines.push(`Current draft: ${JSON.stringify(draft)}`);
  lines.push(`They said: ${JSON.stringify(text)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pure helpers (tested)

/** Validate Claude's intent into something safe to save. Returns null if it isn't a usable task. */
export function proposalFromIntent(intent: VoiceIntent): TaskProposal | null {
  const parsed = TaskProposal.safeParse({
    kind: "add_task",
    title: intent.title ?? "",
    date: intent.date,
    time: intent.time,
    minutes: intent.minutes,
    remindMinutesBefore: intent.remind_minutes_before,
  });
  if (!parsed.success) return null;
  const p = parsed.data;
  // A time needs a day; assume today rather than dropping the time.
  return p.time && !p.date ? { ...p, date: adelaideClock().date } : p;
}

export function spokenTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12} ${String(m).padStart(2, "0")} ${suffix}`;
}

export function spokenDate(date: string, today: string): string {
  if (date === today) return "today";
  if (date === shiftDays(today, 1)) return "tomorrow";
  const [y, mo, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, mo - 1, d)));
}

export function spokenLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** What the assistant reads back before saving. Built from the validated proposal, not from Claude's wording. */
export function confirmationSpeech(p: TaskProposal, today: string): string {
  const parts = [`Add ${p.title}`];
  if (p.date) parts.push(spokenDate(p.date, today));
  if (p.time) parts.push(`at ${spokenTime(p.time)}`);
  if (p.minutes) parts.push(`for ${spokenLength(p.minutes)}`);
  let sentence = parts.join(", ");
  if (p.remindMinutesBefore !== null) {
    sentence +=
      p.remindMinutesBefore === 0
        ? ", with a reminder at the time"
        : `, with a reminder ${spokenLength(p.remindMinutesBefore)} before`;
  }
  return `${sentence}. Save it?`;
}

type TimedItem = { title: string; start: number; minutes?: number; done?: boolean };

function todaysTimed(workspace: Workspace, today: string): TimedItem[] {
  const [day] = buildCalendar(workspace.tasks, workspace.projects, dateRange(today, 1), today, {});
  return (day?.timed ?? [])
    .filter((item): item is typeof item & { start: number } => item.start !== undefined && (item.kind === "slot" || item.kind === "projected"))
    .map(item => ({ title: item.title, start: item.start, minutes: item.minutes, done: item.done }))
    .sort((a, b) => a.start - b.start);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function whatsNextSpeech(workspace: Workspace, now: Date = new Date()): string {
  const clock = adelaideClock(now);
  const items = todaysTimed(workspace, clock.date).filter(i => !i.done);
  const current = items.find(i => i.start <= clock.minutes && clock.minutes < i.start + (i.minutes ?? 0));
  const next = items.find(i => i.start > clock.minutes);
  const out: string[] = [];
  if (current) {
    const left = current.start + (current.minutes ?? 0) - clock.minutes;
    out.push(`You're on ${current.title}, ${spokenLength(left)} to go.`);
  }
  if (next) {
    out.push(`${current ? "After that" : "Next"}, ${next.title} at ${spokenTime(hhmm(next.start))}.`);
  }
  if (!out.length) return "Nothing else is booked for today.";
  return out.join(" ");
}

export function todaySpeech(workspace: Workspace, now: Date = new Date()): string {
  const clock = adelaideClock(now);
  const items = todaysTimed(workspace, clock.date).filter(i => !i.done && i.start + (i.minutes ?? 0) > clock.minutes);
  if (!items.length) return "Nothing else is booked for today.";
  const list = items.slice(0, 8).map(i => `${i.title} at ${spokenTime(hhmm(i.start))}`);
  const more = items.length > 8 ? ` And ${items.length - 8} more.` : "";
  return `Still to come today: ${list.join(". ")}.${more}`;
}

/** Plan the write for a confirmed proposal, through the same guarded path the connector uses. */
export function planVoiceTask(workspace: Workspace, p: TaskProposal, now: Date) {
  const planned = planCreateTask(workspace, { title: p.title }, "Added by voice.", now, "claude");
  const task = planned.result.task;
  if (p.date) {
    task.schedule = {
      ...task.schedule,
      date: p.date,
      time: p.time,
      minutes: p.time ? p.minutes : null,
      // A clock time makes it a booked calendar block, so check-ins and reminders run.
      fixed: p.time !== null,
      reminders:
        p.remindMinutesBefore !== null && p.time
          ? [{ id: randomUUID(), minutesBefore: p.remindMinutesBefore, anchor: "slot" as const }]
          : [],
    };
  }
  return {
    ...planned,
    workspace: { ...planned.workspace, tasks: planned.workspace.tasks.map(t => (t.id === task.id ? task : t)) },
  };
}

// ---------------------------------------------------------------------------
// Claude call

export type Interpreter = (text: string, draft: TaskProposal | null, now: Date) => Promise<VoiceIntent | null>;

let client: Anthropic | null = null;

export const claudeInterpreter: Interpreter = async (text, draft, now) => {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: VOICE_MODEL,
    max_tokens: 2000,
    // Quick replies matter more than deep thought for one sentence.
    output_config: { effort: "low", format: betaZodOutputFormat(VoiceIntent) },
    // If a safety check declines, the API retries on a suitable model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: interpretMessage(text, now, draft) }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  return response.parsed_output ?? null;
};

// ---------------------------------------------------------------------------
// Routes

const buckets = new Map<number, { count: number; resetAt: number }>();
function overLimit(userId: number, limit = 120, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || b.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

async function signedInUserId(req: Request): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    return user.isCron || !Number.isSafeInteger(user.id) || user.id <= 0 ? null : user.id;
  } catch {
    return null;
  }
}

export function registerVoiceRoutes(
  app: Express,
  deps: { changes?: WorkspaceChangeRepository; interpret?: Interpreter; now?: () => Date } = {}
) {
  const changes = deps.changes ?? createProductionRepository();
  const interpret = deps.interpret ?? claudeInterpreter;
  const now = deps.now ?? (() => new Date());
  const send = (res: Response, status: number, body: unknown) =>
    res.status(status).set("Cache-Control", "no-store").json(body);

  app.post("/api/voice/interpret", async (req, res) => {
    const userId = await signedInUserId(req);
    if (!userId) return send(res, 401, { speech: "Please sign in to Steadier first." });
    if (!deps.interpret && !process.env.ANTHROPIC_API_KEY)
      return send(res, 503, { speech: "The voice assistant isn't set up yet." });
    if (overLimit(userId)) return send(res, 429, { speech: "That's a lot of requests. Try again in a little while." });

    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 500) : "";
    if (!text) return send(res, 400, { speech: "I didn't catch that. Try again." });
    const draftParse = TaskProposal.safeParse(req.body?.draft);
    const draft = draftParse.success ? draftParse.data : null;

    let intent: VoiceIntent | null;
    try {
      intent = await interpret(text, draft, now());
    } catch (error) {
      console.error("[Voice] interpret failed", error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
      return send(res, 502, { speech: "I couldn't reach the assistant. Check your connection and try again." });
    }

    let reply: VoiceReply;
    if (!intent) {
      reply = { kind: "unclear", speech: "Sorry, I couldn't work that out. Try saying it another way." };
    } else if (intent.intent === "add_task") {
      const proposal = proposalFromIntent(intent);
      reply = proposal
        ? { kind: "confirm", proposal, speech: confirmationSpeech(proposal, adelaideClock(now()).date) }
        : { kind: "unclear", speech: "What should I call the task?" };
    } else if (intent.intent === "whats_next" || intent.intent === "today") {
      const stored = await changes.readWorkspace(userId);
      if (!stored) {
        reply = { kind: "answer", speech: "Open Steadier and let it sync once, then ask me again." };
      } else {
        const speech = intent.intent === "whats_next" ? whatsNextSpeech(stored.workspace, now()) : todaySpeech(stored.workspace, now());
        reply = { kind: "answer", speech };
      }
    } else {
      reply = { kind: "unclear", speech: intent.clarify?.trim().slice(0, 200) || "Sorry, I didn't follow. Try again." };
    }
    send(res, 200, reply);
  });

  app.post("/api/voice/confirm", async (req, res) => {
    const userId = await signedInUserId(req);
    if (!userId) return send(res, 401, { speech: "Please sign in to Steadier first." });
    const parsed = TaskProposal.safeParse(req.body?.proposal);
    if (!parsed.success) return send(res, 400, { speech: "That didn't look right, so nothing was saved." });
    try {
      await applyGuardedChange(changes, userId, "claude", workspace => planVoiceTask(workspace, parsed.data, now()));
      send(res, 200, { speech: "Saved." });
    } catch (error) {
      const message = error instanceof ChangeError ? error.message : "Something went wrong, so nothing was saved.";
      console.error("[Voice] save failed", error instanceof Error ? error.message : error);
      send(res, error instanceof ChangeError ? 409 : 500, { speech: message.slice(0, 200) });
    }
  });
}
