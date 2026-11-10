import React, { useId, useState } from "react";

const ADD_AREA = "__steadier_add_life_area__";

interface Props {
  areas: string[];
  value: string;
  onChange: (area: string) => void;
}

export function lifeAreaOptions(areas: string[], current: string): string[] {
  return [...new Set([...areas, current].filter(area => area.trim().length > 0))];
}

export default function LifeAreaPicker({ areas, value, onChange }: Props) {
  const id = useId();
  const [addingArea, setAddingArea] = useState(false);
  const [newArea, setNewArea] = useState("");
  const [previousArea, setPreviousArea] = useState(value);
  const options = lifeAreaOptions(areas, value);

  return (
    <div className="field">
      <label htmlFor={`${id}-select`}>Life area</label>
      <select
        id={`${id}-select`}
        aria-label="Life area"
        value={addingArea ? ADD_AREA : value}
        onChange={event => {
          const selected = event.target.value;
          if (selected === ADD_AREA) {
            setPreviousArea(value);
            setNewArea("");
            setAddingArea(true);
            return;
          }
          setAddingArea(false);
          setNewArea("");
          if (selected) onChange(selected);
        }}
      >
        {!value && (
          <option value="" disabled>
            Choose a life area
          </option>
        )}
        {options.map(area => (
          <option key={area} value={area}>
            {area}
          </option>
        ))}
        <option value={ADD_AREA}>Add a new life area…</option>
      </select>
      {addingArea && (
        <>
          <label htmlFor={`${id}-new`} className="small muted">
            New life area
          </label>
          <input
            id={`${id}-new`}
            aria-label="New life area"
            type="text"
            value={newArea}
            maxLength={80}
            autoComplete="off"
            placeholder="Type a new life area"
            onChange={event => {
              const next = event.target.value.slice(0, 80);
              setNewArea(next);
              onChange(next.trim() ? next : previousArea);
            }}
          />
        </>
      )}
    </div>
  );
}
