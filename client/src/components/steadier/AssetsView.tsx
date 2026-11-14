import React, { useEffect, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import type {
  Asset,
  AssetCondition,
  AssetLogEntry,
  AssetLogKind,
  AssetMeterUnit,
  AssetServicePlan,
  AssetType,
  Workspace,
} from "../../domain/types";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import { listsOf } from "../../domain/lists";
import {
  addAsset,
  addLogEntry,
  addPlan,
  addReading,
  addRevisit,
  ASSET_CONDITIONS,
  ASSET_TYPE_GROUP,
  ASSET_TYPE_LABEL,
  ASSET_TYPES,
  assetsOf,
  assetsSpeech,
  CONDITION_LABEL,
  costsCsv,
  dueChip,
  editAsset,
  editLogEntry,
  editPlan,
  findAsset,
  heldBy,
  lastReading,
  lastService,
  LOG_KIND_LABEL,
  LOG_KINDS,
  MAX_ASSET_NAME_LENGTH,
  MAX_ASSET_NOTES,
  MAX_ASSET_TEXT,
  METER_LABEL,
  meterText,
  moneyText,
  newAsset,
  newAssetId,
  newAssetLogId,
  newAssetPlanId,
  newAssetReadingId,
  newAssetRevisitId,
  nextDueText,
  obligationsFor,
  parseMeter,
  parseMoney,
  planEveryText,
  planNextText,
  planStatus,
  recordRevisit,
  removeAsset,
  removeLogEntry,
  removePlan,
  removeReading,
  removeRevisit,
  revisitState,
  setAssetStatus,
  shortDate,
  upkeepDue,
  usesMeter,
  yearCost,
  type UpkeepItem,
} from "../../domain/assets";
import type { UpkeepAction } from "./UpkeepDueList";

/** What to open: an asset, optionally with a form ready (from Upkeep due). */
export interface AssetFocus {
  assetId: string;
  action?: UpkeepAction;
  refId?: string | null;
}

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  onMutate: (update: (workspace: Workspace) => Workspace) => boolean;
  readRef?: React.MutableRefObject<(() => string) | null>;
  focus?: AssetFocus | null;
  onFocusHandled?: () => void;
  onCreateTask: (item: UpkeepItem) => void;
  onOpenTask: (taskId: string) => void;
  onOpenList: (templateId: string) => void;
  onOpenObligations: () => void;
}

