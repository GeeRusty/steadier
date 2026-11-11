// The Steadier user guide (docs/User-Guide.md): served as a page at /guide,
// given to the voice assistant for "how do I…" questions, and readable by the
// Claude connector.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Express } from "express";
import { VOICE_MODEL } from "./voiceModel";

let cached: string | null = null;

export function guideText(): string {
  if (cached !== null) return cached;
  const candidates = [
    process.env.STEADIER_GUIDE_PATH,
    path.resolve(process.cwd(), "docs/User-Guide.md"),
    "/app/docs/User-Guide.md",
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    try {
      cached = fs.readFileSync(file, "utf8");
      return cached;
    } catch {
      // try the next location
    }
  }
  cached = "";
  return cached;
}

export type GuideSection = { heading: string; level: number; body: string };

export function guideSections(text: string = guideText()): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);
  return sections.map(s => ({ ...s, body: s.body.trim() }));
}

/** Sections whose heading or text mentions the topic (all of it when no topic). */
export function guideFor(topic: string | null | undefined, text: string = guideText()): string {
  const q = topic?.trim().toLowerCase();
  if (!q) return text;
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const hits = guideSections(text).filter(s => {
    const hay = `${s.heading}\n${s.body}`.toLowerCase();
    return hay.includes(q) || (words.length > 0 && words.every(w => hay.includes(w)));
  });
  return hits.length ? hits.map(s => `${"#".repeat(s.level)} ${s.heading}\n\n${s.body}`).join("\n\n") : text;
}

// ---------------------------------------------------------------------------
// Spoken answers

const HELP_SYSTEM = `You answer questions about how to use the Steadier app, out loud. The answer will be read by a phone's text-to-speech voice.

Use only the guide below. If the guide doesn't cover the question, say you're not sure and suggest opening the Guide page or asking in Claude.
Answer in two to four short spoken sentences. Name the exact buttons and menu items from the guide. No markdown, lists or symbols.

<guide>
`;

export type HelpAnswerer = (question: string) => Promise<string | null>;

let client: Anthropic | null = null;

export const claudeHelp: HelpAnswerer = async question => {
  const guide = guideText();
  if (!guide) return null;
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: VOICE_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // The guide is the same every time, so cache it.
    system: [{ type: "text", text: `${HELP_SYSTEM}${guide}\n</guide>`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: question }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map(b => b.text)
    .join(" ")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
};

// ---------------------------------------------------------------------------
// /guide page

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function renderGuideHtml(markdown: string): { body: string; toc: string } {
  const out: string[] = [];
  const toc: string[] = [];
  let list: string[] | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map(i => `<li>${inline(i)}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const item = line.match(/^-\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slug(text);
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      if (level === 2) toc.push(`<li><a href="#${id}">${inline(text)}</a></li>`);
    } else if (item) {
      flushPara();
      (list ??= []).push(item[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return { body: out.join("\n"), toc: toc.join("") };
}

export function registerGuidePage(app: Express) {
  app.get("/guide", (_req, res) => {
    const { body, toc } = renderGuideHtml(guideText() || "# Steadier user guide\n\nThe guide isn't available right now.");
    res
      .set("Cache-Control", "no-cache")
      .type("html")
      .send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#24483E">
<title>Steadier Guide</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8f3; --card:#fff; --text:#1d1f1c; --muted:#5f655d; --accent:#24483e; --line:#d9dcd2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121513; --card:#1b1f1c; --text:#e9ece7; --muted:#a0a79e; --accent:#7cc4ad; --line:#323832; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left)); }
  .wrap { max-width: 720px; margin: 0 auto; }
  header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
  header a { color:var(--accent); font-weight:600; text-decoration:none; }
  h1 { font-size:1.8rem; line-height:1.2; margin:12px 0; text-wrap:balance; }
  h2 { font-size:1.3rem; margin:2em 0 .4em; padding-top:.6em; border-top:1px solid var(--line); }
  h3 { font-size:1.08rem; margin:1.4em 0 .3em; }
  p, li { max-width: 65ch; }
  ul { padding-left: 1.3em; }
  li { margin: .25em 0; }
  strong { font-weight: 650; }
  nav { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin:16px 0; }
  nav ul { margin:.3em 0 0; columns: 2 220px; }
  nav a { color:var(--accent); text-decoration:none; }
  .tip { color:var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header><a href="/">← Open Steadier</a><a href="/voice">Ask by voice</a></header>
  <p class="tip">You can also ask the voice assistant things like "How do I move a task?"</p>
  <nav aria-label="Contents"><strong>Contents</strong><ul>${toc}</ul></nav>
  ${body}
</div>
</body>
</html>`);
  });
}
