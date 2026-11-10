import { useMemo, useState } from "react";
import { History, Volume2, Square } from "lucide-react";
import { DECISION_LABEL } from "../../domain/compass";
import { decisionLogEntries } from "../../domain/activityLog";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";

interface Props {
  workspace: Workspace;
  voice: VoiceControls;
}

function decisionDate(at: string): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
}

const KIND_LABEL = {
  task: "Task",
  project: "Project",
  imperative: "Imperative",
} as const;

export default function DecisionLogView({ workspace, voice }: Props) {
  const [query, setQuery] = useState("");
  const allEntries = useMemo(() => decisionLogEntries(workspace), [workspace]);
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-AU");
    return allEntries.filter(
      entry =>
        !needle ||
        `${entry.title} ${entry.note} ${entry.date} ${entry.at} ${KIND_LABEL[entry.kind]} ${DECISION_LABEL[entry.outcome]}`
          .toLocaleLowerCase("en-AU")
          .includes(needle)
    );
  }, [allEntries, query]);
  const groups = groupByStable(entries, entry => monthGroup(entry.at));
  return (
    <section className="decision-log-view">
      <div className="page-heading">
        <div className="eyebrow">OWNER-CONFIRMED HISTORY</div>
        <h1>Decision Log</h1>
        <p>A read-only record of decisions saved in Weekly Reality Reviews.</p>
      </div>
      {allEntries.length === 0 ? (
        <div className="empty-state">
          <History size={28} />
          <h2>No saved decisions yet.</h2>
          <p>
            When you record a decision in a Weekly Reality Review, it will
            appear here.
          </p>
        </div>
      ) : (
        <>
          <label className="field accordion-search">
            <span>Search decisions</span>
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Decision, outcome, note or date"
            />
          </label>
          {query.trim() && entries.length === 0 ? (
            <p className="empty-state">No decisions match this search.</p>
          ) : (
            <div className="accordion-group-list decision-log-groups">
              {groups.map((group, index) => (
                <AccordionSection
                  key={group.key}
                  persistenceKey={group.key}
                  title={group.label}
                  count={group.items.length}
                  collapsible={entries.length > 5}
                  defaultOpen={index === 0}
                  revealToken={query && group.items.length ? query : ""}
                  className="decision-log-group"
                >
        <div className="decision-log-list">
                    {group.items.map(entry => {
            const spoken = `${KIND_LABEL[entry.kind]}: ${entry.title}. ${DECISION_LABEL[entry.outcome]}.${entry.note ? ` ${entry.note}` : ""}`;
            return (
              <article className="decision-log-entry" key={entry.id}>
                <div className="decision-log-entry-top">
                  <div>
                              <span className="badge">
                                {KIND_LABEL[entry.kind]}
                              </span>
                              <time dateTime={entry.at}>
                                {decisionDate(entry.at)}
                              </time>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                                voice.speaking
                                  ? voice.stopSpeaking()
                                  : voice.read(spoken)
                    }
                    aria-label={
                      voice.speaking
                        ? "Stop reading decision"
                        : "Read decision aloud"
                    }
                  >
                    {voice.speaking ? (
                      <Square size={16} />
                    ) : (
                      <Volume2 size={16} />
                    )}
                  </button>
                </div>
                <h2>{entry.title}</h2>
                <p className="decision-log-outcome">
                  {DECISION_LABEL[entry.outcome]}
                </p>
                {entry.note && (
                  <p className="decision-log-note">{entry.note}</p>
                )}
              </article>
            );
          })}
        </div>
                </AccordionSection>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
