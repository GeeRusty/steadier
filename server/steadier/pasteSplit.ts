/**
 * "Paste anything": split pasted text into draft items for the owner to check.
 *
 * 1. The never-store filter removes account, card, BSB and reference numbers,
 *    logins and passwords (addresses are kept: for a task they're the point).
 * 2. Only that cleaned text goes to Claude, which returns draft items.
 * 3. The drafts are filtered again and returned. The server saves nothing;
 *    the owner ticks, edits and saves in the app.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Express, Request, Response } from "express";
import * as z from "zod/v4";
import { adelaideClock, isDate } from "../../client/src/domain/time";
import { safeAmount, safeShortText, scrubSensitive } from "../../shared/safeFields";
import { sdk } from "../_core/sdk";
import { VOICE_MODEL } from "./voiceModel";

export const MAX_PASTE_CHARS = 8000;
export const MAX_PASTE_ITEMS = 30;
const KEEP = { keepAddresses: true } as const;

export const PasteItem = z.object({
  kind: z
    .enum(["task", "idea", "bill", "cancel-by", "note", "shopping"])
    .describe("task: something to do. idea: maybe one day. bill: a payment due. cancel-by: a trial or subscription to decide on by a date. note: information to keep. shopping: things to buy."),
  text: z
    .string()
    .describe("task: a short action in the owner's words, with any date or time words kept as plain English, e.g. 'Quote the Patel fence by Friday' or 'Call Andy tomorrow 3pm'. idea: the idea. bill/cancel-by: provider and what it's for, e.g. 'Netflix trial'. note: the note. shopping: leave empty."),
  date: z.string().nullable().describe("bill or cancel-by only: the due or cancel-by date YYYY-MM-DD. null otherwise."),
  amount: z.string().nullable().describe("bill only: the amount, digits with optional cents. null otherwise."),
  shopping_items: z.array(z.string()).describe("shopping only: each item, e.g. ['milk', 'bread', '2x downpipe']. Empty otherwise."),
});
export const PasteSplit = z.object({ items: z.array(PasteItem) });
export type PasteSplit = z.infer<typeof PasteSplit>;

const SYSTEM_PROMPT = `You split text a person pasted (an email, a message, a messy list) into separate items for their personal to-do app in Adelaide, Australia.

- One item per distinct thing. Don't invent items that aren't there; skip greetings and sign-offs.
- Keep the person's own words where you can. Keep date and time words in task text as plain English ("by Friday", "next Tue 3pm"); don't convert them.
- "idea:" or "maybe one day" means an idea. A payment due is a bill. A free trial or subscription with an end date is cancel-by.
- Put all shopping things in one shopping item.
- Never include account numbers, card numbers, BSB, reference numbers, logins or passwords. Some were already removed.
- At most ${MAX_PASTE_ITEMS} items.`;

export interface PasteDraft {
  kind: z.infer<typeof PasteItem>["kind"];
  text: string;
  date: string | null;
  amount: string | null;
  shoppingItems: string[];
}

export type PasteSplitter = (cleanText: string, today: string) => Promise<PasteSplit | null>;

let client: Anthropic | null = null;
export const claudePasteSplitter: PasteSplitter = async (cleanText, today) => {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: VOICE_MODEL,
    max_tokens: 6000,
    output_config: { effort: "low", format: betaZodOutputFormat(PasteSplit) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Today is ${today}.\n\nPasted text:\n"""\n${cleanText}\n"""` }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  return response.parsed_output ?? null;
};

/** Filter Claude's drafts again and drop anything empty or malformed. */
export function safeDrafts(split: PasteSplit, removedBefore: number): { items: PasteDraft[]; removed: number } {
  let removed = removedBefore;
  const items: PasteDraft[] = [];
  for (const raw of split.items.slice(0, MAX_PASTE_ITEMS)) {
    const text = safeShortText(raw.text, 300, KEEP);
    removed += text.removed;
    const shoppingItems =
      raw.kind === "shopping"
        ? raw.shopping_items
            .map(item => {
              const clean = safeShortText(item, 120, KEEP);
              removed += clean.removed;
              return clean.text;
            })
            .filter(Boolean)
            .slice(0, 50)
        : [];
    if (raw.kind === "shopping" ? !shoppingItems.length : !text.text) continue;
    const isMoney = raw.kind === "bill" || raw.kind === "cancel-by";
    const amount = raw.kind === "bill" ? safeAmount(raw.amount) : null;
    if (raw.kind === "bill" && raw.amount && !amount) removed += 1;
    items.push({
      kind: raw.kind,
      text: raw.kind === "shopping" ? shoppingItems.join(", ") : text.text,
      date: isMoney && raw.date && isDate(raw.date) ? raw.date : null,
      amount,
      shoppingItems,
    });
  }
  return { items, removed };
}

const buckets = new Map<number, { count: number; resetAt: number }>();
function overLimit(userId: number, limit = 40, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

async function signedInUserId(req: Request): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    return user.isCron || !Number.isSafeInteger(user.id) || user.id <= 0 ? null : user.id;
  } catch {
    return null;
  }
}

export function registerPasteSplitRoutes(
  app: Express,
  deps: { split?: PasteSplitter; userId?: (req: Request) => Promise<number | null>; now?: () => Date } = {}
) {
  const split = deps.split ?? claudePasteSplitter;
  const userIdFor = deps.userId ?? signedInUserId;
  const now = deps.now ?? (() => new Date());
  const send = (res: Response, status: number, body: unknown) => res.status(status).set("Cache-Control", "no-store").json(body);

  app.post("/api/capture/split", async (req, res) => {
    const userId = await userIdFor(req);
    if (!userId) return send(res, 401, { error: "Please sign in to Steadier first." });
    if (!deps.split && !process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: "Splitting isn't set up yet." });
    if (overLimit(userId)) return send(res, 429, { error: "That's a lot of splits. Try again in a little while." });
    const raw = typeof req.body?.text === "string" ? req.body.text : "";
    if (!raw.trim()) return send(res, 400, { error: "There's nothing to split." });
    if (raw.length > MAX_PASTE_CHARS) return send(res, 400, { error: "That's too long to split. Paste about two pages or less." });
    const cleaned = scrubSensitive(raw, KEEP);
    let result: PasteSplit | null;
    try {
      result = await split(cleaned.text, adelaideClock(now()).date);
    } catch {
      return send(res, 502, { error: "It couldn't be split right now. Save it as one task, or try again." });
    }
    if (!result) return send(res, 422, { error: "Nothing could be split out. Save it as one task instead." });
    const safe = safeDrafts(result, cleaned.removed);
    if (!safe.items.length) return send(res, 422, { error: "Nothing could be split out. Save it as one task instead." });
    return send(res, 200, safe);
  });
}
