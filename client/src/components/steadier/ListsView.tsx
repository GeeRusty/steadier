import React, { useEffect, useState } from "react";
import { Check, ChevronLeft, MoreHorizontal } from "lucide-react";
import type { ListKind, ListRun, ListTemplate, Workspace } from "../../domain/types";
import { adelaideTimestamp, formatAdelaide } from "../../../../shared/time";
import {
  addExtra,
  addItem,
  addMissingToTemplate,
  addSection,
  addTemplate,
  confirmExtra,
  confirmItem,
  editItem,
  editTemplate,
  finishedRuns,
  finishRun,
  LIST_ITEM_LIMIT,
  LIST_KIND_LABEL,
  LIST_SECTION_LIMIT,
  LIST_TITLE_LIMIT,
  LIST_USE_WHEN_LIMIT,
  listSpeech,
  listsOf,
  missingCandidates,
  newListId,
  newListItemId,
  newListRunId,
  newListSectionId,
  newRun,
  openRun,
  removeExtra,
  removeItem,
  removeSection,
  removeTemplate,
  renameSection,
  resetRun,
  runProgress,
  runRows,
  SECTION_SUGGEST_SPLIT,
  startRun,
  tickItem,
  type RunRow,
} from "../../domain/lists";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  onMutate: (update: (workspace: Workspace) => Workspace) => boolean;
  /** The page's one Read aloud (in the ⋮ menu) reads what's on screen. */
  readRef?: React.MutableRefObject<(() => string) | null>;
  /** Open this list (e.g. from a "Packing 4/9" chip); cleared once opened. */
  focusTemplateId?: string | null;
  onFocusHandled?: () => void;
}

type Tab = "run" | "template" | "runs";

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
}

function parentTitle(workspace: Workspace, run: ListRun | null): string | null {
  if (!run?.parent) return null;
  return run.parent.kind === "task"
    ? workspace.tasks.find(t => t.id === run.parent!.id)?.title ?? null
    : workspace.projects.find(p => p.id === run.parent!.id)?.title ?? null;
}

/** Changes run through here: a no-op change means "not saved". */
function useChange(onMutate: Props["onMutate"], readOnly: boolean) {
  return (update: (w: Workspace, at: string) => Workspace): boolean => {
    if (readOnly) return false;
    let changed = false;
    const ok = onMutate(w => {
      const next = update(w, adelaideTimestamp());
      changed = next !== w;
      return next;
    });
    return ok && changed;
  };
}

