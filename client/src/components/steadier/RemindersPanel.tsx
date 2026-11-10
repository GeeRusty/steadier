import { useEffect, useState } from "react";
import {
  Bell,
  CalendarPlus,
  ClipboardCopy,
  Square,
  Volume2,
} from "lucide-react";
import type { useSharedWorkspace } from "../../hooks/useSharedWorkspace";
import { copyPrivate, privateOwnerJSON } from "../../lib/cloudApi";
import {
  playTone,
  readToneSettings,
  unlockTones,
  writeToneSettings,
  type ToneSettings,
} from "../../lib/tones";
import { formatAdelaide } from "../../../../shared/time";

type Store = ReturnType<typeof useSharedWorkspace>;
type Voice = {
  speechSupported: boolean;
  speaking: boolean;
  read: (text: string) => void;
  stopSpeaking: () => void;
};
type FeedStatus = {
  active: boolean;
  hideTitles: boolean;
  createdAt: string | null;
  lastFetchedAt: string | null;
};

const CALENDAR_STEPS =
  "To get calendar alarms on your phone: first tap Create calendar link, then Add to Google Calendar. If Google asks, choose Add. If the link does not open on your phone, copy the link, open calendar.google.com in a browser, choose Other calendars, plus, From URL, and paste it. Then, in the Google Calendar app on your phone, open Settings, choose Steadier My Life, and set the default notification for events to at time of event, so every Steadier reminder rings on time. Google refreshes subscribed calendars on its own schedule, usually within a few hours, so a date you add today may take a while to appear.";

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="check-line tone-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint && <small className="muted"> — {hint}</small>}
      </span>
    </label>
  );
}

