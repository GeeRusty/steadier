// List changes shared by the Claude connector and the voice assistant. They
// reuse the app's own list rules, so limits and formats match the app.
// Claude never adds a confirmed item: what it adds is a suggestion (dashed in
// Steadier) until the owner confirms it there.
import {
  addItem,
  addItemsToRun,
  DEFAULT_LIST_TITLE,
  finishedRuns,
  findTemplate,
  LIST_ITEM_LIMIT,
  LIST_KIND_LABEL,
  listForRequest,
  listsOf,
  newListItemId,
  newListRunId,
  openRun,
  runProgress,
  runRows,
  startRun,
  tickItem,
} from "../../client/src/domain/lists";
import type { ListRun, Workspace } from "../../client/src/domain/types";
import { adelaideTimestamp } from "../../shared/time";
import { ChangeError, type ChangePlan } from "./changes";

export { DEFAULT_LIST_TITLE, listForRequest };

function presentRun(workspace: Workspace, run: ListRun) {
  const { done, total } = runProgress(workspace, run);
  return {
    runId: run.id,
    date: run.date,
    finishedAt: run.finishedAt,
    done,
    total,
    parent: run.parent,
    items: runRows(workspace, run).map(r => ({
      itemId: r.id,
      text: r.text,
      section: r.section,
      ticked: r.ticked,
      addedThisRun: r.extra,
      suggested: r.suggested,
    })),
  };
}

/** Templates with their items, the run in progress, and when each was last finished. */
export function presentLists(workspace: Workspace, templateId?: string, includeHistory = false) {
  return listsOf(workspace)
    .templates.filter(t => !templateId || t.id === templateId)
    .map(t => {
      const sections = new Map(t.sections.map(s => [s.id, s.title]));
      const history = finishedRuns(workspace, t.id);
      const run = openRun(workspace, t.id);
      return {
        templateId: t.id,
        title: t.title,
        type: LIST_KIND_LABEL[t.kind],
        useWhen: t.useWhen,
        items: t.items.map(i => ({
          itemId: i.id,
          text: i.text,
          section: i.sectionId ? sections.get(i.sectionId) ?? "" : "",
          suggested: i.suggested,
        })),
        runInProgress: run ? presentRun(workspace, run) : null,
        lastFinished: history[0]?.date ?? null,
        ...(includeHistory
          ? {
              finishedRuns: history.map(r => {
                const { done, total } = runProgress(workspace, r);
                return { runId: r.id, date: r.date, finishedAt: r.finishedAt, done, total };
              }),
            }
          : {}),
      };
    });
}

export function planStartRun(
  workspace: Workspace,
  templateId: string,
  parent: ListRun["parent"],
  now: Date = new Date()
): ChangePlan<{ runId: string }> {
  const template = findTemplate(workspace, templateId);
  if (!template) throw new ChangeError("NOT_FOUND", "No list with that id.");
  if (openRun(workspace, templateId)) throw new ChangeError("INVALID_CHANGE", `${template.title} already has a run in progress.`);
  if (parent?.kind === "task" && !workspace.tasks.some(t => t.id === parent.id)) throw new ChangeError("NOT_FOUND", "No task with that id.");
  if (parent?.kind === "project" && !workspace.projects.some(p => p.id === parent.id)) throw new ChangeError("NOT_FOUND", "No project with that id.");
  const runId = newListRunId();
  const next = startRun(workspace, runId, templateId, adelaideTimestamp(now), parent);
  if (next === workspace) throw new ChangeError("INVALID_CHANGE", "The run couldn't be started.");
  return { workspace: next, summary: `Started a run of the ${template.title} list`, result: { runId } };
}

export function planTickItems(
  workspace: Workspace,
  runId: string,
  itemIds: string[],
  ticked: boolean,
  now: Date = new Date()
): ChangePlan<{ changed: number }> {
  const at = adelaideTimestamp(now);
  const run = listsOf(workspace).runs.find(r => r.id === runId);
  if (!run) throw new ChangeError("NOT_FOUND", "No list run with that id.");
  if (run.finishedAt) throw new ChangeError("INVALID_CHANGE", "That run is finished; start a new one to tick items.");
  let next = workspace;
  let changed = 0;
  for (const itemId of itemIds) {
    const before = next;
    next = tickItem(next, runId, itemId, ticked, at);
    if (next !== before) changed += 1;
  }
  if (!changed) throw new ChangeError("INVALID_CHANGE", "Nothing to change: those items were not found, are suggestions the owner hasn't confirmed, or are already set.");
  const title = findTemplate(workspace, run.templateId)?.title ?? "list";
  return {
    workspace: next,
    summary: `${ticked ? "Ticked" : "Unticked"} ${changed} item${changed === 1 ? "" : "s"} on the ${title} run`,
    result: { changed },
  };
}

/** Claude's additions: suggestions the owner confirms in Steadier. Never creates a list. */
export function planSuggestItems(
  workspace: Workspace,
  target: { templateId?: string | null; listTitle?: string | null },
  items: string[],
  to: "run" | "template",
  now: Date = new Date()
): ChangePlan<{ templateId: string; suggested: string[]; to: "run" | "template" }> {
  const at = adelaideTimestamp(now);
  const texts = items.map(t => t.replace(/\s+/g, " ").trim()).filter(t => t && t.length <= LIST_ITEM_LIMIT);
  if (!texts.length) throw new ChangeError("INVALID_CHANGE", "There were no items to add.");
  const template = target.templateId
    ? findTemplate(workspace, target.templateId)
    : listForRequest(workspace, target.listTitle ?? null);
  if (!template)
    throw new ChangeError("NOT_FOUND", "No list with that name. Only the owner creates lists in Steadier; ask them to make it first.");
  let next = workspace;
  const suggested: string[] = [];
  if (to === "template") {
    for (const text of texts) {
      const before = next;
      next = addItem(next, template.id, newListItemId(), text, null, at, true);
      if (next !== before) suggested.push(text);
    }
  } else {
    const result = addItemsToRun(next, null, texts, at, { suggested: true, createList: false, templateId: template.id });
    next = result.workspace;
    suggested.push(...result.added);
  }
  if (!suggested.length) throw new ChangeError("INVALID_CHANGE", `The ${template.title} list is full, so nothing was added.`);
  return {
    workspace: next,
    summary: `Suggested ${suggested.length} item${suggested.length === 1 ? "" : "s"} for the ${template.title} ${to === "template" ? "list" : "run"}`,
    result: { templateId: template.id, suggested, to },
  };
}

/** Voice: the owner has already said yes, so items are confirmed. Creates the list if it doesn't exist. */
export function planAddItemsToRun(
  workspace: Workspace,
  listTitle: string | null,
  items: string[],
  now: Date = new Date()
): ChangePlan<{ templateId: string; listTitle: string; added: string[] }> {
  const texts = items.map(t => t.trim()).filter(t => t && t.length <= LIST_ITEM_LIMIT);
  if (!texts.length) throw new ChangeError("INVALID_CHANGE", "There were no items to add.");
  const result = addItemsToRun(workspace, listTitle, texts, adelaideTimestamp(now));
  if (!result.template) throw new ChangeError("INVALID_CHANGE", "A new list couldn't be created.");
  if (!result.added.length) throw new ChangeError("INVALID_CHANGE", `The ${result.template.title} list is full, so nothing was added.`);
  return {
    workspace: result.workspace,
    summary: `Added ${result.added.length} item${result.added.length === 1 ? "" : "s"} to the ${result.template.title} list`,
    result: { templateId: result.template.id, listTitle: result.template.title, added: result.added },
  };
}
