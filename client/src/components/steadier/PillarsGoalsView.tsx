import React, { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { adelaideTimestamp } from "../../../../shared/time";
import { addGoal, editGoal, newGoal, type Goal } from "../../domain/goals";
import { linesToTitles, pillarCards, type PillarCard } from "../../domain/pillarCards";
import { adelaideClock } from "../../domain/time";
import type { Workspace } from "../../domain/types";

interface Props {
  workspace: Workspace;
  onOpenGoal: (id: string) => void;
  onOpenMap: () => void;
  onOpenProject?: (id: string) => void;
  onMutate: (change: (w: Workspace) => Workspace) => boolean | void;
  readOnly: boolean;
}

export const PILLARS_INFO =
  "Your Pillars in your own order. Tap one to see its Value Goals, under each its Goal Outcomes, and under those the projects that serve them. Add a definition, Value Goals and Outcomes right here: type one and press Enter for the next, or paste several lines at once. A green bar means an active Imperative is linked to that Pillar or something under it. Grey chips show only what's missing or quiet (nothing moved for 30 days). Tap any name to open it in full.";

/** "+ Add …": plain grey text; opens a box that stays open for the next one. Paste several lines to add them all. */
function AddLine({
  label,
  placeholder,
  disabled,
  onAdd,
}: {
  label: string;
  placeholder: string;
  disabled: boolean;
  onAdd: (titles: string[]) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button type="button" className="pg-add" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  const submit = () => {
    const titles = linesToTitles(text);
    if (!titles.length) return;
    if (onAdd(titles)) setText("");
  };
  return (
    <div className="pg-add-box">
      <textarea
        aria-label={label.replace(/^\+\s*/, "")}
        value={text}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        placeholder={placeholder}
        autoFocus
        maxLength={6000}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setText("");
            setOpen(false);
          }
        }}
      />
      <span className="pg-add-actions">
        <button type="button" className="tp-btn" disabled={!text.trim()} onClick={submit}>
          Add
        </button>
        <button
          type="button"
          className="pg-add"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
        >
          Done
        </button>
      </span>
    </div>
  );
}

