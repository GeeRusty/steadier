import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ListLink, Workspace } from "../../domain/types";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  addLink,
  findTemplate,
  linksFor,
  listsOf,
  newListLinkId,
  newListRunId,
  openRun,
  removeLink,
  runProgress,
  startRun,
} from "../../domain/lists";

/**
 * The Lists section on a task sheet, a project page or a note. "Attached"
 * offers a run when the task starts (and can start one here); "Link only"
 * just points at the list. Notes can only link.
 */
export default function ParentLists({
  workspace,
  target,
  readOnly,
  onMutate,
  onOpenList,
  quiet = false,
  startAdding = false,
  onAddingDone,
}: {
  workspace: Workspace;
  target: ListLink["target"];
  readOnly: boolean;
  onMutate: (update: (w: Workspace) => Workspace) => boolean | void;
  onOpenList: (templateId: string) => void;
  /** Notes: show nothing unless a list is linked or one is being linked. */
  quiet?: boolean;
  startAdding?: boolean;
  onAddingDone?: () => void;
}) {
  const [addingState, setAdding] = useState(false);
  const adding = addingState || startAdding;
  const stopAdding = () => {
    setAdding(false);
    onAddingDone?.();
  };
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState<ListLink["mode"]>(target.kind === "note" ? "link" : "attached");
  const [menu, setMenu] = useState<string | null>(null);
  const templates = listsOf(workspace).templates;
  const links = linksFor(workspace, target.kind, target.id);
  if (!links.length && (readOnly || !templates.length)) return null;
  if (quiet && !links.length && !adding) return null;
  const available = templates.filter(t => !links.some(l => l.templateId === t.id));
  const parent = target.kind === "note" ? null : { kind: target.kind, id: target.id };

  return (
    <section className="pl" aria-label="Lists">
      <h3 className="pl-heading">Lists</h3>
      {links.map(link => {
        const template = findTemplate(workspace, link.templateId);
        if (!template) return null;
        const run = openRun(workspace, template.id);
        const mine = run && parent && run.parent?.kind === parent.kind && run.parent.id === parent.id;
        const progress = mine ? runProgress(workspace, run) : null;
        return (
          <div key={link.id} className="pl-row">
            <button type="button" className="pl-open" onClick={() => onOpenList(template.id)}>
              <span className="pl-title">{template.title}</span>
              <span className="lv-meta">
                {link.mode === "link" ? "link only ↗" : progress ? `attached · ${progress.done}/${progress.total} ›` : "attached"}
              </span>
            </button>
            {link.mode === "attached" && parent && !mine && !readOnly && !run && (
              <button
                type="button"
                className="tp-btn"
                onClick={() => onMutate(w => startRun(w, newListRunId(), template.id, adelaideTimestamp(), parent))}
              >
                Start a run
              </button>
            )}
            {!readOnly && (
              <span className="lv-dots">
                <button type="button" className="lv-dots-button" aria-label={`Options for ${template.title}`} aria-expanded={menu === link.id} onClick={() => setMenu(menu === link.id ? null : link.id)}>
                  <MoreHorizontal size={18} aria-hidden="true" />
                </button>
                {menu === link.id && (
                  <span className="lv-menu" role="group">
                    <button
                      type="button"
                      onClick={() => {
                        onMutate(w => removeLink(w, link.id));
                        setMenu(null);
                      }}
                    >
                      Remove from this {target.kind}
                    </button>
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })}
      {!readOnly && available.length > 0 &&
        (adding ? (
          <form
            className="pl-add"
            onSubmit={e => {
              e.preventDefault();
              if (!templateId) return;
              const ok = onMutate(w => addLink(w, newListLinkId(), templateId, target, mode, adelaideTimestamp()));
              if (ok !== false) {
                stopAdding();
                setTemplateId("");
              }
            }}
          >
            <select aria-label="Which list" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              <option value="">Choose a list…</option>
              {available.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            {target.kind !== "note" && (
              <select aria-label="Attach or link only" value={mode} onChange={e => setMode(e.target.value as ListLink["mode"])}>
                <option value="attached">Attach (offer a run when it starts)</option>
                <option value="link">Link only</option>
              </select>
            )}
            <button type="submit" className="tp-btn" disabled={!templateId}>
              {mode === "attached" && target.kind !== "note" ? "Attach" : "Link"}
            </button>
            <button type="button" className="lv-link" onClick={stopAdding}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="lv-link" onClick={() => setAdding(true)}>
            + {target.kind === "note" ? "Link a list" : "Attach or link a list"}
          </button>
        ))}
    </section>
  );
}
