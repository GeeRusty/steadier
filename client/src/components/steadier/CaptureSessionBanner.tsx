import React, { useState } from "react";
import type { Project } from "../../domain/types";

/**
 * "Capturing to Kingston · End": one plain grey line on every page while a
 * session is on. No colour, no count, no timer. Tapping the project name
 * switches the session to another project.
 */
export default function CaptureSessionBanner({
  project,
  projects,
  onEnd,
  onSwitch,
}: {
  project: Project;
  projects: Project[];
  onEnd: () => void;
  onSwitch: (projectId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const others = projects.filter(p => p.status === "active" && p.id !== project.id);
  return (
    <div className="capture-session" role="status" aria-live="polite">
      {picking ? (
        <label className="capture-session-text">
          <span className="sr-only">Capture to</span>
          <select
            autoFocus
            aria-label="Capture to another project"
            value=""
            onChange={e => {
              setPicking(false);
              if (e.target.value) onSwitch(e.target.value);
            }}
            onBlur={() => setPicking(false)}
          >
            <option value="">Capture to…</option>
            {others.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="capture-session-text">
          Capturing to{" "}
          <button
            type="button"
            className="capture-session-project"
            aria-label={`Capturing to ${project.title}. Choose another project`}
            disabled={!others.length}
            onClick={() => setPicking(true)}
          >
            {project.title}
          </button>
        </span>
      )}
      <button type="button" className="capture-session-end" onClick={onEnd}>
        End
      </button>
    </div>
  );
}
