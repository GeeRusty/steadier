/**
 * "Scan a bill": read a photo of a bill and suggest obligation fields.
 *
 * Privacy (option C, chosen by the owner):
 * 1. The photo is read on this server by Tesseract, in memory. It is never
 *    written to disk, logged, saved or sent anywhere.
 * 2. The never-store filter removes account, card, BSB and reference numbers,
 *    sign-ins and addresses from the text.
 * 3. Only that cleaned text goes to Claude, which picks out the fields.
 * 4. The fields are filtered again and returned for the owner to check. The
 *    server saves nothing; the owner saves from the app.
 */
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Express, Request, Response } from "express";
import * as z from "zod/v4";
import { adelaideClock, isDate } from "../../client/src/domain/time";
import type { ObligationCadence, ObligationKind } from "../../client/src/domain/types";
import { safeAmount, safeShortText, scrubSensitive } from "../../shared/safeFields";
import { sdk } from "../_core/sdk";
import { VOICE_MODEL } from "./voiceModel";

/** Base64 of the shrunk photo; the app sends about 0.5–1.5 MB. */
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;
const MAX_TEXT = 8000;
const OCR_TIMEOUT_MS = 45_000;

export const BillFields = z.object({
  provider: z.string().nullable().describe("Company or person the bill is from, e.g. 'AGL'. null if unclear."),
  for_what: z.string().nullable().describe("What it's for in 1–4 words, e.g. 'Electricity', 'Car insurance', 'Streaming'. null if unclear."),
  amount: z.string().nullable().describe("Total amount due as digits with optional cents, e.g. '123.45'. null if none."),
  due_date: z.string().nullable().describe("Payment due date YYYY-MM-DD. null if none."),
  how_often: z
    .enum(["none", "weekly", "fortnightly", "monthly", "quarterly", "yearly", "unknown"])
    .describe("How often this bill comes, from the billing period or wording. 'none' for one-off, 'unknown' if not shown."),
  renewal_date: z.string().nullable().describe("Renewal or contract/subscription end date YYYY-MM-DD, if shown. null otherwise."),
  cancel_by_date: z.string().nullable().describe("Last day to cancel (e.g. free trial ends) YYYY-MM-DD, if shown. null otherwise."),
  kind: z
    .enum(["bill", "renewal", "insurance", "licence", "tax", "cancel-by"])
    .describe("Best type: 'cancel-by' for a trial or subscription with a cancel-by date; 'renewal' if it's mainly a renewal notice."),
});
export type BillFields = z.infer<typeof BillFields>;

const SYSTEM_PROMPT = `You read text taken from a photo of a bill, invoice, renewal notice or subscription email, and pick out a few fields for a personal reminder app in Adelaide, Australia.

Return only these fields: provider, for_what, amount, due_date, how_often, renewal_date, cancel_by_date, kind.
- Dates are YYYY-MM-DD. Australian dates are day/month/year. Use the year shown; if no year is shown, use the next such date on or after today.
- Never include account numbers, card numbers, BSB, reference or customer numbers, names of people, addresses, phone numbers or sign-in details in any field. Some have already been removed from the text.
- If something isn't clearly shown, use null (or "unknown" for how_often). Don't guess amounts or dates.`;

export interface ScanResult {
  provider: string;
  forWhat: string;
  amount: string | null;
  dueDate: string | null;
  cadence: ObligationCadence;
  renewalDate: string | null;
  cancelByDate: string | null;
  kind: ObligationKind;
  /** How many things the never-store filter threw away. */
  removed: number;
  notes: string[];
}

export type OcrReader = (image: Buffer) => Promise<string>;
export type FieldExtractor = (cleanText: string, today: string) => Promise<BillFields | null>;

/** Tesseract reads the image from stdin and writes text to stdout: no files. */
export const tesseractOcr: OcrReader = image =>
  new Promise((resolve, reject) => {
    const child = spawn("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", "3"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), OCR_TIMEOUT_MS);
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error("The photo couldn't be read."));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(image);
  });

let client: Anthropic | null = null;

