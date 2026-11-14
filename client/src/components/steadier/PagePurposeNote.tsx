import { FRONT_OF_MIND_INFO } from "../../domain/frontOfMind";
import { ASSETS_INFO } from "../../domain/assets";
import React from "react";
import { Info } from "lucide-react";
import type { View } from "../../domain/types";

export const PAGE_PURPOSE_CORE_VIEWS = [
  "attention",
  "all",
  "calendar",
  "weekly",
] as const satisfies readonly View[];

export const SPECIALIST_PAGE_PURPOSES: Partial<Record<View, string>> = {
  sort: "One minute a day: set up faded tasks one card at a time. Light Action, Place and First step; skip anything you're unsure about.",
  ideas: FRONT_OF_MIND_INFO,
  review: "Quick maintenance for work due for review or still unplaced. Weekly Reality Review is the separate full decision process.",
  waiting: "Track work waiting on a person or dependency, and decide when to return to it.",
  progress: "Look back at completed work and recent movement; this is history, not the active backlog.",
  settings: "Manage full backups, restore and trial settings; CSV alone is not a complete workspace backup.",
  projects: "Connect projects to their intended Goal Outcome; use Map/List for purpose, not scheduling.",
  matrix: "See balance across Imperative/Support and Timely/Sustained, in counts and time. Balance, not ranking.",
  linkcheck: "Imperatives with no work, and Imperative projects with no Imperative. One tap each: link, change, or Not yet until your next review.",
  cloud: "Check shared-server sync, conflicts and Compass access; use for setup or troubleshooting.",
  sheet: "View or download a last-confirmed server snapshot; it is not a live editor or full backup.",
  time: "Compare weekly time available with planned work to see whether the plan fits.",
  imperatives: "Review the few focus areas active now and decide whether they still deserve attention.",
  "compass-view": "Scan active Imperatives and Projects with live status marks; use the key to interpret them.",
  map: "Trace Pillars, goals, outcomes and Projects to find missing purpose links.",
  "compass-directory": "Browse and maintain the Pillar–Goal hierarchy behind the Compass map.",
  near: "Find place-linked tasks; arrival alerts depend on location permission and Steadier being open.",
  obligations: "Track bill, licence, renewal, insurance, tax and cancel-by dates with preparation lead time; scan a bill to fill one in. Not accounting.",
  journal: "Keep notes to self by day; they sync with Steadier and are included in backups.",
  decisions: "Revisit read-only decisions saved during Weekly Reality Reviews.",
  evidence: "Add dated evidence to a task or project; evidence alone never marks it Done.",
  sites: "Keep reference cards and links for useful places; links open only when you choose.",
  shopping: "Reusable lists. Each use is a run with its own ticks and date; the list itself is never ticked. Attach one to a task or project.",
  assets: ASSETS_INFO,
  pipeline: "Review projects and linked tasks together to follow work through stages.",
  routine: "Run an existing repeating task checklist; it does not create a parallel task system.",
  yearWheel: "Orient around seasonal reviews, tasks, projects and obligations—not daily scheduling.",
  moveEnergy: "Manually record movement and energy windows; this stays in this browser, outside sync and backup.",
  weather: "Use a chosen-place forecast as context; the place is browser-only and not backed up.",
  people: "Keep person records and follow-up context so promised contact is not lost in the task pool.",
  credentialRenewals: "Track renewal names, purpose, dates and notes; do not store secret values.",
  invoices: "Create and export invoice records; this is not full bookkeeping or accounting.",
};

interface Props {
  view: View;
  /** Explanations moved off the page body, shown word for word under the purpose. */
  extra?: string[];
}

export default function PagePurposeNote({ view, extra = [] }: Props) {
  const purpose = SPECIALIST_PAGE_PURPOSES[view];
  if (!purpose && !extra.length) return null;

  // Show, don't explain: the explanation sits behind an info icon. Opening it
  // also reveals the page's own intro text (see .page-purpose in index.css).
  return (
    <details className="page-purpose">
      <summary aria-label="What this page is for" title="What this page is for">
        <Info size={18} aria-hidden="true" />
      </summary>
      <aside className="page-purpose-note" role="note" aria-label="What this page is for">
        {purpose && (
          <p>
            <strong>What this page is for:</strong> <span>{purpose}</span>
          </p>
        )}
        {extra.map(line => (
          <p key={line}>{line}</p>
        ))}
      </aside>
    </details>
  );
}
