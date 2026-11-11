import React from "react";
import { cardDots, DOT_LABEL, type CardDot } from "../../domain/taskCard";
import type { Task } from "../../domain/types";

/** Three small dots (Action, Place, First step). Lit = done. */
export default function CardDotsMark({ task, tasks, showLabels = false }: { task: Task; tasks: Task[]; showLabels?: boolean }) {
  const dots = cardDots(task, tasks);
  const keys = Object.keys(dots) as CardDot[];
  const lit = keys.filter(key => dots[key]).length;
  return (
    <span
      className={`card-dots${showLabels ? " card-dots--labelled" : ""}`}
      role="img"
      aria-label={`${lit} of 3 set: ${keys.map(key => `${DOT_LABEL[key]} ${dots[key] ? "done" : "to do"}`).join(", ")}`}
    >
      {keys.map(key => (
        <span key={key} className={`card-dot${dots[key] ? " is-lit" : ""}`} aria-hidden="true">
          {showLabels && <span className="card-dot-label">{DOT_LABEL[key]}</span>}
        </span>
      ))}
    </span>
  );
}
