import { useRef } from "react";
import { Plus } from "lucide-react";

const HOLD_MS = 450;

/** The one capture button: tap to type, hold to speak to Steadier. */
export default function CaptureHoldButton({ onTap, onHold, className = "v2-floating-capture" }: { onTap: () => void; onHold: () => void; className?: string }) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className={className}
      aria-label="Capture: tap to type, hold to speak"
      title="Tap to type · hold to speak"
      onPointerDown={() => {
        held.current = false;
        clear();
        timer.current = window.setTimeout(() => {
          held.current = true;
          try {
            navigator.vibrate?.(20);
          } catch {
            /* no vibration */
          }
          onHold();
        }, HOLD_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={event => event.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onTap();
      }}
    >
      <Plus size={23} aria-hidden="true" />
    </button>
  );
}
