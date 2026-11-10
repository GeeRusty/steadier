import React from "react";
import { Moon, Sun } from "lucide-react";
import type { Appearance } from "../../domain/appearance";

type Props = {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
};

export default function AppearanceToggle({ appearance, onChange }: Props) {
  return (
    <div className="appearance-toggle" role="group" aria-label="Appearance">
      <button
        type="button"
        className="appearance-toggle-option"
        aria-label="Light appearance"
        aria-pressed={appearance === "light"}
        onClick={() => onChange("light")}
      >
        <Sun size={17} aria-hidden="true" />
        <span>Light</span>
      </button>
      <button
        type="button"
        className="appearance-toggle-option"
        aria-label="Dark appearance"
        aria-pressed={appearance === "dark"}
        onClick={() => onChange("dark")}
      >
        <Moon size={17} aria-hidden="true" />
        <span>Dark</span>
      </button>
    </div>
  );
}
