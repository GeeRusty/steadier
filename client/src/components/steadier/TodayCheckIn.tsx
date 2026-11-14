import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { Workspace } from "../../domain/types";
import {
  commandCentreSnapshot,
  commandCentreWorkspaceKey,
  type CommandCentreMode,
  type CommandCentreQuestion,
} from "../../domain/commandCentre";
import { useNow } from "../../hooks/useNow";

/** Answer handlers keep the existing safety checks: refresh first, refuse if the item changed. */
type Answer = (id: string, expectedUpdatedAt: string, expectedRevision: number) => Promise<boolean> | boolean;

interface Props {
  workspace: Workspace;
  revision: number;
  readOnly: boolean;
  onOpenTask: Answer;
  onCompleteTask: Answer;
  onOpenProject: Answer;
  onOpenImperative: Answer;
  /** For tests: a fixed time. */
  now?: Date;
}

/** Same key the Command Centre used, so answers already given today still count. */
const ANSWERS_KEY = "steadier.commandCentre.answers.v1";
const LATER_KEY = "steadier.checkIn.later.v1";

function readIds(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.ids)
      ? parsed.ids.filter((id: unknown): id is string => typeof id === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}

function readFlag(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

const TITLE: Partial<Record<CommandCentreMode, string>> = {
  "weekday-morning": "Morning check-in",
  "weekday-evening": "Evening check-in",
};

function openLabel(question: CommandCentreQuestion): string {
  if (question.kind === "placement") return "Choose placement";
  if (question.itemKind === "project") return "Review project";
  if (question.itemKind === "imperative") return "Open Imperative";
  return "Review task";
}

/**
 * The weekday check-in: one line above Now, only when a question is set.
 * Tap to answer. Answered or "Later", it folds away until the next check-in
 * (morning 08:00, evening 17:00, Adelaide). It is a question, never a count.
 */
export default function TodayCheckIn(p: Props) {
  const liveNow = useNow(60_000);
  const now = p.now ?? liveNow;
  const snapshot = useMemo(() => commandCentreSnapshot(p.workspace, now), [p.workspace, now]);
  const wsKey = commandCentreWorkspaceKey(p.workspace);
  const answersKey = `${ANSWERS_KEY}:${snapshot.today}:${wsKey}`;
  const laterKey = `${LATER_KEY}:${snapshot.today}:${snapshot.mode}:${wsKey}`;
  const [answered, setAnswered] = useState(() => readIds(answersKey));
  const [later, setLater] = useState(() => readFlag(laterKey));
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  // A new day or a new check-in window starts fresh.
  useEffect(() => setAnswered(readIds(answersKey)), [answersKey]);
  useEffect(() => {
    setLater(readFlag(laterKey));
    setOpen(false);
  }, [laterKey]);

  const questions = snapshot.questions.filter(q => !answered.includes(q.id));
  const title = TITLE[snapshot.mode];
  if (!title || later || questions.length === 0) return null;

  const acknowledge = (id: string) => {
    const next = [...new Set([...readIds(answersKey), id])].slice(-100);
    try {
      globalThis.localStorage?.setItem(answersKey, JSON.stringify({ ids: next }));
    } catch {
      /* A convenience only; the item itself is unchanged. */
    }
    setAnswered(next);
  };
  const foldUntilNext = () => {
    try {
      globalThis.localStorage?.setItem(laterKey, "1");
    } catch {
      /* Without storage the line simply stays. */
    }
    setLater(true);
  };
  const act = async (question: CommandCentreQuestion, run: () => Promise<boolean> | boolean) => {
    if (working) return;
    setWorking(question.id);
    try {
      if (await run()) acknowledge(question.id);
    } finally {
      setWorking(null);
    }
  };
  const openItem = (q: CommandCentreQuestion) =>
    q.itemKind === "task"
      ? p.onOpenTask(q.itemId, q.updatedAt, p.revision)
      : q.itemKind === "project"
        ? p.onOpenProject(q.itemId, q.updatedAt, p.revision)
        : p.onOpenImperative(q.itemId, q.updatedAt, p.revision);

  if (!open) {
    return (
      <button
        type="button"
        className="tp-checkin-line"
        aria-expanded="false"
        aria-controls="today-checkin"
        onClick={() => setOpen(true)}
      >
        <span className="tp-checkin-tag">Check-in</span>
        <span className="tp-checkin-text">{questions[0].question}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section id="today-checkin" className="tp-checkin" aria-label={title}>
      <div className="tp-checkin-head">
        <button
          type="button"
          className="tp-checkin-title"
          aria-expanded="true"
          aria-controls="today-checkin"
          onClick={() => setOpen(false)}
        >
          {title} <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tp-checkin-later" onClick={foldUntilNext}>
          Later
        </button>
      </div>
      <ul className="tp-checkin-list">
        {questions.map(q => (
          <li key={q.id} className="tp-checkin-item">
            <strong>{q.question}</strong>
            <span className="tp-chip">{q.detail}</span>
            <span className="tp-checkin-actions">
              {q.kind === "commitment" ? (
                <>
                  <button
                    type="button"
                    className="tp-btn tp-btn-primary"
                    disabled={p.readOnly || working !== null}
                    onClick={() => void act(q, () => p.onCompleteTask(q.itemId, q.updatedAt, p.revision))}
                  >
                    <Check size={16} aria-hidden="true" /> Mark done
                  </button>
                  <button
                    type="button"
                    className="tp-btn"
                    disabled={working !== null}
                    onClick={() => void act(q, () => openItem(q))}
                  >
                    Change plan
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="tp-btn"
                  disabled={working !== null || (p.readOnly && q.itemKind === "task")}
                  onClick={() => void act(q, () => openItem(q))}
                >
                  {openLabel(q)}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
