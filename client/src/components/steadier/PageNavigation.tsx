import React from "react";
import { BookOpen, ExternalLink, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { View } from "../../domain/types";
import { groupPageNavigation } from "../../domain/pageNavigation";
import { COMPASS_LIBRARY_LINKS } from "../../domain/compassLibrary";

export interface PageNavigationItem {
  id: View;
  title: string;
  Icon: LucideIcon;
}

interface Props {
  items: readonly PageNavigationItem[];
  active: View;
  outstandingCount: number;
  reviewCount: number;
  onNavigate: (view: View) => void;
  onSpeakTask: () => void;
}

export default function PageNavigation({
  items,
  active,
  outstandingCount,
  reviewCount,
  onNavigate,
  onSpeakTask,
}: Props) {
  const groups = groupPageNavigation(items);

  return (
    <div
      className="sidebar-navigation-scroll"
      role="region"
      aria-label="My Life menu content"
      tabIndex={0}
    >
      <p className="sidebar-nav-hint">
        All page links are listed below. Swipe or scroll to browse.
      </p>
      <button
        type="button"
        className="sidebar-voice-action"
        aria-label="Speak a task; voice starts only after this tap"
        onClick={onSpeakTask}
      >
        <Mic size={18} aria-hidden="true" />
        <span>Speak a task</span>
      </button>
      <p className="sidebar-voice-hint">
        Voice is opt-in. Review the draft and save it yourself.
      </p>
      <nav className="sidebar-navigation" aria-label="All Steadier pages">
        {groups.map(group => (
          <React.Fragment key={group.title}>
          <section className="sidebar-nav-group">
            <h2 className="sidebar-nav-heading">{group.title}</h2>
            <div className="sidebar-nav-items">
              {group.items.map(({ id, title, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`nav-item ${active === id ? "active" : ""}`}
                  aria-current={active === id ? "page" : undefined}
                  onClick={() => onNavigate(id)}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{title}</span>
                  {id === "all" && (
                    <span className="nav-count" aria-label={`${outstandingCount} open tasks`}>
                      {outstandingCount}
                    </span>
                  )}
                  {id === "review" && reviewCount > 0 && (
                    <span
                      className="nav-count nav-review-count"
                      aria-label={`${reviewCount} items ready for review`}
                    >
                      {reviewCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
          {group.title === "Imperatives" && <CompassLibrary />}
          </React.Fragment>
        ))}
        {!groups.some(group => group.title === "Imperatives") && <CompassLibrary />}
      </nav>
    </div>
  );
}

/** Reference links (Notion for now; server library links when Notion retires). Open in a new tab. */
function CompassLibrary() {
  return (
    <section className="sidebar-nav-group" aria-label="Compass Library">
      <h2 className="sidebar-nav-heading">Compass Library</h2>
      <div className="sidebar-nav-items">
        {COMPASS_LIBRARY_LINKS.map(link => (
          <a
            key={link.label}
            className="nav-item"
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            <BookOpen size={19} aria-hidden="true" />
            <span>{link.label}</span>
            <ExternalLink size={14} aria-hidden="true" className="nav-external" />
          </a>
        ))}
      </div>
    </section>
  );
}