function DefinitionLine({ pillar, disabled, onSave }: { pillar: Goal; disabled: boolean; onSave: (text: string) => boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(pillar.description);
  const definition = pillar.description.trim();
  if (!editing)
    return definition ? (
      <button
        type="button"
        className="pg-definition"
        disabled={disabled}
        onClick={() => {
          setText(pillar.description);
          setEditing(true);
        }}
        aria-label={`Definition: ${definition}. Tap to edit.`}
      >
        {definition}
      </button>
    ) : (
      <button
        type="button"
        className="pg-add"
        disabled={disabled}
        onClick={() => {
          setText("");
          setEditing(true);
        }}
      >
        + Add definition
      </button>
    );
  const save = () => {
    if (onSave(text.trim())) setEditing(false);
  };
  return (
    <div className="pg-add-box">
      <input
        aria-label={`Definition of ${pillar.title}`}
        value={text}
        autoFocus
        maxLength={2000}
        placeholder="What this Pillar means to you, in a line"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <span className="pg-add-actions">
        <button type="button" className="tp-btn" onClick={save}>
          Save
        </button>
        <button type="button" className="pg-add" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
    </div>
  );
}

export default function PillarsGoalsView({ workspace, onOpenGoal, onOpenMap, onOpenProject, onMutate, readOnly }: Props) {
  const today = adelaideClock().date;
  const { active, retired } = pillarCards(workspace, today);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [showRetired, setShowRetired] = useState(false);
  const toggle = (id: string) =>
    setOpen(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = (change: (w: Workspace) => Workspace, done: string): boolean => {
    if (readOnly) return false;
    const ok = onMutate(change);
    if (ok === false) {
      toast.error("That wasn't saved. Check sync and try again.");
      return false;
    }
    toast(done);
    return true;
  };
  const addUnder = (level: "value-goal" | "outcome", parentId: string, titles: string[]) => {
    const stamp = adelaideTimestamp();
    const label = level === "value-goal" ? "Value Goal" : "Outcome";
    return apply(
      w => titles.reduce((acc, title) => addGoal(acc, newGoal(level, title, stamp, { parents: [{ id: parentId, confirmed: true }] })), w),
      titles.length === 1 ? `${label} added.` : `${titles.length} ${label}s added.`
    );
  };
  const setDefinition = (pillar: Goal, text: string) =>
    text === pillar.description.trim()
      ? true
      : apply(w => editGoal(w, pillar.id, { description: text }, adelaideTimestamp()), text ? "Definition saved." : "Definition cleared.");

  const card = (c: PillarCard) => {
    const isOpen = open.has(c.pillar.id);
    return (
      <section
        key={c.pillar.id}
        className={`tp-row pj-row pg-card${c.green ? " tp-green" : ""}`}
        aria-label={c.pillar.title}
        onClick={event => {
          if ((event.target as HTMLElement).closest("button, input, textarea, a")) return;
          if (!isOpen) toggle(c.pillar.id);
        }}
      >
        <button type="button" className="pg-head" aria-expanded={isOpen} onClick={() => toggle(c.pillar.id)}>
          <span className="tp-title">{c.pillar.title}</span>
          {isOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        </button>
        <DefinitionLine pillar={c.pillar} disabled={readOnly} onSave={text => setDefinition(c.pillar, text)} />
        <span className="pg-summary">
          <span className="tp-meta">{c.summary}</span>
          {c.chips.map(chip => (
            <span key={chip} className="tp-chip">
              {chip}
            </span>
          ))}
        </span>
        {isOpen && (
          <div className="pg-tree">
            {c.valueGoals.map(vg => (
              <div key={vg.valueGoal.id} className="pg-vg">
                <button type="button" className="pg-name pg-name--vg" onClick={() => onOpenGoal(vg.valueGoal.id)}>
                  {vg.valueGoal.title}
                </button>
                <ul className="pg-outcomes">
                  {vg.outcomes.map(o => (
                    <li key={o.outcome.id}>
                      <button type="button" className="pg-name" onClick={() => onOpenGoal(o.outcome.id)}>
                        {o.outcome.title}
                      </button>
                      {o.projects.length > 0 && (
                        <ul className="pg-projects">
                          {o.projects.map(project => (
                            <li key={project.id}>
                              <button type="button" className="pg-project" disabled={!onOpenProject} onClick={() => onOpenProject?.(project.id)}>
                                {project.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                  <li>
                    <AddLine
                      label="+ Add Outcome"
                      placeholder="An Outcome for this Value Goal (or paste several lines)"
                      disabled={readOnly}
                      onAdd={titles => addUnder("outcome", vg.valueGoal.id, titles)}
                    />
                  </li>
                </ul>
              </div>
            ))}
            <AddLine
              label="+ Add Value Goal"
              placeholder="A Value Goal for this Pillar (or paste several lines)"
              disabled={readOnly}
              onAdd={titles => addUnder("value-goal", c.pillar.id, titles)}
            />
            <button type="button" className="pg-add pg-open-full" onClick={() => onOpenGoal(c.pillar.id)}>
              Open {c.pillar.title} in full ›
            </button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="pg" aria-label="Pillars and Goals">
      {active.length ? active.map(card) : <p className="tp-meta">No Pillars yet. Add one on the Compass map.</p>}
      {retired.length > 0 && (
        <div className="pg-retired">
          <button type="button" className="pg-add" aria-expanded={showRetired} onClick={() => setShowRetired(v => !v)}>
            Retired ({retired.length}) {showRetired ? "⌄" : "›"}
          </button>
          {showRetired &&
            retired.map(p => (
              <button key={p.id} type="button" className="pg-name pg-retired-name" onClick={() => onOpenGoal(p.id)}>
                {p.title}
              </button>
            ))}
        </div>
      )}
      <button type="button" className="pg-add" onClick={onOpenMap}>
        Open Compass map ›
      </button>
    </div>
  );
}