export default function ListsView({ workspace, readOnly, onMutate, readRef, focusTemplateId, onFocusHandled }: Props) {
  const change = useChange(onMutate, readOnly);
  const lists = listsOf(workspace);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("template");
  const [finishedRunId, setFinishedRunId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<ListKind>("do-confirm");
  const selected = lists.templates.find(t => t.id === selectedId) ?? null;

  const open = (id: string) => {
    setSelectedId(id);
    setFinishedRunId(null);
    setTab(openRun(workspace, id) ? "run" : "template");
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (focusTemplateId && lists.templates.some(t => t.id === focusTemplateId)) {
      open(focusTemplateId);
      onFocusHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTemplateId]);
  // A deleted list (or one removed elsewhere) returns to the list of lists.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  useEffect(() => {
    if (!readRef) return;
    readRef.current = () => {
      if (selected) return listSpeech(workspace, selected.id);
      if (!lists.templates.length) return "Lists. No lists yet.";
      return `Lists. ${lists.templates
        .map(t => {
          const run = openRun(workspace, t.id);
          if (!run) return `${t.title}.`;
          const { done, total } = runProgress(workspace, run);
          return `${t.title}, ${done} of ${total} done.`;
        })
        .join(" ")}`;
    };
    return () => {
      readRef.current = null;
    };
  });

  if (selected) {
    return (
      <ListDetail
        key={selected.id}
        workspace={workspace}
        template={selected}
        readOnly={readOnly}
        change={change}
        tab={tab}
        onTab={setTab}
        finishedRunId={finishedRunId}
        onFinished={id => setFinishedRunId(id)}
        onBack={() => {
          setSelectedId(null);
          setFinishedRunId(null);
        }}
      />
    );
  }

  const inUse = lists.templates.filter(t => openRun(workspace, t.id));
  const ready = lists.templates.filter(t => !openRun(workspace, t.id));
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const id = newListId();
    if (change((w, at) => addTemplate(w, id, newTitle, at, newKind))) {
      setNewTitle("");
      setNewOpen(false);
      open(id);
    }
  };

  return (
    <section className="lv" aria-labelledby="lists-title">
      <h1 id="lists-title" className="sr-only">Lists</h1>
      <div className="lv-toolbar">
        {!newOpen && (
          <button type="button" className="tp-btn" disabled={readOnly} onClick={() => setNewOpen(true)}>
            + List
          </button>
        )}
      </div>
      {newOpen && (
        <form className="lv-card lv-form" onSubmit={create}>
          <label className="lv-field">
            Name
            <input value={newTitle} maxLength={LIST_TITLE_LIMIT} autoFocus onChange={e => setNewTitle(e.target.value)} placeholder="For example, Kingston packing" />
          </label>
          <KindChoice value={newKind} onChange={setNewKind} />
          <span className="lv-row-actions">
            <button type="submit" className="tp-btn tp-btn-primary" disabled={!newTitle.trim()}>
              Make list
            </button>
            <button type="button" className="lv-link" onClick={() => setNewOpen(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {!lists.templates.length && !newOpen && <p className="lv-quiet">No lists yet.</p>}
      {inUse.length > 0 && (
        <>
          <h2 className="tp-label">In use ({inUse.length})</h2>
          {inUse.map(t => {
            const run = openRun(workspace, t.id)!;
            const { done, total } = runProgress(workspace, run);
            const forWhat = parentTitle(workspace, run);
            return (
              <button type="button" key={t.id} className="lv-card lv-list-row" onClick={() => open(t.id)}>
                <span className="lv-row-top">
                  <span className="lv-title">{t.title}</span>
                  <span className="tp-chip">
                    {done}/{total}
                  </span>
                </span>
                <span className="lv-meta">
                  {LIST_KIND_LABEL[t.kind]} · {forWhat ? `for ${forWhat}` : `started ${shortDate(run.date)}`}
                </span>
              </button>
            );
          })}
        </>
      )}
      {ready.length > 0 && (
        <>
          <h2 className="tp-label">Ready ({ready.length})</h2>
          {ready.map(t => {
            const last = finishedRuns(workspace, t.id)[0];
            return (
              <button type="button" key={t.id} className="lv-card lv-list-row" onClick={() => open(t.id)}>
                <span className="lv-title">{t.title}</span>
                <span className="lv-meta">
                  {LIST_KIND_LABEL[t.kind]} · {last ? `last used ${shortDate(last.date)}` : "never used"}
                </span>
              </button>
            );
          })}
        </>
      )}
    </section>
  );
}

function KindChoice({ value, onChange }: { value: ListKind; onChange: (kind: ListKind) => void }) {
  return (
    <fieldset className="lv-kind">
      <legend>Type</legend>
      {(["read-do", "do-confirm"] as ListKind[]).map(kind => (
        <button key={kind} type="button" className={`lv-seg${value === kind ? " on" : ""}`} aria-pressed={value === kind} onClick={() => onChange(kind)}>
          {LIST_KIND_LABEL[kind]}
        </button>
      ))}
    </fieldset>
  );
}

/** Three dots: options appear only when asked for. */
function Dots({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="lv-dots">
      <button type="button" className="lv-dots-button" aria-label={label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && <span className="lv-menu" role="group" aria-label={label}>{children(() => setOpen(false))}</span>}
    </span>
  );
}

interface DetailProps {
  workspace: Workspace;
  template: ListTemplate;
  readOnly: boolean;
  change: ReturnType<typeof useChange>;
  tab: Tab;
  onTab: (tab: Tab) => void;
  finishedRunId: string | null;
  onFinished: (runId: string | null) => void;
  onBack: () => void;
}

function ListDetail(p: DetailProps) {
  const { workspace, template, readOnly, change } = p;
  const run = openRun(workspace, template.id);
  const history = finishedRuns(workspace, template.id);
  const [editing, setEditing] = useState<"title" | "useWhen" | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tab: Tab = p.tab === "run" && !run ? "template" : p.tab;
  const finished = p.finishedRunId ? listsOf(workspace).runs.find(r => r.id === p.finishedRunId) ?? null : null;

  const saveMeta = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const current = editing === "title" ? template.title : template.useWhen;
    if (draft.replace(/\s+/g, " ").trim() === current) {
      setEditing(null);
      return;
    }
    const patch = editing === "title" ? { title: draft } : { useWhen: draft };
    if (change((w, at) => editTemplate(w, template.id, patch, at))) setEditing(null);
  };

  return (
    <section className="lv" aria-labelledby="list-title">
      <button type="button" className="lv-back" onClick={p.onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> All lists
      </button>
      {editing ? (
        <form className="lv-card lv-form" onSubmit={saveMeta}>
          <label className="lv-field">
            {editing === "title" ? "Name" : "Use when (the moment to use this list)"}
            <input
              autoFocus
              value={draft}
              maxLength={editing === "title" ? LIST_TITLE_LIMIT : LIST_USE_WHEN_LIMIT}
              placeholder={editing === "useWhen" ? "For example, before leaving for Kingston" : undefined}
              onChange={e => setDraft(e.target.value)}
            />
          </label>
          <span className="lv-row-actions">
            <button type="submit" className="tp-btn tp-btn-primary">Save</button>
            <button type="button" className="lv-link" onClick={() => setEditing(null)}>Cancel</button>
          </span>
        </form>
      ) : (
        <div className="lv-title-row">
          <h1 id="list-title" className="lv-heading">{template.title}</h1>
          {!readOnly && (
            <Dots label={`Options for ${template.title}`}>
              {close => (
                <>
                  <button type="button" onClick={() => { setDraft(template.title); setEditing("title"); close(); }}>Rename</button>
                  <button type="button" onClick={() => { setDraft(template.useWhen); setEditing("useWhen"); close(); }}>
                    {template.useWhen ? "Change Use when" : "Add Use when"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      change((w, at) => editTemplate(w, template.id, { kind: template.kind === "read-do" ? "do-confirm" : "read-do" }, at));
                      close();
                    }}
                  >
                    Make it {LIST_KIND_LABEL[template.kind === "read-do" ? "do-confirm" : "read-do"]}
                  </button>
                  <button type="button" className="lv-danger" onClick={() => { setConfirmDelete(true); close(); }}>Delete list</button>
                </>
              )}
            </Dots>
          )}
        </div>
      )}
      {confirmDelete && (
        <div className="lv-card lv-confirm" role="alertdialog" aria-label="Delete this list?">
          <span>
            Delete {template.title}
            {history.length || run ? ` and its ${history.length + (run ? 1 : 0)} run${history.length + (run ? 1 : 0) === 1 ? "" : "s"}` : ""}? This can't be undone here.
          </span>
          <span className="lv-row-actions">
            <button type="button" className="tp-btn lv-danger-btn" onClick={() => change(w => removeTemplate(w, template.id))}>Delete</button>
            <button type="button" className="lv-link" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        </div>
      )}
      <span className="lv-meta">
        {LIST_KIND_LABEL[template.kind]}
        {template.useWhen ? ` · Use when: ${template.useWhen}` : ""}
      </span>

      {finished ? (
        <Finished workspace={workspace} template={template} run={finished} readOnly={readOnly} change={change} onDone={() => { p.onFinished(null); p.onTab("template"); }} />
      ) : (
        <>
          <div className="lv-tabs" role="tablist" aria-label="List views">
            {run && (
              <button type="button" role="tab" aria-selected={tab === "run"} className={`lv-seg${tab === "run" ? " on" : ""}`} onClick={() => p.onTab("run")}>
                Run
              </button>
            )}
            <button type="button" role="tab" aria-selected={tab === "template"} className={`lv-seg${tab === "template" ? " on" : ""}`} onClick={() => p.onTab("template")}>
              Template
            </button>
            <button type="button" role="tab" aria-selected={tab === "runs"} className={`lv-seg${tab === "runs" ? " on" : ""}`} onClick={() => p.onTab("runs")}>
              Runs ({history.length})
            </button>
          </div>
          {tab === "run" && run && (
            <RunView workspace={workspace} template={template} run={run} readOnly={readOnly} change={change} onFinished={id => p.onFinished(id)} />
          )}
          {tab === "template" && (
            <TemplateView
              workspace={workspace}
              template={template}
              run={run}
              readOnly={readOnly}
              change={change}
              onStart={() => {
                if (change((w, at) => startRun(w, newListRunId(), template.id, at))) p.onTab("run");
              }}
              onOpenRun={() => p.onTab("run")}
            />
          )}
          {tab === "runs" && <History workspace={workspace} runs={history} />}
        </>
      )}
    </section>
  );
}

function TemplateView({
  workspace,
  template,
  run,
  readOnly,
  change,
  onStart,
  onOpenRun,
}: {
  workspace: Workspace;
  template: ListTemplate;
  run: ListRun | null;
  readOnly: boolean;
  change: ReturnType<typeof useChange>;
  onStart: () => void;
  onOpenRun: () => void;
}) {
  const [text, setText] = useState("");
  const [sectionId, setSectionId] = useState<string>("");
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const progress = run ? runProgress(workspace, run) : null;
  const groups: { id: string | null; title: string }[] = [{ id: null, title: "" }, ...template.sections];

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (change((w, at) => addItem(w, template.id, newListItemId(), text, sectionId || null, at))) setText("");
  };
  const addSectionNow = (event: React.FormEvent) => {
    event.preventDefault();
    const id = newListSectionId();
    if (change((w, at) => addSection(w, template.id, id, sectionTitle, at))) {
      setSectionTitle("");
      setSectionOpen(false);
      setSectionId(id);
    }
  };

  return (
    <>
      {run && progress ? (
        <button type="button" className="tp-btn lv-wide" onClick={onOpenRun}>
          Run in progress · {progress.done} of {progress.total} ›
        </button>
      ) : (
        <button type="button" className="tp-big lv-wide" disabled={readOnly || !template.items.some(i => !i.suggested)} onClick={onStart}>
          Start a run
        </button>
      )}
      {groups.map(group => {
        const items = template.items.filter(i => i.sectionId === group.id);
        if (group.id === null && !items.length) return null;
        const count = items.filter(i => !i.suggested).length;
        return (
          <div key={group.id ?? "first"} className="lv-section">
            {group.id &&
              (renaming === group.id ? (
                <form
                  className="lv-inline-form"
                  onSubmit={e => {
                    e.preventDefault();
                    if (change((w, at) => renameSection(w, template.id, group.id!, sectionTitle, at))) setRenaming(null);
                  }}
                >
                  <input aria-label="Section name" autoFocus value={sectionTitle} maxLength={LIST_SECTION_LIMIT} onChange={e => setSectionTitle(e.target.value)} />
                  <button type="submit" className="tp-btn">Save</button>
                  <button type="button" className="lv-link" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <div className="lv-section-head">
                  <h2 className="tp-label">
                    {group.title} ({count})
                  </h2>
                  {!readOnly && (
                    <Dots label={`Options for section ${group.title}`}>
                      {close => (
                        <>
                          <button type="button" onClick={() => { setSectionTitle(group.title); setRenaming(group.id); close(); }}>Rename section</button>
                          <button type="button" onClick={() => { change((w, at) => removeSection(w, template.id, group.id!, at)); close(); }}>
                            Remove section (keeps its items)
                          </button>
                        </>
                      )}
                    </Dots>
                  )}
                </div>
              ))}
            {count > SECTION_SUGGEST_SPLIT && (
              <p className="lv-suggest">{count} items. Over {SECTION_SUGGEST_SPLIT}: consider splitting this section.</p>
            )}
            {items.map(item =>
              editingId === item.id ? (
                <form
                  key={item.id}
                  className="lv-inline-form"
                  onSubmit={e => {
                    e.preventDefault();
                    if (change((w, at) => editItem(w, template.id, item.id, { text: editText }, at))) setEditingId(null);
                  }}
                >
                  <input aria-label={`Edit ${item.text}`} autoFocus value={editText} maxLength={LIST_ITEM_LIMIT} onChange={e => setEditText(e.target.value)} />
                  <button type="submit" className="tp-btn">Save</button>
                  <button type="button" className="lv-link" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              ) : (
                <div key={item.id} className={`lv-item${item.suggested ? " lv-suggested" : ""}`}>
                  <span className="lv-item-text">{item.text}</span>
                  {item.suggested ? (
                    <span className="lv-row-actions">
                      <span className="lv-meta">suggested</span>
                      <button type="button" className="tp-btn" disabled={readOnly} onClick={() => change((w, at) => confirmItem(w, template.id, item.id, at))}>Confirm</button>
                      <button type="button" className="lv-link" disabled={readOnly} onClick={() => change((w, at) => removeItem(w, template.id, item.id, at))}>Remove</button>
                    </span>
                  ) : (
                    !readOnly && (
                      <Dots label={`Options for ${item.text}`}>
                        {close => (
                          <>
                            <button type="button" onClick={() => { setEditText(item.text); setEditingId(item.id); close(); }}>Edit</button>
                            {template.sections.length > 0 && (
                              <label className="lv-menu-select">
                                Section
                                <select
                                  value={item.sectionId ?? ""}
                                  onChange={e => {
                                    change((w, at) => editItem(w, template.id, item.id, { sectionId: e.target.value || null }, at));
                                    close();
                                  }}
                                >
                                  <option value="">(top)</option>
                                  {template.sections.map(s => (
                                    <option key={s.id} value={s.id}>{s.title}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <button type="button" className="lv-danger" onClick={() => { change((w, at) => removeItem(w, template.id, item.id, at)); close(); }}>Delete</button>
                          </>
                        )}
                      </Dots>
                    )
                  )}
                </div>
              )
            )}
          </div>
        );
      })}
      {!template.items.length && <p className="lv-quiet">No items yet.</p>}
      {!readOnly && (
        <>
          <form className="lv-add" onSubmit={add}>
            <input aria-label="New item" value={text} maxLength={LIST_ITEM_LIMIT} placeholder="New item, e.g. Gas – off" onChange={e => setText(e.target.value)} />
            {template.sections.length > 0 && (
              <select aria-label="Section for the new item" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                <option value="">(top)</option>
                {template.sections.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            )}
            <button type="submit" className="tp-btn" disabled={!text.trim()}>Add</button>
          </form>
          {sectionOpen ? (
            <form className="lv-inline-form" onSubmit={addSectionNow}>
              <input aria-label="New section" autoFocus value={sectionTitle} maxLength={LIST_SECTION_LIMIT} placeholder="Section, e.g. Inside" onChange={e => setSectionTitle(e.target.value)} />
              <button type="submit" className="tp-btn" disabled={!sectionTitle.trim()}>Add section</button>
              <button type="button" className="lv-link" onClick={() => setSectionOpen(false)}>Cancel</button>
            </form>
          ) : (
            <button type="button" className="lv-link" onClick={() => { setSectionTitle(""); setSectionOpen(true); }}>
              + Section
            </button>
          )}
        </>
      )}
    </>
  );
}

function TickRow({ row, disabled, onTick }: { row: RunRow; disabled: boolean; onTick: () => void }) {
  return (
    <button type="button" className={`lv-tick${row.ticked ? " done" : ""}`} aria-pressed={row.ticked} disabled={disabled} onClick={onTick}>
      <span className="lv-circle" aria-hidden="true">{row.ticked ? <Check size={14} /> : null}</span>
      <span className="lv-item-text">{row.text}</span>
    </button>
  );
}

function RunView({
  workspace,
  template,
  run,
  readOnly,
  change,
  onFinished,
}: {
  workspace: Workspace;
  template: ListTemplate;
  run: ListRun;
  readOnly: boolean;
  change: ReturnType<typeof useChange>;
  onFinished: (runId: string) => void;
}) {
  const [extra, setExtra] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const rows = runRows(workspace, run);
  const { done, total } = runProgress(workspace, run);
  const next = template.kind === "read-do" ? rows.find(r => !r.ticked && !r.suggested) : undefined;
  const tick = (row: RunRow) => change((w, at) => tickItem(w, run.id, row.id, !row.ticked, at));
  const sections = [...new Set(rows.map(r => r.section))];

  return (
    <>
      <div className="lv-run-head">
        <span className="lv-meta">
          Run · {shortDate(run.date)} · {done} of {total}
        </span>
        {!readOnly && (
          <span className="lv-row-actions">
            <button type="button" className="tp-btn" disabled={!done} onClick={() => setConfirmReset(true)}>Reset</button>
            <button type="button" className="tp-btn" onClick={() => change((w, at) => newRun(w, template.id, newListRunId(), at))}>New run</button>
          </span>
        )}
      </div>
      {confirmReset && (
        <div className="lv-card lv-confirm" role="alertdialog" aria-label="Untick everything?">
          <span>Untick all {done} on this run? It keeps its date. (New run keeps this one in history instead.)</span>
          <span className="lv-row-actions">
            <button type="button" className="tp-btn" onClick={() => { change((w, at) => resetRun(w, run.id, at)); setConfirmReset(false); }}>Reset</button>
            <button type="button" className="lv-link" onClick={() => setConfirmReset(false)}>Cancel</button>
          </span>
        </div>
      )}
      <div className="review-progress-bar" role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      {next && (
        <div className="lv-card lv-next">
          <span className="lv-meta">Next{next.section ? ` · ${next.section}` : ""}</span>
          <span className="lv-next-text">{next.text}</span>
          <button type="button" className="tp-big" disabled={readOnly} onClick={() => tick(next)}>
            <Check size={18} aria-hidden="true" /> Done
          </button>
        </div>
      )}
      {sections.map(section => (
        <div key={section || "first"} className="lv-section">
          {section && <h2 className="tp-label">{section}</h2>}
          {rows
            .filter(r => r.section === section)
            .map(row =>
              row.suggested ? (
                <div key={row.id} className="lv-item lv-suggested">
                  <span className="lv-item-text">{row.text}</span>
                  <span className="lv-row-actions">
                    <span className="lv-meta">suggested</span>
                    <button
                      type="button"
                      className="tp-btn"
                      disabled={readOnly}
                      onClick={() => change((w, at) => (row.extra ? confirmExtra(w, run.id, row.id, at) : confirmItem(w, template.id, row.id, at)))}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="lv-link"
                      disabled={readOnly}
                      onClick={() => change((w, at) => (row.extra ? removeExtra(w, run.id, row.id, at) : removeItem(w, template.id, row.id, at)))}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              ) : (
                <div key={row.id} className="lv-tick-row">
                  <TickRow row={row} disabled={readOnly} onTick={() => tick(row)} />
                  {row.extra && !readOnly && (
                    <Dots label={`Options for ${row.text}`}>
                      {close => (
                        <button type="button" className="lv-danger" onClick={() => { change((w, at) => removeExtra(w, run.id, row.id, at)); close(); }}>
                          Remove from this run
                        </button>
                      )}
                    </Dots>
                  )}
                </div>
              )
            )}
        </div>
      ))}
      {!readOnly && (
        <>
          <form
            className="lv-add"
            onSubmit={e => {
              e.preventDefault();
              if (change((w, at) => addExtra(w, run.id, newListItemId(), extra, at))) setExtra("");
            }}
          >
            <input aria-label="Add for this run only" value={extra} maxLength={LIST_ITEM_LIMIT} placeholder="Add for this run only" onChange={e => setExtra(e.target.value)} />
            <button type="submit" className="tp-btn" disabled={!extra.trim()}>Add</button>
          </form>
          <button
            type="button"
            className={done === total && total > 0 ? "tp-big lv-wide" : "tp-btn lv-wide"}
            onClick={() => {
              if (change((w, at) => finishRun(w, run.id, at))) onFinished(run.id);
            }}
          >
            Finish
          </button>
        </>
      )}
    </>
  );
}

function Finished({
  workspace,
  template,
  run,
  readOnly,
  change,
  onDone,
}: {
  workspace: Workspace;
  template: ListTemplate;
  run: ListRun;
  readOnly: boolean;
  change: ReturnType<typeof useChange>;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const { done, total } = runProgress(workspace, run);
  const candidates = missingCandidates(workspace, run);
  return (
    <>
      <span className="lv-meta">
        Finished {run.finishedAt ? formatAdelaide(run.finishedAt) : ""} · {done} of {total}
      </span>
      <div className="lv-card lv-form">
        <h2 className="lv-subheading">Anything missing?</h2>
        {candidates.length > 0 && (
          <>
            <span className="lv-meta">Added during this run only:</span>
            {candidates.map(candidate => (
              <span key={candidate} className="lv-item">
                <span className="lv-item-text">{candidate}</span>
                <button type="button" className="tp-btn" disabled={readOnly} onClick={() => change((w, at) => addMissingToTemplate(w, template.id, newListItemId(), candidate, at))}>
                  Add to list
                </button>
              </span>
            ))}
          </>
        )}
        <form
          className="lv-add"
          onSubmit={e => {
            e.preventDefault();
            if (change((w, at) => addMissingToTemplate(w, template.id, newListItemId(), text, at))) setText("");
          }}
        >
          <input aria-label="Something new for this list" value={text} maxLength={LIST_ITEM_LIMIT} placeholder="Something new" onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-btn" disabled={readOnly || !text.trim()}>Add to list</button>
        </form>
        <button type="button" className="lv-link" onClick={onDone}>
          {candidates.length ? "Done" : "Nothing missing"}
        </button>
      </div>
    </>
  );
}

function History({ workspace, runs }: { workspace: Workspace; runs: ListRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!runs.length) return <p className="lv-quiet">No finished runs yet.</p>;
  return (
    <>
      <p className="lv-meta">Each finished run keeps its date and what was ticked.</p>
      {runs.map(run => {
        const { done, total } = runProgress(workspace, run);
        const isOpen = openId === run.id;
        return (
          <div key={run.id} className="lv-section">
            <button type="button" className="lv-history-row" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : run.id)}>
              <span>{shortDate(run.date)}</span>
              <span className="lv-meta">
                {done}/{total} {isOpen ? "▾" : "›"}
              </span>
            </button>
            {isOpen && (
              <ul className="lv-snapshot">
                {(run.snapshot ?? []).map(item => (
                  <li key={item.id} className={item.ticked ? "done" : ""}>
                    {item.ticked ? "✓" : "–"} {item.text}
                    {item.extra ? " (this run only)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
