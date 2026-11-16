import React, { useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUpRight, Circle, Pencil, Type, Undo2 } from "lucide-react";
import { MARKUP_INK, MAX_MARKUP_SHAPES, MAX_MARKUP_TEXT, MAX_PEN_POINTS, type MarkupShape, type TaskPhoto } from "../../domain/photos";
import { photoUrl } from "../../lib/photoUpload";

const VIEW_W = 1000;

/**
 * A full-screen dark layer for photos. It is its own (nested) dialog, so it
 * works on top of the task sheet.
 */
export function PhotoLayer({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open onOpenChange={open => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content className="ph-viewer" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The drawing, laid over a photo. One ink (yellow), so red stays for real risk. */
export function MarkupLayer({ shapes, width, height }: { shapes: MarkupShape[]; width: number; height: number }) {
  const h = Math.round((VIEW_W * height) / width);
  const stroke = Math.max(6, VIEW_W / 140);
  return (
    <svg className="ph-markup" viewBox={`0 0 ${VIEW_W} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {shapes.map((shape, i) => {
        if (shape.kind === "circle") {
          const cx = ((shape.x1 + shape.x2) / 2) * VIEW_W;
          const cy = ((shape.y1 + shape.y2) / 2) * h;
          return <ellipse key={i} cx={cx} cy={cy} rx={(Math.abs(shape.x2 - shape.x1) / 2) * VIEW_W} ry={(Math.abs(shape.y2 - shape.y1) / 2) * h} fill="none" stroke={MARKUP_INK} strokeWidth={stroke} />;
        }
        if (shape.kind === "arrow") {
          const x1 = shape.x1 * VIEW_W, y1 = shape.y1 * h, x2 = shape.x2 * VIEW_W, y2 = shape.y2 * h;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = stroke * 5;
          const a1 = angle + Math.PI * 0.82, a2 = angle - Math.PI * 0.82;
          return (
            <g key={i} stroke={MARKUP_INK} strokeWidth={stroke} strokeLinecap="round" fill="none">
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <polyline points={`${x2 + Math.cos(a1) * head},${y2 + Math.sin(a1) * head} ${x2},${y2} ${x2 + Math.cos(a2) * head},${y2 + Math.sin(a2) * head}`} />
            </g>
          );
        }
        if (shape.kind === "pen") {
          const points: string[] = [];
          for (let p = 0; p + 1 < shape.points.length; p += 2) points.push(`${shape.points[p] * VIEW_W},${shape.points[p + 1] * h}`);
          return <polyline key={i} points={points.join(" ")} fill="none" stroke={MARKUP_INK} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />;
        }
        if (shape.kind !== "text") return null;
        const size = VIEW_W / 22;
        return (
          <g key={i}>
            <rect x={shape.x * VIEW_W - size * 0.3} y={shape.y * h - size * 1.05} width={shape.text.length * size * 0.56 + size * 0.6} height={size * 1.4} rx={size * 0.2} fill="#1C1C1A" />
            <text x={shape.x * VIEW_W} y={shape.y * h} fill={MARKUP_INK} fontSize={size} fontWeight={600} fontFamily="Inter, system-ui, sans-serif">
              {shape.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Draw the markup into a copy of the photo (for Download and Share). */
export async function burnMarkup(photo: TaskPhoto): Promise<Blob> {
  const response = await fetch(photoUrl(photo.hash), { credentials: "include" });
  if (!response.ok) throw new Error("This photo is no longer stored.");
  const source = await response.blob();
  if (!photo.markup.length) return source;
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't make the copy.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const svg = renderToStaticMarkup(<MarkupLayer shapes={photo.markup} width={photo.width} height={photo.height} />)
    .replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"`);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The markup couldn't be drawn."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("Couldn't make the copy."))), "image/jpeg", 0.9)
  );
}

type Tool = "arrow" | "circle" | "pen" | "text";

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: "arrow", label: "Arrow", icon: <ArrowUpRight size={22} aria-hidden="true" /> },
  { tool: "circle", label: "Circle", icon: <Circle size={22} aria-hidden="true" /> },
  { tool: "pen", label: "Pen", icon: <Pencil size={22} aria-hidden="true" /> },
  { tool: "text", label: "Text", icon: <Type size={22} aria-hidden="true" /> },
];

/** Mark up: the original photo is never changed; the drawing is saved beside it. */
export default function PhotoMarkup({
  photo,
  onSave,
  onCancel,
}: {
  photo: TaskPhoto;
  onSave: (shapes: MarkupShape[]) => void;
  onCancel: () => void;
}) {
  const [shapes, setShapes] = useState<MarkupShape[]>(photo.markup);
  const [tool, setTool] = useState<Tool>("arrow");
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const area = useRef<HTMLDivElement>(null);
  const full = shapes.length >= MAX_MARKUP_SHAPES;

  const point = (event: React.PointerEvent) => {
    const box = area.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };
  const down = (event: React.PointerEvent) => {
    if (full) return;
    const p = point(event);
    if (tool === "text") {
      setTextAt(p);
      setText("");
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDraft(tool === "pen" ? { kind: "pen", points: [p.x, p.y] } : { kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };
  const move = (event: React.PointerEvent) => {
    if (!draft) return;
    const p = point(event);
    if (draft.kind === "pen") {
      if (draft.points.length / 2 >= MAX_PEN_POINTS) return;
      const lx = draft.points[draft.points.length - 2], ly = draft.points[draft.points.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) < 0.004) return;
      setDraft({ ...draft, points: [...draft.points, p.x, p.y] });
    } else if (draft.kind === "arrow" || draft.kind === "circle") {
      setDraft({ ...draft, x2: p.x, y2: p.y });
    }
  };
  const up = () => {
    if (!draft) return;
    const big =
      draft.kind === "pen"
        ? draft.points.length >= 4
        : draft.kind !== "text" && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 0.02;
    if (big) setShapes(list => [...list, draft]);
    setDraft(null);
  };
  const addText = (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim().slice(0, MAX_MARKUP_TEXT);
    if (value && textAt) setShapes(list => [...list, { kind: "text", x: textAt.x, y: textAt.y, text: value }]);
    setTextAt(null);
    setText("");
  };
  const shown = draft ? [...shapes, draft] : shapes;

  return (
    <PhotoLayer label="Mark up photo" onClose={onCancel}>
      <div className="ph-vbar">
        <button type="button" className="ph-vbtn" onClick={onCancel}>Cancel</button>
        <span className="ph-vtitle">Mark up</span>
        <button type="button" className="ph-vbtn ph-strong" onClick={() => onSave(shapes)}>Save</button>
      </div>
      <div className="ph-stage">
        <div
          ref={area}
          className="ph-frame ph-drawing"
          style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <img src={photoUrl(photo.hash)} alt="" draggable={false} />
          <MarkupLayer shapes={shown} width={photo.width} height={photo.height} />
        </div>
      </div>
      {textAt ? (
        <form className="ph-textrow" onSubmit={addText}>
          <label className="sr-only" htmlFor="ph-markup-text">Text on the photo</label>
          <input id="ph-markup-text" autoFocus value={text} maxLength={MAX_MARKUP_TEXT} onChange={e => setText(e.target.value)} placeholder="e.g. this washer" />
          <button type="submit" className="tp-btn tp-btn-primary">Add</button>
          <button type="button" className="tp-btn" onClick={() => setTextAt(null)}>Cancel</button>
        </form>
      ) : (
        <div className="ph-tools" role="group" aria-label="Markup tools">
          {TOOLS.map(item => (
            <button key={item.tool} type="button" className={`ph-tool${tool === item.tool ? " is-on" : ""}`} aria-pressed={tool === item.tool} onClick={() => setTool(item.tool)}>
              {item.icon}
              <small>{item.label}</small>
            </button>
          ))}
          <button type="button" className="ph-tool" disabled={!shapes.length} onClick={() => setShapes(list => list.slice(0, -1))}>
            <Undo2 size={22} aria-hidden="true" />
            <small>Undo</small>
          </button>
        </div>
      )}
      <p className="ph-vnote">
        {full ? "That's the most marks one photo can hold." : tool === "text" ? "Tap where the words should go." : "Draw on the photo. The original isn't changed."}
      </p>
    </PhotoLayer>
  );
}
