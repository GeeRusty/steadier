import { useMemo, useState } from "react";
import { formatAdelaide } from "../../../../shared/time";
import { Download, Table2, RefreshCw } from "lucide-react";
import type { useSharedWorkspace } from "../../hooks/useSharedWorkspace";
import type { Task } from "../../domain/types";
import { derivedState, today } from "../../domain/engine";
import { rowLabel } from "../../domain/linkCheck";
import { downloadPrivate, privateOwnerRequest } from "../../lib/cloudApi";

type Store = ReturnType<typeof useSharedWorkspace>;
export default function SheetView({
  store,
  onConnect,
  onOpen,
}: {
  store: Store;
  onConnect: () => void;
  onOpen: (task: Task) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const c = store.cloud;
  const rows = useMemo(
    () =>
      store.workspace.tasks.filter(t =>
        `${t.title} ${t.area} ${t.purpose} ${t.nextAction}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [store.workspace.tasks, search]
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  return (
    <div className="sheet-view">
      <div className="view-heading">
        <span className="eyebrow">
          THE WHOLE COLLECTION, NOT JUST TODAY'S FEW
        </span>
        <h1>
          <Table2 size={30} /> Server sheet
        </h1>
        <p>
          One database record supplies the app, this view and Compass. A
          downloaded CSV is a snapshot; the private AI endpoint generates the
          current saved sheet each time it is read.
        </p>
      </div>
      {!c.active ? (
        <div className="notice">
          <strong>
            This view is currently browser data, not a live server sheet.
          </strong>
          <p>
            Connect your private shared personal space to see the same saved
            information on another device or provide AI read access.
          </p>
          <button className="button primary" onClick={onConnect}>
            Open server connection
          </button>
        </div>
      ) : (
        <div className="notice">
          <strong>Server revision {c.revision}</strong>
          <p>
            Last confirmed server update:{" "}
            {c.lastSyncedAt
              ? `${formatAdelaide(c.lastSyncedAt)} (Adelaide)`
              : "No saved change yet"}
            .{" "}
            {c.pending
              ? "The displayed browser draft has pending changes. The CSV and Compass read the last confirmed server version until these changes are saved."
              : "This app is showing the confirmed version unless a new change is still loading."}
          </p>
        </div>
      )}
      <div className="sheet-toolbar">
        <label className="field">
          Search every held responsibility
          <input
            type="search"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Title, area, purpose or next step"
          />
        </label>
        <div className="backup-actions">
          <button
            className="button secondary"
            disabled={!c.active || busy}
            onClick={() => void c.retry()}
          >
            <RefreshCw size={16} />
            Check latest
          </button>
          <button
            className="button primary"
            disabled={!c.active || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const response = await privateOwnerRequest(
                  c.user?.id || 0,
                  "/api/steadier/sheet.csv"
                );
                if (
                  !response.ok ||
                  !response.headers.get("content-type")?.includes("text/csv")
                )
                  throw new Error(
                    "The private server sheet could not be downloaded. Sign in and retry."
                  );
                downloadPrivate(
                  await response.text(),
                  `steadier-server-sheet-${today()}.csv`,
                  "text/csv;charset=utf-8"
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Download unavailable."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={16} />
            Download saved server CSV
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">
        {rows.length} matching responsibilities, including completed work. No
        deadline is invented. The downloaded sheet is not a full backup; use
        Backups & trial for complete restore data.
      </p>
      <div
        className="sheet-scroll"
        tabIndex={0}
        role="region"
        aria-label="Responsibility sheet, horizontally scrollable"
      >
        <table className="responsibility-sheet">
          <caption>
            Full personal responsibility inventory and life framing
          </caption>
          <thead>
            <tr>
              {[
                "Responsibility",
                "Life area",
                "Purpose",
                "Identity",
                "Available state",
                "Next action",
                "Project / outcome",
                "Real deadline",
                "Preparation / source",
                "Review",
                "Waiting / prerequisites",
                "Evidence",
              ].map(h => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(safePage * 50, safePage * 50 + 50).map(t => {
              const project = store.workspace.projects.find(
                p => p.id === t.projectId
              );
              return (
                <tr key={t.id}>
                  <th scope="row">
                    <button className="text-button" onClick={() => onOpen(t)}>
                      {t.title}
                    </button>
                  </th>
                  <td>{t.area || "General"}</td>
                  <td>{t.purpose || "Not clarified"}</td>
                  <td>
                    {rowLabel(t, store.workspace)}
                    <small>{t.labelSource}</small>
                  </td>
                  <td>{derivedState(t, store.workspace.tasks)}</td>
                  <td>{t.nextAction || "Choose next step"}</td>
                  <td>
                    {project?.title || "—"}
                    <small>{project?.outcome}</small>
                  </td>
                  <td>{t.deadline || "No deadline"}</td>
                  <td>
                    {t.preparationDate || "—"}
                    <small>
                      {t.preparationDate ? t.preparationSource : ""}
                    </small>
                  </td>
                  <td>{t.reviewDate || "—"}</td>
                  <td>
                    {t.waitingFor}
                    {t.dependencies.map(id => (
                      <small key={id}>
                        {store.workspace.tasks.find(dep => dep.id === id)
                          ?.title || "Missing prerequisite"}
                      </small>
                    ))}
                  </td>
                  <td>{t.progressEvidence || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="quiet-state">
          <h2>The collection is held here as you add it.</h2>
          <p>
            Start with a few real responsibilities and one meaningful outcome.
          </p>
        </div>
      )}
      {rows.length > 50 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            Previous
          </button>
          <span>
            Page {safePage + 1} of {Math.ceil(rows.length / 50)}
          </span>
          <button
            className="button secondary"
            disabled={(safePage + 1) * 50 >= rows.length}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
