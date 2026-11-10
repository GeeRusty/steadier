import React, { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Presentation-only state survives temporary filtering/unmounting in this tab.
const openStateCache = new Map<string, boolean>();

interface Props {
  title: string;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Change to a non-empty search token to reveal this section; clearing it never closes the section. */
  revealToken?: string;
  className?: string;
  persistenceKey?: string;
  collapsible?: boolean;
  autoOpen?: boolean;
}

export default function AccordionSection({
  title,
  count,
  children,
  defaultOpen = false,
  revealToken = "",
  className = "",
  persistenceKey = "",
  collapsible = true,
  autoOpen = false,
}: Props) {
  const contentId = useId();
  const triggerId = useId();
  const stateKey = `steadier-accordion:${className}:${persistenceKey || title}`;
  const [open, setOpen] = useState(() => {
    const saved = openStateCache.get(stateKey);
    if (autoOpen) {
      openStateCache.set(stateKey, true);
      return true;
    }
    if (saved !== undefined) return saved;
    const initial = defaultOpen || Boolean(revealToken.trim());
    openStateCache.set(stateKey, initial);
    return initial;
  });

  useEffect(() => {
    if (collapsible && (revealToken.trim() || autoOpen)) {
      openStateCache.set(stateKey, true);
      setOpen(true);
    }
  }, [autoOpen, collapsible, revealToken, stateKey]);

  if (!collapsible) {
    return (
      <section
        className={`accordion-section accordion-section-static ${className}`.trim()}
      >
        <h2 className="accordion-static-heading">
          <span>{title}</span>
          <span className="accordion-count">
            {count} {count === 1 ? "item" : "items"}
          </span>
        </h2>
        <div className="accordion-panel">
          {count === 0 ? (
            <p className="small muted accordion-empty">
              No items in this section.
            </p>
          ) : (
            children
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`accordion-section ${className}`.trim()}>
      <h2 className="accordion-heading">
        <button
          className="accordion-trigger"
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() =>
            setOpen(value => {
              const next = !value;
              openStateCache.set(stateKey, next);
              return next;
            })
          }
        >
          <span className="accordion-title">{title}</span>
          <span className="accordion-count">
            {count} {count === 1 ? "item" : "items"}
          </span>
          <ChevronDown
            className="accordion-chevron"
            size={18}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div
        className="accordion-panel"
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
      >
        {count === 0 ? (
          <p className="small muted accordion-empty">
            No items in this section.
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
