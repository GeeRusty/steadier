import React from "react";
import { Menu, X } from "lucide-react";

interface Props {
  expanded: boolean;
  onToggle: () => void;
}

export default function MyLifeNavigationButton({ expanded, onToggle }: Props) {
  return (
    <button
      type="button"
      className="icon-button menu-button my-life-menu-button"
      aria-label={expanded ? "Close My Life navigation" : "Open My Life navigation"}
      aria-expanded={expanded}
      aria-controls="my-life-navigation"
      title="Open all Steadier pages"
      onClick={onToggle}
    >
      {expanded ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
      <span>My Life</span>
    </button>
  );
}
