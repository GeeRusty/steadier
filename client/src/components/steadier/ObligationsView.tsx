import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  amountsHiddenFromAI,
  defaultLeadTimeDays,
  markObligationPaid,
  newObligationDraft,
  obligationPreparationTask,
  preparationDateFor,
  restorePreparationTask,
  saveObligation,
} from "../../domain/obligations";
import type { VoiceControls } from "../../hooks/useVoice";
import type {
  Obligation,
  ObligationCadence,
  ObligationKind,
  ObligationLink,
  ObligationStatus,
  Workspace,
} from "../../domain/types";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import TimingShapeMark from "./TimingShapeMark";
import ScanBillPanel from "./ScanBillPanel";
import { CADENCE_LABEL, KIND_LABEL } from "./obligationLabels";

interface Props {
  workspace: Workspace;
  day: string;
  readOnly: boolean;
  voice: VoiceControls;
  onMutate: (change: (workspace: Workspace) => Workspace) => boolean | void;
  onOpenTask: (
    task: NonNullable<ReturnType<typeof obligationPreparationTask>>
  ) => void;
  focusId?: string | null;
}

function dayLabel(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function linkValue(link: ObligationLink | null): string {
  return link ? `${link.kind}|${link.id}` : "";
}

function parseLink(value: string): ObligationLink | null {
  const splitAt = value.indexOf("|");
  if (splitAt < 0) return null;
  const kind = value.slice(0, splitAt);
  const id = value.slice(splitAt + 1);
  if (!id || (kind !== "pillar" && kind !== "imperative")) return null;
  return { kind, id };
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "That change was not saved. Check sync and try again.";
}

export default function ObligationsView({
  workspace,
  day,
  readOnly,
  voice,
  onMutate,
  onOpenTask,
  focusId = null,
}: Props) {
  const obligations = workspace.obligations ?? [];
  const [form, setForm] = useState<Obligation | null>(null);
  const [formError, setFormError] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState("");
  const voiceForName = useRef(false);

  useEffect(() => {
    if (!voiceForName.current || !voice.finalTranscript.trim()) return;
    const spoken = voice.finalTranscript.trim().slice(0, 300);
    setForm(current => (current ? { ...current, title: spoken } : current));
    voiceForName.current = false;
  }, [voice.finalTranscript]);

  const ordered = useMemo(() => {
    const statusOrder: Record<ObligationStatus, number> = {
      active: 0,
      draft: 1,
      paid: 2,
    };
    return [...obligations].sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        (a.status === "paid"
          ? (b.lastPaidOn ?? b.updatedAt).localeCompare(
              a.lastPaidOn ?? a.updatedAt
            )
          : a.dueDate.localeCompare(b.dueDate)) ||
        a.title.localeCompare(b.title)
    );
  }, [obligations]);
  const visibleObligations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-AU");
    return ordered.filter(item => {
      const linkTitle =
        item.link?.kind === "pillar"
          ? ((workspace.goals ?? []).find(goal => goal.id === item.link?.id)
              ?.title ?? "")
          : item.link?.kind === "imperative"
            ? ((workspace.imperatives ?? []).find(
                entry => entry.id === item.link?.id
              )?.title ?? "")
            : "";
      return (
        !needle ||
        `${item.title} ${KIND_LABEL[item.kind]} ${CADENCE_LABEL[item.cadence]} ${item.dueDate} ${item.nextAction} ${item.amountDue ?? ""} ${item.referenceUrl ?? ""} ${linkTitle} ${item.status}`
          .toLocaleLowerCase("en-AU")
          .includes(needle)
      );
    });
  }, [ordered, query, workspace.goals, workspace.imperatives]);
  const obligationGroups = groupByStable(visibleObligations, item => {
    if (item.status === "draft") return { key: "draft", label: "Drafts" };
    if (item.status === "paid") return { key: "paid", label: "Paid or done" };
    if (item.dueDate < day)
      return { key: "past-due", label: "Past due · unpaid" };
    if (item.dueDate === day) return { key: "due-today", label: "Due today" };
    const soon =
      Date.parse(`${item.dueDate}T12:00:00Z`) -
        Date.parse(`${day}T12:00:00Z`) <=
      7 * 86_400_000;
    return soon
      ? { key: "due-soon", label: "Due in the next 7 days" }
      : {
          ...monthGroup(item.dueDate),
          key: `upcoming-${monthGroup(item.dueDate).key}`,
          label: `Upcoming · ${monthGroup(item.dueDate).label}`,
        };
  });

  const openNew = () => {
    if (voice.listening) voice.abort();
    voice.clear();
    voiceForName.current = false;
    setForm(newObligationDraft(day));
    setIsNew(true);
    setFormError("");
  };

  const openEdit = (obligation: Obligation) => {
    if (voice.listening) voice.abort();
    voice.clear();
    voiceForName.current = false;
    setForm({
      ...obligation,
      link: obligation.link ? { ...obligation.link } : null,
    });
    setIsNew(false);
    setFormError("");
  };

  useEffect(() => {
    if (!focusId) return;
    const target = obligations.find(item => item.id === focusId);
    if (target) openEdit(target);
  }, [focusId]);

  const closeForm = () => {
    voiceForName.current = false;
    if (voice.listening) voice.abort();
    else voice.clear();
    setForm(null);
    setFormError("");
  };

  const change = <K extends keyof Obligation>(key: K, value: Obligation[K]) => {
    setForm(current => (current ? { ...current, [key]: value } : current));
    setFormError("");
  };

  const dictateName = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    voice.clear();
    voiceForName.current = true;
    voice.start();
  };

  const save = (status: "draft" | "active") => {
    if (!form || readOnly) return;
    if (voice.listening || voice.interimTranscript.trim()) {
      setFormError(
        "Stop or discard dictation before saving this editable draft."
      );
      return;
    }
    try {
      const candidate = { ...form, link: form.link ? { ...form.link } : null };
      const accepted = onMutate(current =>
        saveObligation(current, candidate, status, adelaideTimestamp())
      );
      if (accepted === false) {
        setFormError("That change was not saved. Check sync and try again.");
        return;
      }
      setForm(null);
      setFormError("");
      toast.success(
        status === "active"
          ? "Obligation activated with one preparation task."
          : isNew
            ? "Draft saved."
            : "Changes saved as a draft; its open preparation task is held, not deleted."
      );
    } catch (error) {
      setFormError(errorText(error));
    }
  };

  const pay = (obligation: Obligation) => {
    if (readOnly) return;
    const recurring = obligation.cadence !== "none";
    const detail = recurring
      ? ` This will record this occurrence as paid and advance the next due date by its ${CADENCE_LABEL[obligation.cadence].toLowerCase()} cadence. It will not submit a payment.`
      : " This records the obligation as paid; it will not submit a payment or process the amount note.";
    const cancelBy = obligation.kind === "cancel-by";
    const question = cancelBy
      ? `Mark “${obligation.title}” done? Use this once you've cancelled it or decided to keep it (if you keep it, change its type to Renewal).`
      : `Confirm that “${obligation.title}” is paid?${detail}`;
    if (!window.confirm(question)) return;
    const expectedDueDate = obligation.dueDate;
    const accepted = onMutate(current =>
      markObligationPaid(
        current,
        obligation.id,
        expectedDueDate,
        day,
        adelaideTimestamp()
      )
    );
    if (accepted === false)
      toast.error("That was not saved. Check sync and try again.");
    else if (cancelBy) toast.success("Done.");
    else
      toast.success(
        recurring
          ? "Paid recorded; the next occurrence is ready."
          : "Paid recorded."
      );
  };

  const saveDraft = () => {
    if (!form) return;
    if (!isNew && form.status === "active") {
      if (
        !window.confirm(
          "Move this obligation back to draft? Any open preparation task will be moved to Held, not deleted."
        )
      )
        return;
    }
    save("draft");
  };

  const activate = () => {
    if (!form) return;
    const prepDate = preparationDateFor(form);
    if (
      !window.confirm(
        `Activate “${form.title.trim()}”? This creates one preparation task with a target date of ${dayLabel(prepDate)}. It does not mark the obligation paid.`
      )
    )
      return;
    save("active");
  };

  const statusCount = {
    active: obligations.filter(item => item.status === "active").length,
    draft: obligations.filter(item => item.status === "draft").length,
    paid: obligations.filter(item => item.status === "paid").length,
  };
  const pillars = (workspace.goals ?? []).filter(
    goal =>
      goal.level === "pillar" &&
      (goal.status === "active" ||
        (form?.link?.kind === "pillar" && form.link.id === goal.id))
  );
  const imperatives = (workspace.imperatives ?? []).filter(
    imperative =>
      imperative.status === "active" ||
      (form?.link?.kind === "imperative" && form.link.id === imperative.id)
  );
  const speechPending = voice.listening || !!voice.interimTranscript.trim();

  return (
    <section className="obligations-view" aria-labelledby="obligations-title">
      <header className="page-heading obligations-heading">
        <div>
          <div className="eyebrow">MY LIFE · DATES THAT NEED ACTION</div>
          <h1 id="obligations-title">Obligations</h1>
          <p>
            Keep a due date linked to a Pillar or Imperative, then choose when
            preparation should begin. Completing preparation is not the same as
            marking an obligation paid.
          </p>
        </div>
        <button
          className="button primary"
          onClick={openNew}
          disabled={readOnly}
        >
          <Plus size={16} /> Add obligation
        </button>
      </header>

      <div className="notice small obligation-scope-note">
        This is a personal register and reminder aid, not a payment service or
        accounting system. Amounts are notes only; Steadier does not verify,
        submit, reconcile or compare money.
      </div>

      <div className="obligation-scan-row">
        <ScanBillPanel day={day} readOnly={readOnly} onMutate={onMutate} />
        <label className="check-row small obligation-ai-amounts">
          <input
            type="checkbox"
            checked={amountsHiddenFromAI(workspace)}
            disabled={readOnly}
            onChange={event => {
              const hide = event.target.checked;
              const accepted = onMutate(current => ({
                ...current,
                hideAmountsFromAI: hide,
              }));
              if (accepted === false)
                toast.error("That wasn't saved. Check sync and try again.");
            }}
          />
          Hide amounts from AI (Claude can't see or add amounts)
        </label>
      </div>

      {readOnly && (
        <div className="notice small" role="status">
          This workspace is read-only while its shared data is loading or needs
          recovery. You can review obligations, but changes are disabled.
        </div>
      )}

      <div className="obligation-counts" aria-label="Obligation counts">
        <span>{statusCount.active} active</span>
        <span>{statusCount.draft} drafts</span>
        <span>{statusCount.paid} paid</span>
      </div>

      {form && (
        <section
          className="settings-section obligation-editor"
          aria-labelledby="obligation-form-title"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                {isNew ? "NEW RECORD" : "EDIT RECORD"}
              </div>
              <h2 id="obligation-form-title">
                {isNew ? "Capture an obligation" : `Edit ${form.title}`}
              </h2>
            </div>
          </div>
          <p className="small muted">
            Dictation is optional. Spoken words fill an editable draft only;
            they are not saved until you choose a button below.
          </p>
          <label className="field">
            Name
            <div className="obligation-name-input">
              <input
                value={form.title}
                maxLength={300}
                onChange={event => change("title", event.target.value)}
                placeholder="e.g. Car insurance renewal"
                disabled={readOnly}
              />
              {voice.supported && (
                <button
                  type="button"
                  className={`button ${voice.listening ? "listening" : "secondary"} small-button`}
                  onClick={dictateName}
                  disabled={readOnly}
                  aria-label={
                    voice.listening ? "Stop dictation" : "Speak obligation name"
                  }
                >
                  {voice.listening ? <Square size={14} /> : <Mic size={14} />}
                  {voice.listening ? "Stop" : "Speak"}
                </button>
              )}
            </div>
          </label>
          {voice.listening && (
            <p className="small muted" role="status">
              Listening. Nothing will be saved automatically.
              {voice.interimTranscript ? ` “${voice.interimTranscript}”` : ""}
            </p>
          )}
          {!voice.supported && (
            <p className="small muted">
              Speech recognition is unavailable in this browser; you can type
              the name.
            </p>
          )}

          <div className="obligation-form-grid">
            <label className="field">
              Type
              <select
                value={form.kind}
                onChange={event => {
                  const kind = event.target.value as ObligationKind;
                  setForm(current => {
                    if (!current) return current;
                    const followDefault =
                      isNew &&
                      current.leadTimeDays === defaultLeadTimeDays(current.kind);
                    return {
                      ...current,
                      kind,
                      leadTimeDays: followDefault
                        ? defaultLeadTimeDays(kind)
                        : current.leadTimeDays,
                      nextAction:
                        kind === "cancel-by" && !current.nextAction.trim()
                          ? `Decide: keep or cancel ${current.title.trim() || "it"}`
                          : current.nextAction,
                    };
                  });
                  setFormError("");
                }}
                disabled={readOnly}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {form.kind === "cancel-by" ? "Cancel by" : "Due date"}
              <input
                type="date"
                value={form.dueDate}
                onChange={event => {
                  const dueDate = event.target.value;
                  setForm(current =>
                    current
                      ? {
                          ...current,
                          dueDate,
                          cadenceAnchorDate: dueDate || null,
                        }
                      : current
                  );
                  setFormError("");
                }}
                disabled={readOnly}
              />
            </label>
            <label className="field">
              Preparation lead time (days)
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                value={form.leadTimeDays}
                onChange={event =>
                  change("leadTimeDays", Number(event.target.value))
                }
                disabled={readOnly}
              />
            </label>
            <label className="field">
              Cadence
              <select
                value={form.cadence}
                onChange={event =>
                  change("cadence", event.target.value as ObligationCadence)
                }
                disabled={readOnly}
              >
                {Object.entries(CADENCE_LABEL).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field obligation-link-field">
              Link to a Pillar or Imperative
              <select
                value={linkValue(form.link)}
                onChange={event =>
                  change("link", parseLink(event.target.value))
                }
                disabled={readOnly}
              >
                <option value="">Not linked (draft only)</option>
                {pillars.map(goal => (
                  <option key={`pillar-${goal.id}`} value={`pillar|${goal.id}`}>
                    Pillar · {goal.title}
                    {goal.status === "retired" ? " (retired)" : ""}
                  </option>
                ))}
                {imperatives.map(imperative => (
                  <option
                    key={`imperative-${imperative.id}`}
                    value={`imperative|${imperative.id}`}
                  >
                    Imperative · {imperative.title}
                    {imperative.status === "retired" ? " (retired)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Amount due (optional note)
              <input
                value={form.amountDue ?? ""}
                maxLength={100}
                onChange={event =>
                  change("amountDue", event.target.value || null)
                }
                placeholder="Text only; not calculated"
                disabled={readOnly}
              />
            </label>
          </div>
          <label className="field">
            Next action
            <textarea
              rows={2}
              maxLength={2000}
              value={form.nextAction}
              onChange={event => change("nextAction", event.target.value)}
              placeholder="e.g. Check the renewal notice and compare cover"
              disabled={readOnly}
            />
            {form.status === "active" || (isNew && form.link) ? null : (
              <span className="small muted">Required before activation.</span>
            )}
          </label>
          <label className="field">
            Document or provider link (optional)
            <input
              type="url"
              inputMode="url"
              maxLength={2000}
              value={form.referenceUrl ?? ""}
              onChange={event =>
                change("referenceUrl", event.target.value || null)
              }
              placeholder="https://…"
              disabled={readOnly}
            />
            <span className="small muted">
              HTTPS links only; no sign-in details or credentials are stored.
            </span>
          </label>
          <div className="obligation-activation-note">
            <CalendarClock size={16} />
            <span>
              {form.link && form.nextAction.trim()
                ? `Activation will create one preparation task due ${dayLabel(preparationDateFor(form))}. The obligation due date remains ${dayLabel(form.dueDate)}.`
                : "Choose a Pillar or Imperative and add a next action to activate this record."}
            </span>
          </div>
          {formError && (
            <p className="error small" role="alert">
              {formError}
            </p>
          )}
          {voice.error && (
            <p className="error small" role="alert">
              {voice.error}
            </p>
          )}
          <div className="choice-row obligation-form-actions">
            <button className="text-button" type="button" onClick={closeForm}>
              Cancel
            </button>
            <span className="obligation-form-spacer" />
            <button
              className="button secondary"
              type="button"
              onClick={saveDraft}
              disabled={readOnly || speechPending || !form.title.trim()}
            >
              {isNew
                ? "Save draft"
                : form.status === "active"
                  ? "Move to draft"
                  : "Save draft"}
            </button>
            <button
              className="button primary"
              type="button"
              onClick={activate}
              disabled={
                readOnly ||
                speechPending ||
                !form.title.trim() ||
                !form.link ||
                !form.nextAction.trim()
              }
            >
              {form.status === "active" ? "Save changes" : "Save & activate"}
            </button>
          </div>
        </section>
      )}

      {obligations.length > 0 && (
        <label className="field accordion-search obligation-search">
          <span>Search obligations</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Name, action, Compass link or date"
          />
        </label>
      )}
      {ordered.length === 0 && !form ? (
        <section className="empty-state obligation-empty">
          <FileText size={30} />
          <h2>Keep the next due date visible.</h2>
          <p>
            Start with one bill, renewal, licence, insurance or tax date, or a
            cancel-by date for a trial. Scan a bill to fill it in from a photo. Save a
            draft first if you want to decide its Compass link or next action
            later.
          </p>
          <button
            className="button secondary"
            onClick={openNew}
            disabled={readOnly}
          >
            <Plus size={16} /> Add an obligation
          </button>
        </section>
      ) : visibleObligations.length === 0 && ordered.length > 0 ? (
        <div className="empty-state obligation-empty">
          <FileText size={26} />
          <h2>No obligations match this search.</h2>
          <p>Try another title, next action, link or due date.</p>
        </div>
      ) : (
        <div className="obligation-list">
          {obligationGroups.map(group => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
              count={group.items.length}
              collapsible={visibleObligations.length > 5}
              defaultOpen={["past-due", "due-today", "due-soon"].includes(
                group.key
              )}
              autoOpen={["past-due", "due-today", "due-soon"].includes(
                group.key
              )}
              revealToken={query && group.items.length ? query : ""}
              className="obligation-date-group"
            >
              <div className="obligation-group-list">
                {group.items.map(obligation => {
            const task = obligationPreparationTask(workspace, obligation);
            const prepDate = preparationDateFor(obligation);
            const overdue =
              obligation.status === "active" && obligation.dueDate < day;
            const linkLabel = obligation.link
              ? obligation.link.kind === "pillar"
                ? ((workspace.goals ?? []).find(
                    goal => goal.id === obligation.link?.id
                  )?.title ?? "Missing Pillar")
                : ((workspace.imperatives ?? []).find(
                    item => item.id === obligation.link?.id
                  )?.title ?? "Missing Imperative")
              : "Not linked";
            return (
              <article
                className={`settings-section obligation-card obligation-${obligation.status}${obligation.suggestedBy === "claude" ? " is-suggested" : ""}`}
                key={obligation.id}
              >
                <div className="obligation-card-heading">
                  <div>
                    <div className="eyebrow">
                      {KIND_LABEL[obligation.kind]} ·{" "}
                      {CADENCE_LABEL[obligation.cadence]}
                    </div>
                    <h2>{obligation.title}</h2>
                  </div>
                  <div className="obligation-card-actions">
                    {obligation.status !== "paid" && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Edit ${obligation.title}`}
                        onClick={() => openEdit(obligation)}
                        disabled={readOnly}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {obligation.suggestedBy === "claude" && (
                      <span className="state-tag obligation-suggested">
                        Suggested by Claude · confirm
                      </span>
                    )}
                    <span
                      className={`state-tag obligation-status obligation-status-${obligation.status}`}
                    >
                      {obligation.status === "paid"
                        ? obligation.kind === "cancel-by"
                          ? "Done"
                          : "Paid"
                        : obligation.status === "draft"
                          ? "Draft"
                          : overdue
                            ? "Past due · unpaid"
                            : "Active · unpaid"}
                    </span>
                  </div>
                </div>
                <div className="obligation-card-details">
                  <span>
                    <strong>
                      {obligation.kind === "cancel-by" ? "Cancel by" : "Due"}
                    </strong>{" "}
                    {dayLabel(obligation.dueDate)}
                  </span>
                  <span>
                    <strong>Prepare from</strong> {dayLabel(prepDate)} (
                    {obligation.leadTimeDays} day
                    {obligation.leadTimeDays === 1 ? "" : "s"})
                  </span>
                  <span>
                    <strong>Linked to</strong>{" "}
                    {obligation.link?.kind === "pillar"
                      ? "Pillar"
                      : obligation.link?.kind === "imperative"
                        ? "Imperative"
                        : "—"}{" "}
                    · {linkLabel}
                  </span>
                  {obligation.amountDue && (
                    <span>
                      <strong>Amount note</strong> {obligation.amountDue}
                    </span>
                  )}
                </div>
                {obligation.nextAction && (
                  <p className="obligation-next-action">
                    <strong>Next action:</strong> {obligation.nextAction}
                  </p>
                )}
                {obligation.referenceUrl && (
                  <a
                    className="text-button obligation-reference"
                    href={obligation.referenceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                          <ExternalLink size={14} /> Open document or provider
                          link
                  </a>
                )}
                {obligation.lastPaidOn && (
                  <p className="small muted">
                          Last marked paid {dayLabel(obligation.lastPaidOn)} for
                          the occurrence due{" "}
                          {dayLabel(
                            obligation.lastPaidDueDate ?? obligation.dueDate
                          )}
                    .
                  </p>
                )}
                {obligation.status === "active" && (
                  <div className="obligation-prep-row">
                    {task ? (
                      <>
                        <span className="small muted">
                          <CheckCircle2 size={15} /> Preparation{" "}
                          {task.state === "done"
                            ? "complete — obligation remains unpaid until confirmed"
                            : task.obligation?.active === false
                              ? "held"
                              : `task · target ${dayLabel(prepDate)}`}
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => onOpenTask(task)}
                        >
                          <TimingShapeMark task={task} /> Open preparation task
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="small muted">
                          Preparation task missing; obligation data is
                          unchanged.
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          disabled={readOnly}
                          onClick={() => {
                            const accepted = onMutate(current =>
                                    restorePreparationTask(
                                      current,
                                      obligation.id
                                    )
                            );
                            if (accepted === false)
                              toast.error(
                                "The task could not be restored. Check sync and try again."
                              );
                                  else
                                    toast.success("Preparation task restored.");
                          }}
                        >
                          <RotateCcw size={14} /> Recreate task
                        </button>
                      </>
                    )}
                  </div>
                )}
                {obligation.status === "active" && (
                  <div className="obligation-footer-actions">
                    <button
                      type="button"
                      className="button secondary small-button"
                      onClick={() => pay(obligation)}
                      disabled={readOnly}
                    >
                      {obligation.kind === "cancel-by" ? "Done…" : "Mark paid…"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
            </AccordionSection>
          ))}
        </div>
      )}
    </section>
  );
}
