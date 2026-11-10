import React from "react";

export type TodayView = "today" | "overview";

interface Props {
  value: TodayView;
  onChange: (value: TodayView) => void;
}

export default function TodayViewSwitch({ value, onChange }: Props) {
  return (
    <div className="v2-today-view-switch" role="group" aria-label="Today or Overview">
      <button
        type="button"
        aria-pressed={value === "today"}
        onClick={() => onChange("today")}
      >
        Today
      </button>
      <button
        type="button"
        aria-pressed={value === "overview"}
        onClick={() => onChange("overview")}
      >
        Overview
      </button>
    </div>
  );
}
