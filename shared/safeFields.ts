/**
 * The "never store" filter for bill scans and Claude-added obligations.
 *
 * It removes account, card, BSB and reference numbers, sign-in details and
 * street addresses from text. Amounts and dates are kept. Whatever is removed
 * is discarded, never returned.
 */

const LABELS = [
  "account",
  "acct",
  "a/c",
  "customer",
  "client",
  "member",
  "membership",
  "reference",
  "ref",
  "invoice",
  "inv",
  "biller code",
  "biller",
  "crn",
  "bsb",
  "card",
  "policy",
  "nmi",
  "mirn",
  "meter",
  "service",
  "licence",
  "license",
  "abn",
  "acn",
  "tfn",
  "medicare",
  "user ?name",
  "username",
  "user id",
  "login",
  "log-in",
  "password",
  "passcode",
  "pass code",
  "pin",
  "security code",
  "cvv",
  "cvc",
];
const LABEL_WORDS = "(?:no\\.?|num(?:ber)?|#|id|code|ending(?:\\s+in)?)";
// "Account number: 1234 5678", "Ref # AB-77", "Card ending 4242"
const LABELLED = new RegExp(
  `\\b(?:${LABELS.join("|")})\\b\\.?\\s*(?:${LABEL_WORDS}\\s*)?[:#=\\-–]?\\s*(?=[^\\s,;]*\\d)[A-Z0-9][A-Z0-9\\-/]*(?:\\s+\\d[\\d -]*\\d)?`,
  "gi"
);
// "Password: hunter2", "Username = gee" — the value goes whatever it is.
const SECRET =
  /\b(?:password|passcode|pass code|pin|login|log-in|username|user ?name|user id|security code)\b\s*[:=]\s*\S+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_WITH_SECRETS = /\bhttps?:\/\/\S*(?:@|[?&](?:token|key|code|session|user|pass|login)\S*)\S*/gi;
// Card numbers, account numbers, phone numbers: 6 or more digits, with spaces or dashes.
const LONG_DIGITS = /(?<![\d$.,])\d(?:[ -]?\d){5,}(?![\d.,]\d)/g;
// BSB like 062-000 or 062 000.
const BSB = /(?<![\d$.,])\d{3}[- ]\d{3}(?![\d.,])/g;
const STREET_TYPES =
  "street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|lane|ln|crescent|cres|terrace|tce|parade|pde|way|boulevard|blvd|highway|hwy|close|cl|circuit|cct|grove|gr|square|sq|esplanade|esp";
const STREET = new RegExp(
  `\\b(?:(?:unit|u|flat|apt)\\s*\\d+[A-Z]?\\s*[,/]?\\s*)?\\d{1,5}[A-Z]?(?:\\s*/\\s*\\d{1,5}[A-Z]?)?\\s+(?:[A-Z][A-Za-z'-]*\\s+){1,3}(?:${STREET_TYPES})\\b\\.?[^\\n]*`,
  "gi"
);
const PO_BOX = /\b(?:PO|P\.O\.|GPO|Locked)\s*(?:Box|Bag)\s*\d+[^\n]*/gi;
const SUBURB_LINE = /\b[A-Z][A-Za-z' -]{1,40}\s+(?:SA|NSW|VIC|QLD|WA|TAS|NT|ACT)\s+\d{4}\b/g;

const DATE_LIKE = /(?<!\d)(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})(?!\d)/g;

// Placeholder keys use letters, so the number patterns can't touch them.
const letters = (n: number) => String(n).replace(/\d/g, d => "abcdefghij"[Number(d)]);
const fromLetters = (key: string) => Number([...key].map(ch => ch.charCodeAt(0) - 97).join(""));

const PATTERNS = [SECRET, LABELLED, EMAIL, URL_WITH_SECRETS, STREET, PO_BOX, SUBURB_LINE, LONG_DIGITS, BSB];

export interface ScrubResult {
  text: string;
  removed: number;
}

/** Remove anything that looks like account details, sign-ins or an address. */
export function scrubSensitive(input: string): ScrubResult {
  // Dates look like long numbers; set them aside so they survive.
  const kept: string[] = [];
  let text = input.replace(DATE_LIKE, match => {
    kept.push(match);
    return `\u0001${letters(kept.length - 1)}\u0001`;
  });
  let removed = 0;
  for (const pattern of PATTERNS) {
    text = text.replace(pattern, () => {
      removed += 1;
      return " ";
    });
  }
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\u0001([a-j]+)\u0001/g, (_m, key: string) => kept[fromLetters(key)] ?? "");
  return { text, removed };
}

/** A short field (provider, what it's for): scrubbed and tidied. */
export function safeShortText(value: unknown, max = 120): ScrubResult {
  if (typeof value !== "string") return { text: "", removed: 0 };
  const scrubbed = scrubSensitive(value.replace(/\s+/g, " "));
  const text = scrubbed.text
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .slice(0, max)
    .trim();
  return { text, removed: scrubbed.removed };
}

/** Only a plain money amount survives, written as "$123.45". */
export function safeAmount(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).replace(/\s|AUD|aud/g, "").replace(/^\$/, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
