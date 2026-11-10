import { useRef, useState, type ReactNode } from "react";
import {
  Download,
  Upload,
  FlaskConical,
  ShieldCheck,
  Mic,
  WifiOff,
  ArrowRight,
} from "lucide-react";
import type { Scenario, Task } from "../../domain/types";
import { exportCSV, importTasks } from "../../domain/transfer";
const scenarios: { id: Scenario; title: string; description: string }[] = [
  {
    id: "few",
    title: "5 responsibilities",
    description: "A small, everyday collection.",
  },
  {
    id: "fifty",
    title: "50 responsibilities",
    description: "A busy week, without a busy home.",
  },
  {
    id: "twohundred",
    title: "200 responsibilities",
    description: "The original five-second challenge.",
  },
  {
    id: "fivehundred",
    title: "500 responsibilities",
    description: "Test the inventory, not your patience.",
  },
  {
    id: "deadlines",
    title: "Approaching commitments",
    description: "A deadline is a fact, not a colour.",
  },
  {
    id: "overdue",
    title: "Passed commitments",
    description: "A recovery plan, without shame.",
  },
  {
    id: "undated",
    title: "No deadlines",
    description: "Important work still deserves attention.",
  },
  {
    id: "quiet",
    title: "Nothing time-critical",
    description: "Quiet does not mean forgotten.",
  },
];
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface Props {
  tasks: Task[];
  kind: "demo" | "personal";
  backupPanel: ReactNode;
  remindersPanel?: ReactNode;
  onScenario: (s: Scenario) => void;
  onImport: (t: Task[]) => void;
  onPersonal: () => void;
  onDemo: () => void;
  installAvailable: boolean;
  onInstall: () => void;
  readOnly: boolean;
}
export default function SettingsView(p: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [persisted, setPersisted] = useState("");
  const [scenario, setScenario] = useState<Scenario>("twohundred");
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">A REAL COLLECTION, A CAREFUL TRIAL</div>
        <h1>Keep your life information safe.</h1>
        <p>
          Try one week, then review before extending to a month. A browser save
          is useful; a downloaded backup is your independent copy.
        </p>
      </div>
      {p.backupPanel}
      {p.remindersPanel}
      <div className="settings-layout">
        <section className="settings-section">
          <div className="section-heading">
            <h2>
              <FlaskConical size={21} />
              Scenario lab
            </h2>
            <span className="badge">Demo data only</span>
          </div>
          <p>
            Change the sample collection to see how the same attention view
            behaves. These controls never replace your personal work.
          </p>
          {p.kind === "personal" ? (
            <div className="notice">
              <p>You are in your personal workspace. The lab is locked here.</p>
              <button className="button secondary" onClick={p.onDemo}>
                Switch to demo
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <label className="field">
                Choose a sample scenario
                <select
                  value={scenario}
                  onChange={e => setScenario(e.target.value as Scenario)}
                >
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="small muted">
                {scenarios.find(s => s.id === scenario)?.description}
              </p>
              <button
                className="button primary"
                disabled={p.readOnly}
                onClick={() => p.onScenario(scenario)}
              >
                Load sample scenario
                <ArrowRight size={16} />
              </button>
              <p className="small muted">
                Replaces only the demo collection. Undo can restore the previous
                demo.
              </p>
            </>
          )}
          <div className="scenario-principles">
            <strong>What to look for</strong>
            <p>
              At most five explained suggestions. Every task still findable.
              More commitments than fit the home remain visible. Undated work
              returns for review.
            </p>
          </div>
        </section>
        <section className="settings-section">
          <h2>
            <ShieldCheck size={21} />
            Your workspace
          </h2>
          <p>
            <strong>
              {p.kind === "demo" ? "Sample collection" : "Personal collection"}
            </strong>{" "}
            · {p.tasks.length} records on this browser.
          </p>
          <p className="small">
            Personal work starts empty. Nothing is imported from your accounts.
            The two collections are saved separately.
          </p>
          <button
            className="button secondary"
            onClick={p.kind === "demo" ? p.onPersonal : p.onDemo}
          >
            {p.kind === "demo" ? "Open my personal space" : "Return to demo"}
            <ArrowRight size={16} />
          </button>
          <p className="privacy-note">
            Local-first, not cloud-synced. Data belongs to this browser and
            website address. Different phones, browsers, Preview and a published
            site do not share it. Clearing site data deletes it. Export
            regularly.
          </p>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const ok = await navigator.storage?.persist?.();
                setPersisted(
                  ok
                    ? "Browser persistent storage was granted. Keep exporting backups; this is still not cloud backup."
                    : "The browser did not grant persistent storage. Export a backup regularly."
                );
              } catch {
                setPersisted("Storage persistence is not available here.");
              }
            }}
          >
            Ask browser to reduce storage eviction
          </button>
          {persisted && (
            <p className="small" role="status">
              {persisted}
            </p>
          )}
        </section>
        <section className="settings-section">
          <h2>
            <Download size={21} />
            Additive task interchange
          </h2>
          <p>
            CSV is a spreadsheet-friendly core-field interchange, not a complete
            project backup. Use the full backup and restore controls above for
            your outcomes, identity, milestones and saved intention.
          </p>
          <div className="backup-actions">
            <button
              className="button secondary"
              onClick={() =>
                download(
                  exportCSV(p.tasks),
                  `steadier-${p.kind}.csv`,
                  "text/csv;charset=utf-8"
                )
              }
            >
              <Download size={16} />
              Export CSV
            </button>
            <button
              className="button secondary"
              disabled={p.readOnly}
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />
              Add tasks from JSON or CSV
            </button>
          </div>
          <input
            ref={file}
            hidden
            type="file"
            accept=".json,.csv,application/json,text/csv"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setMessage("");
              setError("");
              try {
                if (f.size > 5 * 1024 * 1024)
                  throw new Error("Choose a file smaller than 5 MB.");
                const tasks = importTasks(
                  await f.text(),
                  f.name.toLowerCase().endsWith(".csv") ? "csv" : "json",
                  p.tasks
                );
                p.onImport(tasks);
                setMessage(
                  `Added ${tasks.length} responsibilities to ${p.kind}. Existing records were not replaced.`
                );
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Import failed. No data was changed."
                );
              }
              e.target.value = "";
            }}
          />
          <p className="small muted">
            Imports are validated and additive, with fresh IDs. Importing the
            same file twice adds a second copy. This does not restore a whole
            workspace; use checked full restore above to preserve its identities
            and project links. CSV omits projects, identity fields, checklist
            and history.
          </p>
          {message && (
            <p role="status" className="success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
        <section className="settings-section">
          <h2>
            <Mic size={21} />
            Voice belongs in the first version
          </h2>
          <p>
            Capture a spoken task, review the transcript, then save. Read your
            attention summary or next step aloud. Nothing is automatically
            completed from a transcript.
          </p>
          <p className="small">
            Use a compatible full browser, such as Chrome on Android. Embedded
            app browsers may not support dictation. Your browser may send audio
            to its recognition provider; speech recognition may need internet
            access. Microphone denial and unsupported APIs are shown as errors,
            not simulated success.
          </p>
        </section>
        <section className="settings-section">
          <h2>
            <WifiOff size={21} />
            On your phone, and away from the network
          </h2>
          <p>
            The production build includes an installable manifest and an offline
            app shell after a successful online load. Task editing is
            browser-local. Speech recognition is not promised offline.
          </p>
          {p.installAvailable ? (
            <button className="button primary" onClick={p.onInstall}>
              Install Steadier
              <ArrowRight size={16} />
            </button>
          ) : (
            <p className="small muted">
              In a supported full browser, use its menu → Install app / Add to
              Home screen after publication. Install prompts and service workers
              may be unavailable inside embedded Preview.
            </p>
          )}
          <p className="privacy-note">
            Tones play only while Steadier is open. For alarms when it is
            closed, add the private calendar link above to Google Calendar.
            Steadier sends no push notifications. Relevance is recalculated
            while open and when you return.
          </p>
        </section>
      </div>
    </>
  );
}
