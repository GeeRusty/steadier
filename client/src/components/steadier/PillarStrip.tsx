import { Plus, Volume2 } from "lucide-react";
import { useMemo } from "react";
import {
  HEALTH_WORD,
  PILLAR_SLOTS,
  pillarStrip,
  spokenStrip,
  stripCaption,
  type PillarHealth,
} from "../../domain/pillarStrip";
import type { Workspace } from "../../domain/types";

const GLYPH: Record<PillarHealth, string> = {
  green: "✓",
  amber: "•",
  red: "!",
};

/**
 * Eight Pillar slots in a row. Each is steady (green), needs a look (amber),
 * gone quiet (red) or empty (dashed). A state is always a shape as well as a
 * colour. Tapping a Pillar opens its page; tapping a free slot adds one.
 * A gentle read of the saved map: never a score, never blocks anything.
 */
export function PillarStrip({
  workspace,
  today,
  compact = false,
  todayV2 = false,
  readOnly,
  onOpenGoal,
  onAddPillar,
  onOpenMap,
  onRead,
}: {
  workspace: Workspace;
  today: string;
  /** Today's slim version: only the Pillars you have, plus one free slot. */
  compact?: boolean;
  /** Today V2 uses the same live slots and handlers with the supplied pill style. */
  todayV2?: boolean;
  readOnly: boolean;
  onOpenGoal: (id: string) => void;
  onAddPillar: () => void;
  onOpenMap: () => void;
  onRead?: (text: string) => void;
}) {
  const strip = useMemo(
    () => pillarStrip(workspace, today),
    [workspace, today]
  );
  const have = strip.slots.filter(s => s.kind === "pillar").length;
  // Today stays quiet until there is something to show.
  if (compact && have === 0) return null;
  const firstFree = strip.slots.findIndex(s => s.kind === "empty");

  return (
    <section
      className={`pillar-strip${compact ? " is-compact" : ""}${todayV2 ? " is-today-v2" : ""}`}
      aria-label="Your Pillars"
    >
      <ul className="pillar-slots">
        {strip.slots.map((slot, i) => {
          if (slot.kind === "pillar") {
            const g = slot.goal;
            const label = todayV2
              ? `${g.title}: set, ${HEALTH_WORD[slot.health].toLowerCase()}${
                  slot.reasons.length ? `. ${slot.reasons[0]}` : ""
                }. Open this Pillar.`
              : `${g.title}: ${HEALTH_WORD[slot.health].toLowerCase()}${
                  slot.reasons.length ? `. ${slot.reasons[0]}` : ""
                }. Open this Pillar.`;
            return (
              <li key={g.id}>
                <button
                  className={`pillar-slot ${todayV2 ? `v2-set v2-health-${slot.health}` : slot.health}`}
                  onClick={() => onOpenGoal(g.id)}
                  aria-label={label}
                  title={`${g.title} · ${HEALTH_WORD[slot.health]}`}
                >
                  <span className="pillar-glyph" aria-hidden>
                    {todayV2 ? "✓" : GLYPH[slot.health]}
                  </span>
                  <span
                    className={`pillar-name${
                      g.title.split(/\s+/).some(w => w.length >= 8)
                        ? " long"
                        : ""
                    }`}
                  >
                    {g.title}
                  </span>
                  {todayV2 && (
                    <span
                      className={`pillar-health-indicator ${slot.health}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          }
          // A free slot. On Today only the next one is offered.
          if (compact && i !== firstFree)
            return <li key={`e${i}`} aria-hidden className="pillar-gap" />;
          return (
            <li key={`e${i}`}>
              <button
                className={`pillar-slot empty${todayV2 ? " v2-unset" : ""}`}
                disabled={readOnly}
                onClick={onAddPillar}
                aria-label="Free Pillar slot. Add a Pillar."
              >
                {!todayV2 && <span className="pillar-glyph" aria-hidden>
                  <Plus size={16} />
                </span>}
                <span className="pillar-name">{todayV2 ? "Unset" : compact ? "Add" : "Free"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!todayV2 && <div className="pillar-caption-row">
        <p className="pillar-caption">
          {stripCaption(strip)}
          {strip.overflow.length > 0 && (
            <>
              {" "}
              <button className="text-button" onClick={onOpenMap}>
                +{strip.overflow.length} more Pillar
                {strip.overflow.length === 1 ? "" : "s"} on the map
              </button>
            </>
          )}
        </p>
        {onRead && (
          <button
            className="text-button"
            onClick={() => onRead(spokenStrip(strip))}
          >
            <Volume2 size={15} /> Read Pillars
          </button>
        )}
      </div>}
      {!compact && !todayV2 && (
        <p className="pillar-legend small muted">
          <span className="lg green">✓</span> steady ·{" "}
          <span className="lg amber">•</span> needs a look ·{" "}
          <span className="lg red">!</span> gone quiet · dashed = free slot (
          {PILLAR_SLOTS} in the row). A gentle read of your map, never a score.
        </p>
      )}
    </section>
  );
}
