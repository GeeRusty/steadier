import React from "react";
import type { View } from "../../domain/types";

export const PAGE_PURPOSE_CORE_VIEWS = [
  "attention",
  "all",
  "calendar",
  "weekly",
] as const satisfies readonly View[];

export const SPECIALIST_PAGE_PURPOSES: Partial<Record<View, string>> = {
  sort: "One minute a day: set up faded tasks one card at a time. Light Action, Place and First step; skip anything you're unsure about.",
  ideas: "Ideas you might act on one day. No timers or warnings. Make one a task, keep it, or let it go (archived, never deleted).",
  "command-centre": "A rules-based check-in for current Imperatives and decisions; open the real Steadier item to act.",
  review: "Quick maintenance for work due for review or still unplaced. Weekly Reality Review is the separate full decision process.",
  waiting: "Track work waiting on a person or dependency, and decide when to return to it.",
  areas: "Group and find tasks by life area; the hierarchy is not a sequence you must complete.",
  progress: "Look back at completed work and recent movement; this is history, not the active backlog.",
  settings: "Manage full backups, restore and trial settings; CSV alone is not a complete workspace backup.",
  projects: "Connect projects to their intended Goal Outcome; use Map/List for purpose, not scheduling.",
  matrix: "Check balance across Direction/Support and Timely/Sustained patterns.",
  cloud: "Check shared-server sync, conflicts and Compass access; use for setup or troubleshooting.",
  sheet: "View or download a last-confirmed server snapshot; it is not a live editor or full backup.",
  time: "Compare weekly time available with planned work to see whether the plan fits.",
  imperatives: "Review the few focus areas active now and decide whether they still deserve attention.",
  "compass-view": "Scan active Imperatives and Projects with live status marks; use the key to interpret them.",
  map: "Trace Pillars, goals, outcomes and Projects to find missing purpose links.",
  "compass-directory": "Browse and maintain the Pillar–Goal hierarchy behind the Compass map.",
  near: "Find place-linked tasks; arrival alerts depend on location permission and Steadier being open.",
  obligations: "Track bill, licence, renewal, insurance and tax dates with preparation lead time; not accounting.",
  journal: "Keep notes to self by day; they sync with Steadier and are included in backups.",
  decisions: "Revisit read-only decisions saved during Weekly Reality Reviews.",
  evidence: "Add dated evidence to a task or project; evidence alone never marks it Done.",
  sites: "Keep reference cards and links for useful places; links open only when you choose.",
  shopping: "Group shopping items into lists; use tasks for work that needs follow-up.",
  assets: "Track assets and dated wear or maintenance logs when care happens.",
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
}

export default function PagePurposeNote({ view }: Props) {
  const purpose = SPECIALIST_PAGE_PURPOSES[view];
  if (!purpose) return null;

  return (
    <aside className="page-purpose-note" role="note" aria-label="What this page is for">
      <strong>What this page is for:</strong> <span>{purpose}</span>
    </aside>
  );
}
