import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Map as MapIcon,
  Pencil,
  Mic,
  Square,
  Volume2,
} from "lucide-react";
import type { Project, Task, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import {
  addGoal,
  childrenOf,
  GOAL_LEVEL_LABEL,
  GOAL_LEVEL_PLURAL,
  goalsAt,
  linkProject,
  mapGaps,
  newGoal,
  outcomeLastMovement,
  PARENT_LEVEL,
  type Goal,
  type GoalLevel,
} from "../../domain/goals";
import { imperativesForGoal } from "../../domain/mapPages";
import { PillarStrip } from "./PillarStrip";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";

interface Props {
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenProject?: (project: Project) => void;
  onOpenTask?: (task: Task) => void;
  onOpenGoal: (id: string) => void;
  onOpenImperatives: () => void;
  onOpenCompassView?: () => void;
  voice: VoiceControls;
  readOnly: boolean;
  /** Set by Today's free Pillar slot: jump to the Pillar form once. */
  addPillarPending?: boolean;
  onAddPillarHandled?: () => void;
}

function openSteps(workspace: Workspace, projectId: string): number {
  return workspace.tasks.filter(
    t => t.projectId === projectId && t.state !== "done"
  ).length;
}

export default function CompassMapView({
  workspace,
  onMutate,
  onOpenProject,
  onOpenGoal,
  onOpenImperatives,
  onOpenCompassView,
  voice,
  readOnly,
  addPillarPending,
  onAddPillarHandled,
}: Props) {
  const today = adelaideClock().date;
  // Bumped whenever a free Pillar slot is tapped; the form reacts to it.
  const [addSignal, setAddSignal] = useState(0);
  useEffect(() => {
    if (addPillarPending) {
      setAddSignal(n => n + 1);
      onAddPillarHandled?.();
    }
  }, [addPillarPending, onAddPillarHandled]);
  const gaps = useMemo(() => mapGaps(workspace, today), [workspace, today]);
  const gapCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gaps) m.set(g.id, (m.get(g.id) ?? 0) + 1);
    return m;
  }, [gaps]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showRetired, setShowRetired] = useState(false);
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [message, setMessage] = useState("");
  const read = (text: string) => voice.read(text);
  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));
  const goals = workspace.goals ?? [];
  const pillars = goalsAt(workspace, "pillar", showRetired);
  const looseValueGoals = goalsAt(workspace, "value-goal", showRetired).filter(
    g => !g.parents.length
  );
  const looseOutcomes = goalsAt(workspace, "outcome", showRetired).filter(
    g => !g.parents.length
  );
  // First place each item appears in the tree (items can appear under several parents).
  const firstPath = new Map<string, string>();
  const visit = (goal: Goal, path: string, depth: number) => {
    if (!firstPath.has(goal.id)) firstPath.set(goal.id, path);
    if (depth < 3)
      for (const k of childrenOf(workspace, goal.id, showRetired))
        visit(k, `${path}>${k.id}`, depth + 1);
  };
  pillars.forEach(p => visit(p, p.id, 0));
  [...looseValueGoals, ...looseOutcomes].forEach(g =>
    visit(g, `loose>${g.id}`, 1)
  );
  const mutate = (fn: (w: Workspace) => Workspace, done: string) => {
    if (readOnly) return;
    const ok = onMutate(fn);
    setMessage(
      ok === false
        ? "That change was not saved. Check sync and try again."
        : done
    );
  };

  function readMap() {
    if (!goals.length)
      return read("Your Compass map is empty. Start by adding a Pillar.");
    const parts: string[] = [];
    for (const p of goalsAt(workspace, "pillar")) {
      const vgs = childrenOf(workspace, p.id);
      parts.push(
        `Pillar ${p.title}${vgs.length ? `, with ${vgs.map(v => `${v.title} (${childrenOf(workspace, v.id).length} outcomes)`).join(", ")}` : ", with no Value Goal yet"}.`
      );
    }
    if (gaps.length)
      parts.push(
        `${gaps.length} gap${gaps.length === 1 ? "" : "s"} to look at.`
      );
    read(parts.join(" "));
  }

  function GoalCard({
    goal,
    depth,
    path,
  }: {
    goal: Goal;
    depth: number;
    path: string;
  }) {
    const kids = childrenOf(workspace, goal.id, showRetired);
    const isOpen = open[path] ?? depth < 2;
    const pending = [...goal.parents, ...goal.projects].filter(
      l => !l.confirmed
    );
    const gapsHere = gapCount.get(goal.id) ?? 0;
    const imps = imperativesForGoal(workspace, goal.id);
    const impCount = imps.direct.length + imps.through.length;
    const last =
      goal.level === "outcome" ? outcomeLastMovement(workspace, goal) : null;
    const projects = goal.projects
      .map(l => ({
        link: l,
        project: workspace.projects.find(p => p.id === l.id),
      }))
      .filter(x => x.project) as {
      link: { id: string; confirmed: boolean };
      project: Project;
    }[];
    const hasBody = kids.length > 0 || goal.level === "outcome";
    return (
      <li
        className={`map-node level-${goal.level}${goal.status === "retired" ? " retired" : ""}`}
      >
        <div className="map-node-head">
          {hasBody ? (
            <button
              className="icon-button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              aria-expanded={isOpen}
              onClick={() => toggle(path)}
            >
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="map-node-spacer" />
          )}
          <span className="map-level">{GOAL_LEVEL_LABEL[goal.level]}</span>
          <button
            className="map-title map-title-open"
            onClick={() => onOpenGoal(goal.id)}
            aria-label={`Open ${GOAL_LEVEL_LABEL[goal.level]} ${goal.title}`}
          >
            {goal.title}
          </button>
          <button
            type="button"
            className="text-button map-edit-action"
            aria-label={`Edit ${GOAL_LEVEL_LABEL[goal.level]} ${goal.title}`}
            title="Edit details"
            disabled={readOnly}
            onClick={() => onOpenGoal(goal.id)}
          >
            <Pencil size={14} /> Edit
          </button>
          {goal.status === "retired" && (
            <span className="small muted">retired</span>
          )}
          {gapsHere > 0 && (
            <span className="gap-chip">
              <AlertTriangle size={12} aria-hidden="true" /> {gapsHere}
            </span>
          )}
          {pending.length > 0 && (
            <span className="suggested-chip">{pending.length} suggested</span>
          )}
          {impCount > 0 && (
            <span className="small muted">
              {impCount} Imperative{impCount === 1 ? "" : "s"}
            </span>
          )}
          {goal.notionUrl && (
            <a
              className="text-button"
              href={goal.notionUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={14} /> Notion
            </a>
          )}
        </div>
        {goal.description && (
          <p className="small map-desc">{goal.description}</p>
        )}
        {goal.level === "outcome" && (
          <p className="small muted map-desc">
            {projects.length} project{projects.length === 1 ? "" : "s"} · last
            movement {last ?? "none yet"}
          </p>
        )}
        {isOpen && goal.level === "outcome" && projects.length > 0 && (
          <ul className="map-projects">
            {projects.map(({ link, project }) => (
              <li key={project.id}>
                <button
                  className="text-button"
                  onClick={() => onOpenProject?.(project)}
                >
                  {project.title}
                </button>
                <span className="small muted">
                  {" "}
                  {project.status} · {openSteps(workspace, project.id)} open
                  step{openSteps(workspace, project.id) === 1 ? "" : "s"}
                </span>
                {!link.confirmed && (
                  <button
                    className="quiet-chip"
                    disabled={readOnly}
                    onClick={() =>
                      mutate(
                        w =>
                          linkProject(
                            w,
                            goal.id,
                            project.id,
                            adelaideTimestamp(),
                            true
                          ),
                        `Confirmed “${project.title}” under “${goal.title}”.`
                      )
                    }
                  >
                    <Check size={13} /> Confirm suggested
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOpen && kids.length > 0 && (
          <ul className="map-children">
            {kids.map(k => (
              <GoalCard
                key={`${path}>${k.id}`}
                goal={k}
                depth={depth + 1}
                path={`${path}>${k.id}`}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <section className="compass-map" aria-labelledby="compass-map-title">
      <div className="calendar-toolbar">
        <h1 id="compass-map-title">
          <MapIcon size={20} /> Compass map
        </h1>
        <button className="text-button" onClick={readMap}>
          <Volume2 size={15} /> Read aloud
        </button>
        {onOpenCompassView && (
          <button
            type="button"
            className="text-button compass-map-status-link"
            onClick={onOpenCompassView}
          >
            <Activity size={15} aria-hidden="true" /> Compass view
          </button>
        )}
      </div>
      <PillarStrip
        workspace={workspace}
        today={today}
        readOnly={readOnly}
        onOpenGoal={onOpenGoal}
        onAddPillar={() => setAddSignal(n => n + 1)}
        onOpenMap={() =>
          document
            .querySelector(".map-tree")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        onRead={read}
      />
      <p className="muted">
        Pillars hold Value Goals, Value Goals hold Goal Outcomes, and Goal
        Outcomes are served by projects. Anything can sit under more than one
        item above it. Steadier flags gaps; it never blocks or decides.
      </p>

      {gaps.length > 0 && (
        <section className="map-gaps" aria-label="Gaps to look at">
          <div className="map-gaps-head">
            <strong>
              {gaps.length} gap{gaps.length === 1 ? "" : "s"} to look at
            </strong>
            <button
              className="text-button"
              onClick={() =>
                read(
                  gaps
                    .slice(0, 12)
                    .map(g => g.text)
                    .join(" ")
                )
              }
            >
              <Volume2 size={14} /> Read gaps
            </button>
          </div>
          <ul className="small">
            {(showAllGaps ? gaps : gaps.slice(0, 12)).map(g => (
              <li key={`${g.kind}-${g.id}`}>
                {g.kind === "project-unlinked" ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      onOpenProject?.(
                        workspace.projects.find(p => p.id === g.id)!
                      )
                    }
                  >
                    {g.text}
                  </button>
                ) : (
                  <button
                    className="text-button"
                    onClick={() =>
                      g.kind === "imperative-unmapped"
                        ? onOpenImperatives()
                        : onOpenGoal(g.id)
                    }
                  >
                    {g.text}
                  </button>
                )}
              </li>
            ))}
            {gaps.length > 12 && (
              <li>
                <button
                  className="text-button"
                  onClick={() => setShowAllGaps(v => !v)}
                >
                  {showAllGaps ? "Show fewer" : `Show all ${gaps.length} gaps`}
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <ul className="map-tree">
        {pillars.map(p => (
          <GoalCard key={p.id} goal={p} depth={0} path={p.id} />
        ))}
      </ul>
      {(looseValueGoals.length > 0 || looseOutcomes.length > 0) && (
        <section className="map-loose">
          <strong>Not linked upward yet</strong>
          <ul className="map-tree">
            {[...looseValueGoals, ...looseOutcomes].map(g => (
              <GoalCard
                key={`loose-${g.id}`}
                goal={g}
                depth={1}
                path={`loose>${g.id}`}
              />
            ))}
          </ul>
        </section>
      )}

      <AddGoalForm
        workspace={workspace}
        voice={voice}
        readOnly={readOnly}
        focusPillar={addSignal}
        onAdd={(goal, label) => mutate(w => addGoal(w, goal), label)}
      />
      <label className="check-line small">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={e => setShowRetired(e.target.checked)}
        />{" "}
        Show retired items
      </label>
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function AddGoalForm({
  workspace,
  voice,
  readOnly,
  focusPillar,
  onAdd,
}: {
  workspace: Workspace;
  voice: VoiceControls;
  readOnly: boolean;
  /** Changes when a free Pillar slot is tapped. */
  focusPillar: number;
  onAdd: (goal: Goal, label: string) => void;
}) {
  const formRef = useRef<HTMLElement | null>(null);
  const [level, setLevel] = useState<GoalLevel>(
    goalsAt(workspace, "pillar").length ? "value-goal" : "pillar"
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parents, setParents] = useState<string[]>([]);
  const [dictating, setDictating] = useState(false);
  const base = useRef("");
  useEffect(() => {
    if (!focusPillar) return;
    setLevel("pillar");
    setParents([]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(
      () =>
        formRef.current?.querySelector("input")?.focus({ preventScroll: true }),
      350
    );
  }, [focusPillar]);
  const parentLevel = PARENT_LEVEL[level];
  const candidates = parentLevel ? goalsAt(workspace, parentLevel) : [];

  useEffect(() => {
    if (dictating && voice.transcript)
      setTitle(
        `${base.current}${base.current ? " " : ""}${voice.transcript}`.slice(
          0,
          300
        )
      );
  }, [voice.transcript, dictating]);
  useEffect(() => {
    if (dictating && !voice.listening) setDictating(false);
  }, [voice.listening, dictating]);

  const dictate = () => {
    if (voice.listening) return voice.stop();
    base.current = title.trim();
    voice.clear();
    setDictating(true);
    voice.start();
  };
  const submit = () => {
    const t = title.trim();
    if (!t || readOnly) return;
    const goal = newGoal(level, t, adelaideTimestamp(), {
      description: description.trim(),
      parents: parents.map(id => ({ id, confirmed: true })),
    });
    onAdd(goal, `Added ${GOAL_LEVEL_LABEL[level]} “${t}”.`);
    setTitle("");
    setDescription("");
    setParents([]);
  };
  return (
    <section
      ref={formRef}
      className="imperative-add"
      aria-label="Add to the Compass map"
    >
      <h2>Add to the map</h2>
      <div className="choice-row" role="radiogroup" aria-label="Level">
        {(["pillar", "value-goal", "outcome"] as GoalLevel[]).map(l => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={level === l}
            className={`chip-toggle${level === l ? " on" : ""}`}
            onClick={() => {
              setLevel(l);
              setParents([]);
            }}
          >
            {GOAL_LEVEL_LABEL[l]}
          </button>
        ))}
      </div>
      <label className="field">
        {GOAL_LEVEL_LABEL[level]} title
        <div className="notion-row">
          <input
            value={title}
            maxLength={300}
            onChange={e => setTitle(e.target.value)}
            placeholder={
              level === "pillar"
                ? "e.g. Family"
                : level === "value-goal"
                  ? "e.g. A secure, settled home"
                  : "e.g. New lease signed by March"
            }
          />
          {voice.supported && (
            <button
              type="button"
              className={`button ${dictating && voice.listening ? "listening" : "secondary"} small-button`}
              onClick={dictate}
              aria-label="Dictate title"
            >
              {dictating && voice.listening ? (
                <Square size={14} />
              ) : (
                <Mic size={14} />
              )}
            </button>
          )}
        </div>
      </label>
      <label className="field">
        What it means (optional)
        <textarea
          rows={2}
          maxLength={2000}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </label>
      {parentLevel && (
        <fieldset className="compass-fieldset">
          <legend>
            Sits under ({GOAL_LEVEL_PLURAL[parentLevel]}, any number)
          </legend>
          {candidates.length === 0 ? (
            <p className="small muted">
              No {GOAL_LEVEL_PLURAL[parentLevel]} yet. You can add this now and
              link it later.
            </p>
          ) : (
            <div className="imperative-picker">
              {candidates.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip-toggle${parents.includes(c.id) ? " on" : ""}`}
                  aria-pressed={parents.includes(c.id)}
                  onClick={() =>
                    setParents(ps =>
                      ps.includes(c.id)
                        ? ps.filter(x => x !== c.id)
                        : [...ps, c.id]
                    )
                  }
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <button
        className="button primary"
        disabled={!title.trim() || readOnly}
        onClick={submit}
      >
        Add {GOAL_LEVEL_LABEL[level]}
      </button>
    </section>
  );
}
