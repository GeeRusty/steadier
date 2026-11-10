import { Check, ExternalLink } from "lucide-react";
import {
  CATCH_ALL_LABEL,
  CATCH_ALLS,
  DECISION_LABEL,
  DECISION_OUTCOMES,
  normaliseNotionUrl,
  type CatchAll,
  type Decision,
  type DecisionOutcome,
  type Imperative,
  type TaskCompass,
} from "../../domain/compass";
import { adelaideTimestamp as localTimestamp } from "../../../../shared/time";

/** Owner picks an outcome (confirmed at once) or confirms a suggestion. */
export function DecisionField({
  decision,
  onChange,
  label = "Decision outcome",
}: {
  decision: Decision | null;
  onChange: (decision: Decision | null) => void;
  label?: string;
}) {
  const choose = (value: string) => {
    if (!value) return onChange(null);
    onChange({
      outcome: value as DecisionOutcome,
      at: localTimestamp(),
      by: "owner",
      confirmed: true,
      note: decision?.note ?? "",
    });
  };
  return (
    <div className="field">
      <label className="field">
        {label}
        <select
          aria-label={label}
          value={decision?.outcome ?? ""}
          onChange={e => choose(e.target.value)}
        >
          <option value="">Not decided</option>
          {DECISION_OUTCOMES.map(o => (
            <option key={o} value={o}>
              {DECISION_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      {decision && !decision.confirmed && (
        <p className="suggestion-line small">
          <span className="suggested-chip">
            {decision.by === "claude"
              ? "Suggested by Claude"
              : decision.by === "chatgpt"
                ? "Suggested by ChatGPT"
                : decision.by === "connector"
                  ? "Suggested by connector"
                  : "Suggested"}
          </span>{" "}
          Not a decision until you confirm it.
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({
                ...decision,
                by: "owner",
                confirmed: true,
                at: localTimestamp(),
              })
            }
          >
            <Check size={14} /> Confirm {DECISION_LABEL[decision.outcome]}
          </button>
        </p>
      )}
      {decision?.outcome === "retire" && decision.confirmed && (
        <p className="small muted">
          Retire keeps the record. Archive or mark it done when you are ready;
          nothing is deleted.
        </p>
      )}
      {decision?.outcome === "delegate" && decision.confirmed && (
        <p className="small muted">
          Who is it with now? Note it in “Waiting for” so it comes back to you.
        </p>
      )}
    </div>
  );
}

export function NotionField({
  value,
  onChange,
  onError,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  onError?: (message: string) => void;
}) {
  return (
    <label className="field">
      Notion page link
      <span className="notion-row">
        <input
          aria-label="Notion page link"
          type="url"
          inputMode="url"
          placeholder="https://www.notion.so/…"
          defaultValue={value ?? ""}
          onBlur={e => {
            const text = e.target.value.trim();
            if (!text) return onChange(null);
            const url = normaliseNotionUrl(text);
            if (!url) {
              onError?.("Use an https notion.so or notion.site link.");
              return;
            }
            onChange(url);
          }}
        />
        {value && (
          <a
            className="text-button"
            href={value}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open in Notion"
          >
            <ExternalLink size={14} /> Open
          </a>
        )}
      </span>
    </label>
  );
}

export function ImperativePicker({
  selected,
  imperatives,
  onChange,
}: {
  selected: string[];
  imperatives: Imperative[];
  onChange: (ids: string[]) => void;
}) {
  const active = imperatives.filter(
    i => i.status === "active" || selected.includes(i.id)
  );
  if (active.length === 0) {
    return (
      <p className="small muted">
        No Active Imperatives yet. Add them under Imperatives.
      </p>
    );
  }
  return (
    <div
      className="imperative-picker"
      role="group"
      aria-label="Linked Imperatives"
    >
      {active.map(i => {
        const on = selected.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            className={`chip-toggle${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() =>
              onChange(
                on ? selected.filter(id => id !== i.id) : [...selected, i.id]
              )
            }
          >
            {i.title}
            {i.status === "retired" ? " (retired)" : ""}
          </button>
        );
      })}
    </div>
  );
}

/** The Compass section of the task editor: Imperatives, catch-all and decision. */
export function TaskCompassFields({
  compass,
  onChange,
  imperatives,
  suggestion,
  hasProject,
}: {
  compass: TaskCompass;
  onChange: (compass: TaskCompass) => void;
  imperatives: Imperative[];
  suggestion: CatchAll | null;
  hasProject: boolean;
}) {
  const unplaced =
    !hasProject &&
    compass.imperativeIds.length === 0 &&
    compass.catchAll === null;
  return (
    <details
      className="detail-section compass-section"
      open={unplaced || !!compass.decision}
    >
      <summary>
        Compass · {unplaced ? "unplaced" : "placed"}
        {compass.decision
          ? ` · ${DECISION_LABEL[compass.decision.outcome]}${compass.decision.confirmed ? "" : " (suggested)"}`
          : ""}
      </summary>
      {unplaced && (
        <p className="small unplaced-note">
          Nothing links this yet. Link it to an Imperative or project, or file
          it under Life Admin or Erosion Guard, so it does not float.
        </p>
      )}
      <div className="field">
        <span>Serves Imperative</span>
        <ImperativePicker
          selected={compass.imperativeIds}
          imperatives={imperatives}
          onChange={imperativeIds => onChange({ ...compass, imperativeIds })}
        />
      </div>
      <label className="field">
        Catch-all
        <select
          aria-label="Catch-all"
          value={compass.catchAll ?? ""}
          onChange={e => {
            const value = (e.target.value || null) as CatchAll | null;
            onChange({
              ...compass,
              catchAll: value,
              catchAllConfirmed: value !== null,
            });
          }}
        >
          <option value="">None</option>
          {CATCH_ALLS.map(c => (
            <option key={c} value={c}>
              {CATCH_ALL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      {compass.catchAll && !compass.catchAllConfirmed && (
        <p className="suggestion-line small">
          <span className="suggested-chip">Suggested</span>{" "}
          {CATCH_ALL_LABEL[compass.catchAll]}.
          <button
            type="button"
            className="text-button"
            onClick={() => onChange({ ...compass, catchAllConfirmed: true })}
          >
            <Check size={14} /> Confirm
          </button>
        </p>
      )}
      {!compass.catchAll && unplaced && suggestion && (
        <p className="suggestion-line small">
          Support work like this often belongs in {CATCH_ALL_LABEL[suggestion]}.
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({
                ...compass,
                catchAll: suggestion,
                catchAllConfirmed: true,
              })
            }
          >
            File it there
          </button>
        </p>
      )}
      <DecisionField
        decision={compass.decision}
        onChange={decision => onChange({ ...compass, decision })}
      />
    </details>
  );
}