export const claudeExtractor: FieldExtractor = async (cleanText, today) => {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: VOICE_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(BillFields) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Today is ${today}.\n\nText from the photo:\n"""\n${cleanText}\n"""` }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  return response.parsed_output ?? null;
};

const dateOrNull = (value: string | null) => (value && isDate(value) ? value : null);

/** Filter Claude's answer again and shape it for the confirm screen. */
export function safeScanResult(fields: BillFields, removedBefore: number): ScanResult {
  const provider = safeShortText(fields.provider ?? "", 80);
  const forWhat = safeShortText(fields.for_what ?? "", 80);
  const amount = safeAmount(fields.amount);
  const notes: string[] = [];
  let removed = removedBefore + provider.removed + forWhat.removed;
  if (fields.amount && !amount) removed += 1;
  let cadence: ObligationCadence;
  switch (fields.how_often) {
    case "weekly":
    case "monthly":
    case "quarterly":
    case "yearly":
    case "none":
      cadence = fields.how_often;
      break;
    case "fortnightly":
      cadence = "none";
      notes.push("It looks fortnightly. Steadier has no fortnightly option, so it's set to Does not repeat.");
      break;
    default:
      cadence = "none";
      notes.push("How often wasn't clear. Check the Cadence.");
  }
  const result: ScanResult = {
    provider: provider.text,
    forWhat: forWhat.text,
    amount,
    dueDate: dateOrNull(fields.due_date),
    cadence,
    renewalDate: dateOrNull(fields.renewal_date),
    cancelByDate: dateOrNull(fields.cancel_by_date),
    kind: fields.kind,
    removed,
    notes,
  };
  if (!result.dueDate && !result.renewalDate && !result.cancelByDate) {
    notes.push("No date was found. Enter the due date yourself.");
  }
  return result;
}

const buckets = new Map<number, { count: number; resetAt: number }>();
function overLimit(userId: number, limit = 30, windowMs = 60 * 60_000): boolean {
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

function imageFromBody(body: unknown): Buffer | null {
  const raw = (body as { image?: unknown } | undefined)?.image;
  if (typeof raw !== "string" || !raw || raw.length > MAX_IMAGE_BASE64) return null;
  const base64 = raw.replace(/^data:image\/(?:jpeg|png|webp);base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const image = Buffer.from(base64, "base64");
  const jpeg = image[0] === 0xff && image[1] === 0xd8;
  const png = image[0] === 0x89 && image[1] === 0x50;
  return jpeg || png ? image : null;
}

export function registerBillScanRoutes(
  app: Express,
  deps: {
    ocr?: OcrReader;
    extract?: FieldExtractor;
    userId?: (req: Request) => Promise<number | null>;
    now?: () => Date;
  } = {}
) {
  const ocr = deps.ocr ?? tesseractOcr;
  const extract = deps.extract ?? claudeExtractor;
  const userIdFor = deps.userId ?? signedInUserId;
  const now = deps.now ?? (() => new Date());
  const send = (res: Response, status: number, body: unknown) =>
    res.status(status).set("Cache-Control", "no-store").json(body);

  app.post("/api/obligations/scan", async (req, res) => {
    const userId = await userIdFor(req);
    if (!userId) return send(res, 401, { error: "Please sign in to Steadier first." });
    if (!deps.extract && !process.env.ANTHROPIC_API_KEY)
      return send(res, 503, { error: "Bill scanning isn't set up yet." });
    if (overLimit(userId)) return send(res, 429, { error: "That's a lot of scans. Try again in a little while." });

    let image = imageFromBody(req.body);
    // Drop the request's copy of the photo straight away.
    if (req.body && typeof req.body === "object") delete (req.body as { image?: unknown }).image;
    if (!image) return send(res, 400, { error: "That photo couldn't be used. Try a JPEG or PNG photo." });

    let text: string;
    try {
      text = await ocr(image);
    } catch {
      return send(res, 422, { error: "The photo couldn't be read. Try a flatter, brighter photo." });
    } finally {
      image.fill(0);
      image = null;
    }

    const cleaned = scrubSensitive(text.slice(0, MAX_TEXT * 2));
    text = "";
    if (cleaned.text.replace(/\s/g, "").length < 12) {
      return send(res, 422, { error: "No text was found in the photo. Try a flatter, brighter photo." });
    }

    let fields: BillFields | null;
    try {
      fields = await extract(cleaned.text.slice(0, MAX_TEXT), adelaideClock(now()).date);
    } catch {
      return send(res, 502, { error: "The bill couldn't be read right now. Try again, or add it by hand." });
    }
    if (!fields) return send(res, 422, { error: "Nothing usable was found. Add it by hand instead." });
    return send(res, 200, safeScanResult(fields, cleaned.removed));
  });
}