export default function RemindersPanel({
  store,
  voice,
}: {
  store: Store;
  voice: Voice;
}) {
  const [tones, setTones] = useState<ToneSettings>(() => readToneSettings());
  const [toneNote, setToneNote] = useState("");
  const c = store.cloud;
  const owner = c.user?.id ?? 0;
  const [feed, setFeed] = useState<FeedStatus | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [hideTitles, setHideTitles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!c.active || !owner) return;
    let alive = true;
    privateOwnerJSON<FeedStatus>(owner, "/api/steadier/calendar-feed")
      .then(status => {
        if (!alive) return;
        setFeed(status);
        setHideTitles(status.hideTitles);
      })
      .catch(
        e =>
          alive &&
          setError(
            e instanceof Error ? e.message : "Calendar status could not load."
          )
      );
    return () => {
      alive = false;
    };
  }, [c.active, owner]);

  function updateTones(patch: Partial<ToneSettings>) {
    const next = { ...tones, ...patch };
    setTones(next);
    setToneNote(
      writeToneSettings(next)
        ? ""
        : "This browser could not save the sound setting."
    );
  }

  function testTone() {
    unlockTones();
    const played = playTone("end", { ...tones, enabled: true });
    if (!played)
      setToneNote("This browser cannot play sounds. Vibration may still work.");
    if (tones.speak && voice.speechSupported) {
      window.setTimeout(
        () => voice.read("Focus time is up. This is how Steadier will sound."),
        1800
      );
    }
  }

  const [notifyState, setNotifyState] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission
  );
  async function askNotify() {
    try {
      setNotifyState(await Notification.requestPermission());
    } catch {
      setNotifyState("denied");
    }
  }
  function testReminder() {
    unlockTones();
    const played = playTone("reminder", { ...tones, enabled: true });
    if (!played)
      setToneNote("This browser cannot play sounds. Vibration may still work.");
    if (tones.speak && voice.speechSupported) {
      window.setTimeout(
        () => voice.read("Reminder: Call Sam. Starts at 3 p.m."),
        2400
      );
    }
  }
  async function createLink() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await privateOwnerJSON<{
        url: string;
        status: FeedStatus;
      }>(owner, "/api/steadier/calendar-feed", {
        method: "POST",
        body: JSON.stringify({ hideTitles }),
      });
      setFeedUrl(result.url);
      setFeed(result.status);
      setMessage(
        feed?.active
          ? "New link created. The old link has stopped working; replace it in your calendar."
          : "Calendar link created. Now tap Add to Google Calendar."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The link could not be created."
      );
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await privateOwnerJSON(owner, "/api/steadier/calendar-feed", {
        method: "DELETE",
      });
      setFeed({
        active: false,
        hideTitles: false,
        createdAt: null,
        lastFetchedAt: null,
      });
      setFeedUrl("");
      setMessage(
        "Calendar link turned off. Your calendar will stop updating and you can remove Steadier from it."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The link could not be turned off."
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await copyPrivate(feedUrl);
      setMessage(
        "Link copied. Keep it private: anyone with it can see your dated tasks."
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Copy failed. Select the link and copy it."
      );
    }
  }

  const googleUrl = feedUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https:/, "webcal:"))}`
    : "";

  return (
    <div className="settings-layout reminders-layout">
      <section className="settings-section" aria-labelledby="tones-title">
        <div className="section-heading">
          <h2 id="tones-title">
            <Bell size={21} /> Sounds & spoken prompts
          </h2>
          <span className="badge">This device</span>
        </div>
        <p>
          Every booked, clock-timed Calendar task automatically starts its Focus
          timer at the scheduled Adelaide time while Steadier is open. During
          that block, this device plays a gentle cue and speaks the task title
          every 15 minutes for blocks under an hour, or hourly for longer blocks.
          These task reminders are always on. For phone-calendar alerts while
          Steadier is closed, use the Calendar link below.
        </p>
        <Toggle
          label="Play tones for other focus prompts"
          hint="does not turn off automatic Calendar task reminders"
          checked={tones.enabled}
          onChange={enabled => updateTones({ enabled })}
        />
        <Toggle
          label="Ring for other task reminders"
          hint="automatic Calendar timer check-ins stay on regardless of this setting"
          checked={tones.reminders}
          disabled={!tones.enabled}
          onChange={reminders => updateTones({ reminders })}
        />
        <Toggle
          label="Halfway check-in"
          hint="for focus blocks of 10 minutes or more"
          checked={tones.halfway}
          disabled={!tones.enabled}
          onChange={halfway => updateTones({ halfway })}
        />
        <Toggle
          label="Speak other focus prompts"
          hint={
            voice.speechSupported
              ? "automatic Calendar task reminders always speak the task title"
              : "voice is unavailable in this browser"
          }
          checked={tones.speak}
          disabled={!tones.enabled || !voice.speechSupported}
          onChange={speak => updateTones({ speak })}
        />
        <Toggle
          label="Vibrate"
          hint="on phones that support it"
          checked={tones.vibrate}
          disabled={!tones.enabled}
          onChange={vibrate => updateTones({ vibrate })}
        />
        <label className="field tone-volume">
          <span>Volume</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={tones.volume}
            disabled={!tones.enabled}
            onChange={event =>
              updateTones({ volume: Number(event.target.value) })
            }
            aria-valuetext={`${Math.round(tones.volume * 100)} percent`}
          />
        </label>
        <div className="backup-actions">
          <button className="button secondary" onClick={testTone}>
            <Volume2 size={16} /> Play a test tone
          </button>
          <button className="button secondary" onClick={testReminder}>
            <Bell size={16} /> Test a reminder
          </button>
          {notifyState !== "unsupported" && notifyState !== "granted" && (
            <button className="button secondary" onClick={askNotify}>
              Allow phone notifications
            </button>
          )}
        </div>
        <p className="small muted">
          Your phone's media volume and silent mode apply. If the screen turns
          off during focus, the tone plays when you return to Steadier.
        </p>
        {notifyState === "granted" && (
          <p className="small muted">
            Phone notifications are on: if Steadier is open in the background,
            reminders also show as a notification.
          </p>
        )}
        {notifyState === "denied" && (
          <p className="small muted">
            Notifications are blocked for this site in your browser settings.
            The chime, toast and calendar link still work.
          </p>
        )}
        {toneNote && <p className="error">{toneNote}</p>}
      </section>

      <section className="settings-section" aria-labelledby="calendar-title">
        <div className="section-heading">
          <h2 id="calendar-title">
            <CalendarPlus size={21} /> Calendar alarms
          </h2>
          <span className="badge">{feed?.active ? "Link active" : "Off"}</span>
        </div>
        <p>
          Put your planned times, reminders, repeating tasks, deadlines, review
          dates and project dates into Google Calendar, so your phone rings even
          when Steadier is closed. Automatic 15-minute/hourly task-timer check-ins
          appear as separate timed alerts in this feed. It updates itself as you
          change things. Notes are never included.
        </p>
        {!c.active || !owner ? (
          <p className="small muted">
            Open Server & Compass and use your shared personal space first; the
            calendar reads your saved server version.
          </p>
        ) : (
          <>
            <Toggle
              label="Hide task titles in the calendar"
              hint='shows "Steadier task" instead'
              checked={hideTitles}
              disabled={busy}
              onChange={setHideTitles}
            />
            {feed?.active && (
              <p className="small muted">
                Link created {formatAdelaide(feed.createdAt)}
                {feed.hideTitles ? " (titles hidden)" : ""}. Last read by a
                calendar:{" "}
                {feed.lastFetchedAt
                  ? formatAdelaide(feed.lastFetchedAt)
                  : "not yet"}
                .
              </p>
            )}
            <div className="backup-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void createLink()}
              >
                <CalendarPlus size={16} />
                {feed?.active ? "Create a new link" : "Create calendar link"}
              </button>
              {feed?.active && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void turnOff()}
                >
                  Turn off link
                </button>
              )}
              {voice.speechSupported && (
                <button
                  className="button secondary"
                  onClick={() =>
                    voice.speaking
                      ? voice.stopSpeaking()
                      : voice.read(CALENDAR_STEPS)
                  }
                >
                  {voice.speaking ? (
                    <Square size={15} />
                  ) : (
                    <Volume2 size={16} />
                  )}
                  {voice.speaking ? "Stop reading" : "Read the steps aloud"}
                </button>
              )}
            </div>
            {feed?.active && !feedUrl && (
              <p className="small muted">
                For privacy the link is shown only once. If you need it again,
                create a new link (the old one stops working) and add that to
                your calendar instead.
              </p>
            )}
            {feedUrl && (
              <div className="notice calendar-link">
                <strong>Your private calendar link</strong>
                <code>{feedUrl}</code>
                <div className="backup-actions">
                  <a
                    className="button primary"
                    href={googleUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Add to Google Calendar
                  </a>
                  <button
                    className="button secondary"
                    onClick={() => void copyLink()}
                  >
                    <ClipboardCopy size={16} /> Copy link
                  </button>
                </div>
                <ol className="small calendar-steps">
                  <li>
                    Tap Add to Google Calendar and choose Add. If it does not
                    open on your phone, copy the link, go to calendar.google.com
                    in a browser, then Other calendars → + → From URL, and
                    paste.
                  </li>
                  <li>
                    In the Google Calendar app: Settings → Steadier (My Life) →
                    set the default notification for <strong>timed events</strong>
                    to “At time of event”. Each Steadier time reminder is its
                    own short entry (marked ⏰), so this makes those reminders
                    ring on time. Flexible windows are transparent all-day
                    entries with no alarm in the feed, but Google’s own all-day
                    default notifications can still alert them. Leave that
                    all-day default off to keep windows quiet; use an explicit
                    hard-deadline reminder in Steadier instead.
                  </li>
                  <li>
                    Google refreshes subscribed calendars on its own schedule,
                    usually within a few hours.
                  </li>
                </ol>
              </div>
            )}
          </>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