/** Download the cost-per-asset-per-year CSV (⋮ menu). */
export function downloadAssetCosts(workspace: Workspace) {
  const blob = new Blob([costsCsv(workspace)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `steadier-upkeep-costs-${adelaideClock().date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useChange(onMutate: Props["onMutate"], readOnly: boolean) {
  return (update: (w: Workspace, at: string) => Workspace): boolean => {
    if (readOnly) return false;
    let changed = false;
    const ok = onMutate(w => {
      const next = update(w, adelaideTimestamp());
      changed = next !== w;
      return next;
    });
    return ok && changed;
  };
}
type Change = ReturnType<typeof useChange>;

function Dots({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="lv-dots">
      <button type="button" className="lv-dots-button" aria-label={label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <span className="lv-menu" role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </span>
      )}
    </span>
  );
}

function Chips({ asset, today }: { asset: Asset; today: string }) {
  const due = dueChip(asset, today);
  return (
    <>
      {asset.condition !== "unchecked" && <span className="tp-chip">{CONDITION_LABEL[asset.condition]}</span>}
      {asset.status === "retired" ? <span className="tp-chip">retired</span> : due && <span className="tp-chip">{due}</span>}
    </>
  );
}

export default function AssetsView(props: Props) {
  const { workspace, readOnly, readRef, focus, onFocusHandled } = props;
  const change = useChange(props.onMutate, readOnly);
  const today = adelaideClock().date;
  const assets = assetsOf(workspace);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<AssetFocus | null>(null);
  const [adding, setAdding] = useState<{ placeId: string | null } | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const selected = selectedId ? findAsset(workspace, selectedId) : null;

  const open = (id: string, action?: AssetFocus) => {
    setSelectedId(id);
    setPending(action ?? null);
    setAdding(null);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (focus && findAsset(workspace, focus.assetId)) {
      open(focus.assetId, focus);
      onFocusHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);
  useEffect(() => {
    if (!readRef) return;
    readRef.current = () => `Assets and Upkeep. ${assetsSpeech(workspace, today, selected?.id ?? null)}`;
    return () => {
      readRef.current = null;
    };
  });

  if (selected) {
    return (
      <AssetDetail
        key={selected.id}
        {...props}
        asset={selected}
        today={today}
        change={change}
        pending={pending}
        onPendingDone={() => setPending(null)}
        onBack={() => setSelectedId(null)}
        onOpen={id => open(id)}
      />
    );
  }

  const active = assets.filter(a => a.status === "active");
  const retired = assets.filter(a => a.status === "retired");
  const byName = new Map(assets.map(a => [a.id, a.name]));

  return (
    <section className="lv" aria-labelledby="assets-title">
      <h1 id="assets-title" className="sr-only">
        Assets &amp; Upkeep
      </h1>
      <div className="lv-toolbar">
        {!adding && (
          <button type="button" className="tp-btn" disabled={readOnly} onClick={() => setAdding({ placeId: null })}>
            + Asset
          </button>
        )}
      </div>
      {adding && (
        <NewAssetForm
          workspace={workspace}
          placeId={adding.placeId}
          change={change}
          onDone={id => {
            setAdding(null);
            if (id) open(id);
          }}
        />
      )}
      {!assets.length && !adding && <p className="lv-quiet">No assets yet.</p>}
      {ASSET_TYPES.map(type => {
        const group = active.filter(a => a.type === type);
        if (!group.length) return null;
        const [one, many] = ASSET_TYPE_GROUP[type];
        return (
          <React.Fragment key={type}>
            <h2 className="tp-label">
              {group.length === 1 ? one : many} ({group.length})
            </h2>
            {group.map(a => (
              <AssetCard key={a.id} workspace={workspace} asset={a} today={today} placeName={a.placeId ? byName.get(a.placeId) ?? null : null} onOpen={() => open(a.id)} />
            ))}
          </React.Fragment>
        );
      })}
      {retired.length > 0 && (
        <>
          <button type="button" className="lv-link" aria-expanded={showRetired} onClick={() => setShowRetired(v => !v)}>
            Retired ({retired.length}) {showRetired ? "⌄" : "›"}
          </button>
          {showRetired &&
            retired.map(a => (
              <AssetCard key={a.id} workspace={workspace} asset={a} today={today} placeName={a.placeId ? byName.get(a.placeId) ?? null : null} onOpen={() => open(a.id)} />
            ))}
        </>
      )}
    </section>
  );
}

function AssetCard({
  workspace,
  asset,
  today,
  placeName,
  onOpen,
}: {
  workspace: Workspace;
  asset: Asset;
  today: string;
  placeName: string | null;
  onOpen: () => void;
}) {
  const next = asset.status === "active" ? nextDueText(asset, today) : null;
  const service = lastService(asset);
  const held = asset.type === "place" ? heldBy(workspace, asset.id).filter(a => a.status === "active").length : 0;
  const reading = lastReading(asset);
  const lastLine =
    asset.type === "place"
      ? held
        ? `Holds ${held}`
        : null
      : service
        ? `Last service ${shortDate(service.date, today)}${reading && asset.meter ? ` · ${meterText(reading.value, asset.meter)}` : ""}`
        : reading && asset.meter
          ? `${meterText(reading.value, asset.meter)} on ${shortDate(reading.date, today)}`
          : null;
  return (
    <button type="button" className="lv-card lv-list-row" onClick={onOpen}>
      <span className="lv-row-top">
        <span className="lv-title">{asset.name}</span>
        <Chips asset={asset} today={today} />
      </span>
      {(next || placeName) && (
        <span className="lv-meta">
          {next ? `Next: ${next}` : ""}
          {next && placeName ? " · " : ""}
          {placeName ? `at ${placeName}` : ""}
        </span>
      )}
      {lastLine && <span className="lv-meta">{lastLine}</span>}
    </button>
  );
}

function NewAssetForm({
  workspace,
  placeId,
  change,
  onDone,
}: {
  workspace: Workspace;
  placeId: string | null;
  change: Change;
  onDone: (id: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>(placeId ? "appliance" : "vehicle");
  const place = placeId ? findAsset(workspace, placeId) : null;
  return (
    <form
      className="lv-card lv-form"
      onSubmit={e => {
        e.preventDefault();
        const id = newAssetId();
        if (change((w, at) => addAsset(w, newAsset(id, name, type, at, { placeId, meter: type === "vehicle" ? "km" : null })))) onDone(id);
      }}
    >
      <label className="lv-field">
        Name
        <input value={name} autoFocus maxLength={MAX_ASSET_NAME_LENGTH} onChange={e => setName(e.target.value)} placeholder="For example, Freelander 2" />
      </label>
      <fieldset className="lv-kind">
        <legend>Type</legend>
        {ASSET_TYPES.filter(t => !placeId || t !== "place").map(t => (
          <button key={t} type="button" className={`lv-seg${type === t ? " on" : ""}`} aria-pressed={type === t} onClick={() => setType(t)}>
            {ASSET_TYPE_LABEL[t]}
          </button>
        ))}
      </fieldset>
      {place && <span className="lv-meta">At {place.name}</span>}
      <span className="lv-row-actions">
        <button type="submit" className="tp-btn tp-btn-primary" disabled={!name.trim()}>
          Add asset
        </button>
        <button type="button" className="lv-link" onClick={() => onDone(null)}>
          Cancel
        </button>
      </span>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detail

type Form =
  | { kind: "edit" }
  | { kind: "reading" }
  | { kind: "log"; entry?: AssetLogEntry; planId?: string | null; logKind?: AssetLogKind }
  | { kind: "record"; revisitId: string }
  | { kind: "plan"; plan?: AssetServicePlan }
  | { kind: "revisit" }
  | { kind: "add-held" }
  | { kind: "delete" }
  | { kind: "retire" };

function AssetDetail(
  p: Props & {
    asset: Asset;
    today: string;
    change: Change;
    pending: AssetFocus | null;
    onPendingDone: () => void;
    onBack: () => void;
    onOpen: (id: string) => void;
  }
) {
  const { workspace, asset, today, change, readOnly } = p;
  const [form, setForm] = useState<Form | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (!p.pending) return;
    if (p.pending.action === "reading") setForm({ kind: "reading" });
    else if (p.pending.action === "log") setForm({ kind: "log", logKind: "service", planId: p.pending.refId ?? null });
    else if (p.pending.action === "record" && p.pending.refId) setForm({ kind: "record", revisitId: p.pending.refId });
    p.onPendingDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pending]);

  const close = () => setForm(null);
  const place = asset.placeId ? findAsset(workspace, asset.placeId) : null;
  const project = asset.projectId ? workspace.projects.find(x => x.id === asset.projectId) : null;
  const pillar = asset.pillarId ? (workspace.goals ?? []).find(g => g.id === asset.pillarId) : null;
  const reading = lastReading(asset);
  const held = asset.type === "place" ? heldBy(workspace, asset.id) : [];
  const obligations = obligationsFor(workspace, asset.id);
  const year = today.slice(0, 4);
  const ownCost = yearCost(asset, year);
  const heldCost = held.reduce((n, a) => n + yearCost(a, year), 0);
  const due = upkeepDue(workspace, today).filter(d => d.assetId === asset.id);
  const dueFor = (refId: string) => due.find(d => d.refId === refId) ?? null;
  const hasDetails = asset.make || asset.model || asset.serial || asset.purchaseDate || asset.purchasePrice !== null || asset.warrantyEnd || asset.documents.length;

  const meta = [
    ASSET_TYPE_LABEL[asset.type],
    [asset.make, asset.model].filter(Boolean).join(" "),
    pillar ? `Pillar: ${pillar.title}` : "",
    project ? `project: ${project.title}` : "",
  ].filter(Boolean);

  // Timeline: this asset's entries and readings, plus (for a place) what it holds.
  type Row = { key: string; date: string; sort: string; asset: Asset; log?: AssetLogEntry; reading?: { id: string; value: number } };
  const rows: Row[] = [asset, ...held].flatMap(a => [
    ...a.logs.map(l => ({ key: l.id, date: l.date, sort: l.createdAt, asset: a, log: l })),
    ...(a.id === asset.id ? a.readings.map(r => ({ key: r.id, date: r.date, sort: r.createdAt, asset: a, reading: { id: r.id, value: r.value } })) : []),
  ]);
  rows.sort((x, y) => y.date.localeCompare(x.date) || y.sort.localeCompare(x.sort));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, 12);

  return (
    <section className="lv" aria-labelledby="asset-title">
      <button type="button" className="lv-back" onClick={p.onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> All assets
      </button>
      <div className="lv-title-row">
        <h1 id="asset-title" className="lv-heading">
          {asset.name}
        </h1>
        {!readOnly && (
          <>
            <button type="button" className="tp-btn" onClick={() => setForm({ kind: "edit" })}>
              Edit
            </button>
            <Dots label={`Options for ${asset.name}`}>
              {closeMenu => (
                <button type="button" className="lv-danger" onClick={() => { setForm({ kind: "delete" }); closeMenu(); }}>
                  Delete asset
                </button>
              )}
            </Dots>
          </>
        )}
      </div>
      <span className="lv-row-actions av-chips">
        <Chips asset={asset} today={today} />
        <span className="lv-meta">
          {meta.join(" · ")}
          {place ? " · " : ""}
          {place && (
            <button type="button" className="av-inline-link" onClick={() => p.onOpen(place.id)}>
              at {place.name}
            </button>
          )}
        </span>
      </span>
      {hasDetails ? (
        <>
          <button type="button" className="lv-link" aria-expanded={details} onClick={() => setDetails(v => !v)}>
            Details {details ? "⌄" : "›"}
          </button>
          {details && (
            <dl className="av-details">
              {asset.serial && (<><dt>{asset.type === "vehicle" ? "VIN / serial" : "Serial"}</dt><dd>{asset.serial}</dd></>)}
              {asset.purchaseDate && (<><dt>Purchased</dt><dd>{shortDate(asset.purchaseDate, today)}</dd></>)}
              {asset.purchasePrice !== null && (<><dt>Price</dt><dd>{moneyText(asset.purchasePrice)}</dd></>)}
              {asset.warrantyEnd && (<><dt>Warranty to</dt><dd>{shortDate(asset.warrantyEnd, today)}</dd></>)}
              {asset.documents.map((d, i) => (
                <React.Fragment key={i}>
                  <dt>Document</dt>
                  <dd>
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.label || d.url}
                    </a>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </>
      ) : null}

      {form?.kind === "edit" && <EditForm workspace={workspace} asset={asset} change={change} onDone={close} />}
      {form?.kind === "delete" && (
        <div className="lv-card lv-confirm" role="alertdialog" aria-label="Delete this asset?">
          <span>
            Delete {asset.name} and its {asset.logs.length} entr{asset.logs.length === 1 ? "y" : "ies"}? Retire keeps the history instead. This can't be undone here.
          </span>
          <span className="lv-row-actions">
            <button type="button" className="tp-btn lv-danger-btn" onClick={() => change((w, at) => removeAsset(w, asset.id, at))}>
              Delete
            </button>
            <button type="button" className="lv-link" onClick={close}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {asset.meter && (
        <>
          <h2 className="tp-label">{METER_LABEL[asset.meter]}</h2>
          <span className="lv-row-actions av-meter">
            <span className="lv-title">{reading ? meterText(reading.value, asset.meter) : "No reading yet"}</span>
            {reading && <span className="lv-meta">read {shortDate(reading.date, today)}</span>}
            {!readOnly && form?.kind !== "reading" && (
              <button type="button" className="tp-btn" onClick={() => setForm({ kind: "reading" })}>
                + Reading
              </button>
            )}
          </span>
          {form?.kind === "reading" && <ReadingForm asset={asset} today={today} change={change} onDone={close} />}
        </>
      )}

      {(asset.plans.length > 0 || usesMeter(asset) || asset.type === "appliance") && <h2 className="tp-label">Service plans</h2>}
      {asset.plans.map(plan => {
        const s = planStatus(asset, plan, today);
        const item = dueFor(plan.id);
        const task = plan.taskId ? workspace.tasks.find(t => t.id === plan.taskId) : undefined;
        const template = plan.listTemplateId ? listsOf(workspace).templates.find(t => t.id === plan.listTemplateId) : null;
        if (form?.kind === "plan" && form.plan?.id === plan.id) {
          return <PlanForm key={plan.id} workspace={workspace} asset={asset} plan={plan} change={change} onDone={close} />;
        }
        return (
          <div key={plan.id} className="lv-card av-plan">
            <span className="lv-row-top">
              <span className="av-strong">{plan.name}</span>
              {(s.state === "due" || s.state === "overdue") && <span className="tp-chip">{s.state}</span>}
              {!readOnly && (
                <Dots label={`Options for ${plan.name}`}>
                  {closeMenu => (
                    <>
                      <button type="button" onClick={() => { setForm({ kind: "plan", plan }); closeMenu(); }}>Edit plan</button>
                      <button type="button" className="lv-danger" onClick={() => { change((w, at) => removePlan(w, asset.id, plan.id, at)); closeMenu(); }}>
                        Remove plan (keeps history)
                      </button>
                    </>
                  )}
                </Dots>
              )}
            </span>
            <span className="lv-meta">{planEveryText(plan, asset.meter)}</span>
            <span className="lv-meta">
              {s.state === "not-started"
                ? "Log the last time it was done (or edit the plan) to start the count."
                : `${s.last ? `Last ${s.last.date ? shortDate(s.last.date, today) : ""}${s.last.reading !== null && asset.meter ? ` at ${meterText(s.last.reading, asset.meter)}` : ""} → ` : ""}next ${planNextText(asset, s, today)}`}
            </span>
            {template && (
              <button type="button" className="av-inline-link lv-meta" onClick={() => p.onOpenList(template.id)}>
                List: {template.title} ›
              </button>
            )}
            {!readOnly && (
              <span className="lv-row-actions">
                <button type="button" className="tp-btn" onClick={() => setForm({ kind: "log", logKind: "service", planId: plan.id })}>
                  Log it done
                </button>
                {task ? (
                  <button type="button" className="tp-btn" onClick={() => p.onOpenTask(task.id)}>
                    {task.state === "done" ? "Task done ›" : "Task ›"}
                  </button>
                ) : (
                  item && (
                    <button type="button" className="tp-btn" onClick={() => p.onCreateTask(item)}>
                      Create task
                    </button>
                  )
                )}
              </span>
            )}
            {form?.kind === "log" && form.planId === plan.id && (
              <LogForm workspace={workspace} asset={asset} today={today} change={change} onDone={close} initialKind="service" planId={plan.id} />
            )}
          </div>
        );
      })}
      {!readOnly && form?.kind === "plan" && !form.plan && <PlanForm workspace={workspace} asset={asset} change={change} onDone={close} />}
      {!readOnly && !(form?.kind === "plan") && (usesMeter(asset) || asset.type === "appliance" || asset.plans.length > 0) && (
        <button type="button" className="lv-link" onClick={() => setForm({ kind: "plan" })}>
          + Service plan
        </button>
      )}

      <h2 className="tp-label">Revisit</h2>
      {asset.revisits.map(r => {
        const state = revisitState(r, today);
        const item = dueFor(r.id);
        const task = r.taskId ? workspace.tasks.find(t => t.id === r.taskId) : undefined;
        return (
          <div key={r.id} className="lv-card av-plan">
            <span className="lv-row-top">
              <span className="av-strong">{r.what}</span>
              {state !== "ok" && <span className="tp-chip">{state}</span>}
              {!readOnly && (
                <Dots label={`Options for ${r.what}`}>
                  {closeMenu => (
                    <button type="button" className="lv-danger" onClick={() => { change((w, at) => removeRevisit(w, asset.id, r.id, at)); closeMenu(); }}>
                      Remove revisit
                    </button>
                  )}
                </Dots>
              )}
            </span>
            <span className="lv-meta">
              Revisit by {shortDate(r.by, today)}
              {asset.condition !== "unchecked" ? ` · now ${CONDITION_LABEL[asset.condition]}` : ""}
            </span>
            {!readOnly && (
              <span className="lv-row-actions">
                <button type="button" className="tp-btn" onClick={() => setForm({ kind: "record", revisitId: r.id })}>
                  Record check
                </button>
                {task ? (
                  <button type="button" className="tp-btn" onClick={() => p.onOpenTask(task.id)}>
                    {task.state === "done" ? "Task done ›" : "Task ›"}
                  </button>
                ) : (
                  item && (
                    <button type="button" className="tp-btn" onClick={() => p.onCreateTask(item)}>
                      Create task
                    </button>
                  )
                )}
              </span>
            )}
            {form?.kind === "record" && form.revisitId === r.id && (
              <LogForm workspace={workspace} asset={asset} today={today} change={change} onDone={close} initialKind="inspection" revisitId={r.id} />
            )}
          </div>
        );
      })}
      {!asset.revisits.length && form?.kind !== "revisit" && <p className="lv-quiet">No revisit set.</p>}
      {form?.kind === "revisit" ? (
        <RevisitForm asset={asset} today={today} change={change} onDone={close} />
      ) : (
        !readOnly && (
          <button type="button" className="lv-link" onClick={() => setForm({ kind: "revisit" })}>
            + Revisit
          </button>
        )
      )}

      {asset.type === "place" && (
        <>
          <h2 className="tp-label">Holds ({held.filter(a => a.status === "active").length})</h2>
          {held.map(a => (
            <AssetCard key={a.id} workspace={workspace} asset={a} today={today} placeName={null} onOpen={() => p.onOpen(a.id)} />
          ))}
          {form?.kind === "add-held" ? (
            <NewAssetForm workspace={workspace} placeId={asset.id} change={change} onDone={close} />
          ) : (
            !readOnly && (
              <button type="button" className="lv-link" onClick={() => setForm({ kind: "add-held" })}>
                + Add an asset here
              </button>
            )
          )}
        </>
      )}

      {obligations.length > 0 && (
        <>
          <h2 className="tp-label">From Obligations</h2>
          {obligations.map(o => (
            <button key={o.id} type="button" className="av-inline-link av-obligation" onClick={p.onOpenObligations}>
              {o.title} · due {shortDate(o.dueDate, today)} ›
            </button>
          ))}
        </>
      )}

      <div className="lv-section-head">
        <h2 className="tp-label">History</h2>
        {(ownCost > 0 || heldCost > 0) && (
          <span className="lv-meta">
            {year} · {moneyText(ownCost)}
            {heldCost > 0 ? ` · with what it holds ${moneyText(ownCost + heldCost)}` : ""}
          </span>
        )}
      </div>
      {!rows.length && <p className="lv-quiet">Nothing logged yet.</p>}
      {rows.length > 0 && (
        <ol className="av-timeline">
          {shown.map(row => {
            if (row.reading) {
              return (
                <li key={row.key}>
                  <span className="lv-row-top">
                    <span>
                      <b>{shortDate(row.date, today)}</b> · Reading
                    </span>
                    {!readOnly && (
                      <Dots label={`Options for the reading on ${shortDate(row.date, today)}`}>
                        {closeMenu => (
                          <button type="button" className="lv-danger" onClick={() => { change((w, at) => removeReading(w, asset.id, row.reading!.id, at)); closeMenu(); }}>
                            Delete reading
                          </button>
                        )}
                      </Dots>
                    )}
                  </span>
                  <span className="lv-meta">{asset.meter ? meterText(row.reading.value, asset.meter) : row.reading.value}</span>
                </li>
              );
            }
            const l = row.log!;
            const plan = l.planId ? row.asset.plans.find(x => x.id === l.planId) : null;
            if (form?.kind === "log" && form.entry?.id === l.id) {
              return (
                <li key={row.key}>
                  <LogForm workspace={workspace} asset={row.asset} today={today} change={change} onDone={close} entry={l} />
                </li>
              );
            }
            const facts = [
              l.reading !== null && row.asset.meter ? meterText(l.reading, row.asset.meter) : "",
              l.cost !== null ? moneyText(l.cost) : "",
              l.by,
              l.conditionAfter ? `after: ${CONDITION_LABEL[l.conditionAfter]}` : "",
            ].filter(Boolean);
            return (
              <li key={row.key}>
                <span className="lv-row-top">
                  <span>
                    <b>{shortDate(l.date, today)}</b> · {row.asset.id !== asset.id ? `${row.asset.name} · ` : ""}
                    {LOG_KIND_LABEL[l.kind]}
                    {plan ? ` · ${plan.name}` : ""}
                  </span>
                  {!readOnly && row.asset.id === asset.id && (
                    <Dots label={`Options for the entry on ${shortDate(l.date, today)}`}>
                      {closeMenu => (
                        <>
                          <button type="button" onClick={() => { setForm({ kind: "log", entry: l }); closeMenu(); }}>Edit entry</button>
                          <button type="button" className="lv-danger" onClick={() => { change((w, at) => removeLogEntry(w, asset.id, l.id, at)); closeMenu(); }}>
                            Delete entry
                          </button>
                        </>
                      )}
                    </Dots>
                  )}
                </span>
                {facts.length > 0 && <span className="lv-meta">{facts.join(" · ")}</span>}
                {l.notes && <span className="av-notes">{l.notes}</span>}
                {l.taskId && workspace.tasks.some(t => t.id === l.taskId) && (
                  <button type="button" className="av-inline-link lv-meta" onClick={() => p.onOpenTask(l.taskId!)}>
                    Linked task ›
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > 12 && (
        <button type="button" className="lv-link" onClick={() => setShowAll(v => !v)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
      {!readOnly &&
        (form?.kind === "log" && !form.entry && !form.planId ? (
          <LogForm workspace={workspace} asset={asset} today={today} change={change} onDone={close} initialKind={form.logKind ?? "note"} />
        ) : (
          <button type="button" className="tp-btn lv-wide" onClick={() => setForm({ kind: "log" })}>
            + Log entry
          </button>
        ))}

      {!readOnly &&
        (asset.status === "retired" ? (
          <button type="button" className="av-retire" onClick={() => change((w, at) => setAssetStatus(w, asset.id, "active", at))}>
            Bring {asset.name} back into use
          </button>
        ) : form?.kind === "retire" ? (
          <div className="lv-card lv-confirm" role="alertdialog" aria-label="Retire this place?">
            <span>Retire {asset.name}. Also retire the {held.filter(a => a.status === "active").length} things it holds?</span>
            <span className="lv-row-actions">
              <button type="button" className="tp-btn" onClick={() => change((w, at) => setAssetStatus(w, asset.id, "retired", at))}>
                Keep them active
              </button>
              <button type="button" className="tp-btn" onClick={() => change((w, at) => setAssetStatus(w, asset.id, "retired", at, true))}>
                Retire them too
              </button>
              <button type="button" className="lv-link" onClick={close}>
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="av-retire"
            onClick={() =>
              held.some(a => a.status === "active") ? setForm({ kind: "retire" }) : change((w, at) => setAssetStatus(w, asset.id, "retired", at))
            }
          >
            Retire this {ASSET_TYPE_LABEL[asset.type].toLowerCase()} (keeps its history)
          </button>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Forms

function Actions({ onCancel, label = "Save", disabled = false }: { onCancel: () => void; label?: string; disabled?: boolean }) {
  return (
    <span className="lv-row-actions">
      <button type="submit" className="tp-btn tp-btn-primary" disabled={disabled}>
        {label}
      </button>
      <button type="button" className="lv-link" onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

function Problem({ text }: { text: string }) {
  return text ? (
    <p className="lv-meta av-problem" role="alert">
      {text}
    </p>
  ) : null;
}

function ReadingForm({ asset, today, change, onDone }: { asset: Asset; today: string; change: Change; onDone: () => void }) {
  const [date, setDate] = useState(today);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <form
      className="lv-card lv-form"
      onSubmit={e => {
        e.preventDefault();
        const n = parseMeter(value);
        if (n === undefined || n === null) return setProblem(`Enter the reading as a number of ${asset.meter}.`);
        if (change((w, at) => addReading(w, asset.id, { id: newAssetReadingId(), date, value: n, createdAt: at }))) onDone();
        else setProblem("Not saved. Check sync and try again.");
      }}
    >
      <span className="lv-inline-form">
        <label className="lv-field">
          Reading ({asset.meter})
          <input inputMode="decimal" autoFocus value={value} onChange={e => setValue(e.target.value)} />
        </label>
        <label className="lv-field">
          Date
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
        </label>
      </span>
      <Problem text={problem} />
      <Actions onCancel={onDone} disabled={!value.trim() || !date} />
    </form>
  );
}

function LogForm({
  workspace,
  asset,
  today,
  change,
  onDone,
  entry,
  initialKind = "note",
  planId = null,
  revisitId,
}: {
  workspace: Workspace;
  asset: Asset;
  today: string;
  change: Change;
  onDone: () => void;
  entry?: AssetLogEntry;
  initialKind?: AssetLogKind;
  planId?: string | null;
  revisitId?: string;
}) {
  const current = lastReading(asset);
  const [kind, setKind] = useState<AssetLogKind>(entry?.kind ?? initialKind);
  const [date, setDate] = useState(entry?.date ?? today);
  const [reading, setReading] = useState(entry?.reading != null ? String(entry.reading) : planId && current ? String(current.value) : "");
  const [cost, setCost] = useState(entry?.cost != null ? (entry.cost / 100).toFixed(entry.cost % 100 ? 2 : 0) : "");
  const [by, setBy] = useState(entry?.by ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [condition, setCondition] = useState<AssetCondition | "">(entry?.conditionAfter ?? "");
  const [plan, setPlan] = useState<string>(entry?.planId ?? planId ?? "");
  const [nextBy, setNextBy] = useState("");
  const [problem, setProblem] = useState("");
  const revisit = revisitId ? asset.revisits.find(r => r.id === revisitId) : null;
  void workspace;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = asset.meter ? parseMeter(reading) : null;
    const c = parseMoney(cost);
    if (r === undefined) return setProblem(`Enter the reading as a number of ${asset.meter}, or leave it empty.`);
    if (c === undefined) return setProblem("Enter the cost as dollars (for example 48 or 48.50), or leave it empty.");
    if (revisit && !condition) return setProblem("Choose the condition you found.");
    const fields = {
      kind,
      date,
      reading: r,
      cost: c,
      by: by.trim(),
      notes: notes.trim(),
      conditionAfter: condition || null,
      planId: kind === "service" && plan ? plan : null,
    };
    const ok = change((w, at) => {
      if (entry) return editLogEntry(w, asset.id, entry.id, fields, at);
      const newEntry: AssetLogEntry = { id: newAssetLogId(), ...fields, taskId: null, createdAt: at, updatedAt: at };
      if (revisit) return recordRevisit(w, asset.id, revisit.id, newEntry, nextBy || null);
      return addLogEntry(w, asset.id, newEntry);
    });
    if (ok) onDone();
    else setProblem("Not saved. Check the entry and sync, then try again.");
  };

  return (
    <form className="lv-card lv-form av-log-form" onSubmit={submit}>
      <h3 className="lv-subheading">{revisit ? `Record check: ${revisit.what}` : entry ? "Edit entry" : "Log entry"}</h3>
      {!revisit && (
        <fieldset className="lv-kind">
          <legend>Type</legend>
          {LOG_KINDS.map(k => (
            <button key={k} type="button" className={`lv-seg${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {LOG_KIND_LABEL[k]}
            </button>
          ))}
        </fieldset>
      )}
      {kind === "service" && asset.plans.length > 0 && !revisit && (
        <label className="lv-field">
          Service plan
          <select value={plan} onChange={e => setPlan(e.target.value)}>
            <option value="">Not part of a plan</option>
            {asset.plans.map(x => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="lv-inline-form">
        <label className="lv-field">
          Date
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
        </label>
        {asset.meter && (
          <label className="lv-field">
            Reading ({asset.meter}, optional)
            <input inputMode="decimal" value={reading} onChange={e => setReading(e.target.value)} />
          </label>
        )}
      </span>
      <span className="lv-inline-form">
        <label className="lv-field">
          Cost (optional)
          <input inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="$" />
        </label>
        <label className="lv-field">
          Who did it (optional)
          <input value={by} maxLength={MAX_ASSET_TEXT} onChange={e => setBy(e.target.value)} placeholder="me, or the business" />
        </label>
      </span>
      <label className="lv-field">
        {revisit ? "Condition found" : "Condition after (optional)"}
        <select value={condition} onChange={e => setCondition(e.target.value as AssetCondition | "")}>
          <option value="">{revisit ? "Choose…" : "Not recorded"}</option>
          {ASSET_CONDITIONS.filter(x => x !== "unchecked").map(x => (
            <option key={x} value={x}>
              {CONDITION_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="lv-field">
        Notes (optional)
        <textarea rows={2} maxLength={MAX_ASSET_NOTES} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>
      {revisit && (
        <label className="lv-field">
          Revisit again by (optional; empty closes it)
          <input type="date" value={nextBy} min={today} onChange={e => setNextBy(e.target.value)} />
        </label>
      )}
      <Problem text={problem} />
      <Actions onCancel={onDone} disabled={!date} />
    </form>
  );
}

function PlanForm({ workspace, asset, plan, change, onDone }: { workspace: Workspace; asset: Asset; plan?: AssetServicePlan; change: Change; onDone: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [months, setMonths] = useState(plan?.everyMonths ? String(plan.everyMonths) : "");
  const [meter, setMeter] = useState(plan?.everyMeter ? String(plan.everyMeter) : "");
  const [startDate, setStartDate] = useState(plan?.startDate ?? "");
  const [startReading, setStartReading] = useState(plan?.startReading != null ? String(plan.startReading) : "");
  const [list, setList] = useState(plan?.listTemplateId ?? "");
  const [problem, setProblem] = useState("");
  const templates = listsOf(workspace).templates;
  const whole = (t: string) => (t.trim() ? (/^\d{1,7}$/.test(t.replace(/,/g, "").trim()) && Number(t.replace(/,/g, "")) > 0 ? Number(t.replace(/,/g, "")) : undefined) : null);

  return (
    <form
      className="lv-card lv-form"
      onSubmit={e => {
        e.preventDefault();
        const everyMonths = whole(months);
        const everyMeter = asset.meter ? whole(meter) : null;
        const sr = asset.meter ? parseMeter(startReading) : null;
        if (everyMonths === undefined || everyMeter === undefined || sr === undefined) return setProblem("Use whole numbers.");
        if (everyMonths === null && everyMeter === null) return setProblem("Give a time, a meter interval, or both.");
        const fields = { name, everyMonths, everyMeter, startDate: startDate || null, startReading: sr, listTemplateId: list || null };
        const ok = change((w, at) =>
          plan ? editPlan(w, asset.id, plan.id, fields, at) : addPlan(w, asset.id, { id: newAssetPlanId(), ...fields, taskId: null, createdAt: at, updatedAt: at })
        );
        if (ok) onDone();
        else setProblem("Not saved. Check the plan and sync, then try again.");
      }}
    >
      <h3 className="lv-subheading">{plan ? "Edit service plan" : "New service plan"}</h3>
      <label className="lv-field">
        Name
        <input value={name} autoFocus maxLength={MAX_ASSET_TEXT} onChange={e => setName(e.target.value)} placeholder="For example, Major service" />
      </label>
      <span className="lv-inline-form">
        <label className="lv-field">
          Every … months
          <input inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)} />
        </label>
        {asset.meter && (
          <label className="lv-field">
            Every … {asset.meter}
            <input inputMode="numeric" value={meter} onChange={e => setMeter(e.target.value)} />
          </label>
        )}
      </span>
      {asset.meter && <span className="lv-meta">With both, whichever comes first.</span>}
      <span className="lv-inline-form">
        <label className="lv-field">
          Last done (if not logged here)
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </label>
        {asset.meter && (
          <label className="lv-field">
            At ({asset.meter})
            <input inputMode="decimal" value={startReading} onChange={e => setStartReading(e.target.value)} />
          </label>
        )}
      </span>
      {templates.length > 0 && (
        <label className="lv-field">
          List to offer when it's due (optional)
          <select value={list} onChange={e => setList(e.target.value)}>
            <option value="">No list</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <Problem text={problem} />
      <Actions onCancel={onDone} disabled={!name.trim()} />
    </form>
  );
}

function RevisitForm({ asset, today, change, onDone }: { asset: Asset; today: string; change: Change; onDone: () => void }) {
  const [what, setWhat] = useState("");
  const [by, setBy] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <form
      className="lv-card lv-form"
      onSubmit={e => {
        e.preventDefault();
        if (change((w, at) => addRevisit(w, asset.id, { id: newAssetRevisitId(), what: what.trim(), by, taskId: null, createdAt: at }))) onDone();
        else setProblem("Not saved. Check sync and try again.");
      }}
    >
      <label className="lv-field">
        What to check
        <input value={what} autoFocus maxLength={MAX_ASSET_TEXT} onChange={e => setWhat(e.target.value)} placeholder="For example, Roof and gutters" />
      </label>
      <label className="lv-field">
        Revisit by
        <input type="date" value={by} min={today} onChange={e => setBy(e.target.value)} />
      </label>
      <Problem text={problem} />
      <Actions onCancel={onDone} disabled={!what.trim() || !by} />
    </form>
  );
}

function EditForm({ workspace, asset, change, onDone }: { workspace: Workspace; asset: Asset; change: Change; onDone: () => void }) {
  const [name, setName] = useState(asset.name);
  const [type, setType] = useState<AssetType>(asset.type);
  const [condition, setConditionValue] = useState<AssetCondition>(asset.condition);
  const [make, setMake] = useState(asset.make);
  const [model, setModel] = useState(asset.model);
  const [serial, setSerial] = useState(asset.serial);
  const [purchaseDate, setPurchaseDate] = useState(asset.purchaseDate ?? "");
  const [price, setPrice] = useState(asset.purchasePrice !== null ? (asset.purchasePrice / 100).toFixed(asset.purchasePrice % 100 ? 2 : 0) : "");
  const [warranty, setWarranty] = useState(asset.warrantyEnd ?? "");
  const [docs, setDocs] = useState(asset.documents.map(d => (d.label ? `${d.label} ${d.url}` : d.url)).join("\n"));
  const [pillarId, setPillarId] = useState(asset.pillarId ?? "");
  const [projectId, setProjectId] = useState(asset.projectId ?? "");
  const [placeId, setPlaceId] = useState(asset.placeId ?? "");
  const [meter, setMeter] = useState<AssetMeterUnit | "">(asset.meter ?? "");
  const [problem, setProblem] = useState("");
  const pillars = (workspace.goals ?? []).filter(g => g.level === "pillar" && (g.status === "active" || g.id === asset.pillarId));
  const projects = workspace.projects.filter(x => x.status === "active" || x.id === asset.projectId);
  const places = assetsOf(workspace).filter(a => a.type === "place" && a.id !== asset.id && (a.status === "active" || a.id === asset.placeId));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const purchasePrice = parseMoney(price);
    if (purchasePrice === undefined) return setProblem("Enter the price in dollars, or leave it empty.");
    const documents: { label: string; url: string }[] = [];
    for (const line of docs.split("\n").map(x => x.trim()).filter(Boolean)) {
      const m = /^(.*?)\s*(https:\/\/\S+)$/i.exec(line);
      if (!m) return setProblem("Each document line needs an https:// link (a label before it is optional).");
      documents.push({ label: m[1].slice(0, MAX_ASSET_TEXT), url: m[2] });
    }
    if (meter === "" && asset.readings.length) return setProblem("This asset has readings. Delete them before removing its meter.");
    const ok = change((w, at) => {
      let next = editAsset(
        w,
        asset.id,
        {
          name,
          type,
          make: make.trim(),
          model: model.trim(),
          serial: serial.trim(),
          purchaseDate: purchaseDate || null,
          purchasePrice,
          warrantyEnd: warranty || null,
          documents,
          pillarId: pillarId || null,
          projectId: projectId || null,
          placeId: type === "place" ? null : placeId || null,
          meter: meter || null,
        },
        at
      );
      if (condition !== asset.condition) next = { ...next, assets: assetsOf(next).map(a => (a.id === asset.id ? { ...a, condition, updatedAt: at } : a)) };
      return next;
    });
    if (ok) onDone();
    else setProblem("Not saved. Check the details and sync, then try again.");
  };

  return (
    <form className="lv-card lv-form" onSubmit={submit}>
      <h3 className="lv-subheading">Edit {asset.name}</h3>
      <label className="lv-field">
        Name
        <input value={name} maxLength={MAX_ASSET_NAME_LENGTH} onChange={e => setName(e.target.value)} />
      </label>
      <fieldset className="lv-kind">
        <legend>Type</legend>
        {ASSET_TYPES.map(t => (
          <button key={t} type="button" className={`lv-seg${type === t ? " on" : ""}`} aria-pressed={type === t} onClick={() => setType(t)}>
            {ASSET_TYPE_LABEL[t]}
          </button>
        ))}
      </fieldset>
      <label className="lv-field">
        Condition
        <select value={condition} onChange={e => setConditionValue(e.target.value as AssetCondition)}>
          {ASSET_CONDITIONS.map(x => (
            <option key={x} value={x}>
              {CONDITION_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <span className="lv-inline-form">
        <label className="lv-field">
          Make
          <input value={make} maxLength={MAX_ASSET_TEXT} onChange={e => setMake(e.target.value)} />
        </label>
        <label className="lv-field">
          Model
          <input value={model} maxLength={MAX_ASSET_TEXT} onChange={e => setModel(e.target.value)} />
        </label>
      </span>
      <label className="lv-field">
        {type === "vehicle" ? "VIN or serial" : "Serial"}
        <input value={serial} maxLength={MAX_ASSET_TEXT} onChange={e => setSerial(e.target.value)} />
      </label>
      <span className="lv-inline-form">
        <label className="lv-field">
          Purchased
          <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
        </label>
        <label className="lv-field">
          Price
          <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="$" />
        </label>
      </span>
      <label className="lv-field">
        Warranty to
        <input type="date" value={warranty} onChange={e => setWarranty(e.target.value)} />
      </label>
      <label className="lv-field">
        Documents (one per line: label then https:// link)
        <textarea rows={2} value={docs} onChange={e => setDocs(e.target.value)} />
      </label>
      {(usesMeter({ type }) || asset.meter) && (
        <label className="lv-field">
          Meter
          <select value={meter} onChange={e => setMeter(e.target.value as AssetMeterUnit | "")}>
            <option value="">No meter</option>
            <option value="km">Odometer (km)</option>
            <option value="h">Engine hours (h)</option>
          </select>
        </label>
      )}
      {type !== "place" && places.length > 0 && (
        <label className="lv-field">
          At a place
          <select value={placeId} onChange={e => setPlaceId(e.target.value)}>
            <option value="">Not at a place</option>
            {places.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {pillars.length > 0 && (
        <label className="lv-field">
          Pillar
          <select value={pillarId} onChange={e => setPillarId(e.target.value)}>
            <option value="">No Pillar</option>
            {pillars.map(g => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="lv-field">
        Project
        <select value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">No project</option>
          {projects.map(x => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
      </label>
      <Problem text={problem} />
      <Actions onCancel={onDone} disabled={!name.trim()} />
    </form>
  );
}
