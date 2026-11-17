import React, { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import type { Workspace } from "../../domain/types";
import { notificationSettings, setNotificationSettings } from "../../domain/notifications";
import { pushState, sendTest, turnOff, turnOn, type PushState } from "../../lib/push";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  onMutate: (update: (w: Workspace) => Workspace) => boolean | void;
  onClose: () => void;
}

export const NOTIFICATIONS_INFO =
  "Phone notifications reach you when Steadier is closed. Only two kinds: a task's own reminders, and leave by for a place with an Allow to get there time. Nothing else is ever sent. A reminder in quiet hours is dropped, not held. Each message is encrypted before it leaves the server.";

const STATE_TEXT: Record<PushState, string> = {
  unsupported: "This browser can't receive notifications.",
  blocked: "Blocked for Steadier in the phone's settings.",
  off: "Off on this phone.",
  on: "On for this phone.",
};

/** ⋮ › Notifications: this phone on or off, the two kinds, quiet hours and Send a test. */
export default function NotificationsSheet({ workspace, readOnly, onMutate, onClose }: Props) {
  const titleId = useId();
  const settings = notificationSettings(workspace);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void pushState().then(setState);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setState(await pushState());
      setBusy(false);
    }
  };
  const change = (patch: Parameters<typeof setNotificationSettings>[1]) => {
    if (readOnly) return;
    if (onMutate(w => setNotificationSettings(w, patch)) === false) setMessage("That wasn't saved. Check sync and try again.");
  };

  return (
    <div className="v2-menu-overlay v2-menu-page">
      <button type="button" className="v2-menu-scrim" aria-label="Close Notifications" onClick={onClose} />
      <section className="v2-menu-sheet nt-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="v2-menu-heading">
          <h2 id={titleId}>Notifications</h2>
          <button type="button" className="v2-menu-close" onClick={onClose} aria-label="Close menu">
            <X size={18} aria-hidden="true" /> Close
          </button>
        </header>
        <p className="lv-meta nt-info">{NOTIFICATIONS_INFO}</p>

        <div className="nt-row">
          <span>{state ? STATE_TEXT[state] : "Checking this phone…"}</span>
          {state === "on" ? (
            <button type="button" className="tp-btn" disabled={busy} onClick={() => void act(async () => (await turnOff(), "Turned off for this phone."))}>
              Turn off
            </button>
          ) : state === "off" ? (
            <button type="button" className="tp-btn tp-btn-primary" disabled={busy} onClick={() => void act(async () => (await turnOn(), "Turned on for this phone."))}>
              Turn on
            </button>
          ) : null}
        </div>

        <label className="nt-row">
          <span>Task reminders</span>
          <input type="checkbox" checked={settings.taskReminders} disabled={readOnly} onChange={e => change({ taskReminders: e.target.checked })} />
        </label>
        <label className="nt-row">
          <span>Leave by</span>
          <input type="checkbox" checked={settings.leaveBy} disabled={readOnly} onChange={e => change({ leaveBy: e.target.checked })} />
        </label>
        <label className="nt-row">
          <span>Quiet hours</span>
          <input type="checkbox" checked={settings.quietHours.on} disabled={readOnly} onChange={e => change({ quietHours: { ...settings.quietHours, on: e.target.checked } })} />
        </label>
        {settings.quietHours.on && (
          <div className="nt-row nt-times">
            <label>
              From
              <input type="time" value={settings.quietHours.from} disabled={readOnly} onChange={e => e.target.value && change({ quietHours: { ...settings.quietHours, from: e.target.value } })} />
            </label>
            <label>
              To
              <input type="time" value={settings.quietHours.to} disabled={readOnly} onChange={e => e.target.value && change({ quietHours: { ...settings.quietHours, to: e.target.value } })} />
            </label>
          </div>
        )}

        <div className="nt-row">
          <button
            type="button"
            className="tp-btn"
            disabled={busy || state !== "on"}
            onClick={() =>
              void act(async () => {
                const { sent, failed } = await sendTest();
                if (!sent) return "No phone received it. Turn on for this phone first.";
                return `Sent to ${sent} phone${sent === 1 ? "" : "s"}${failed ? ` (${failed} didn't take it)` : ""}. It should arrive in a few seconds.`;
              })
            }
          >
            Send a test
          </button>
        </div>
        {message && (
          <p className="lv-meta" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
