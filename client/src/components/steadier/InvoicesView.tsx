import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Download,
  FileText,
  History,
  Mic,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  availableInvoiceFinancialYears,
  calculateInvoiceTotals,
  canIssueInvoice,
  emptyInvoiceDraft,
  emptyInvoiceSettings,
  formatAbn,
  invoicesAnnualCsv,
  isValidAbn,
  isGstConfirmationCurrent,
  MAX_INVOICE_DESCRIPTION_LENGTH,
  MAX_INVOICE_JOB_REFERENCE_LENGTH,
  MAX_INVOICE_REASON_LENGTH,
  issueInvoiceDraft,
  createInvoiceDraft,
  normalizeInvoiceDraft,
  reviseIssuedInvoice,
  saveInvoiceSettings,
  updateInvoiceDraft,
  voidInvoice,
} from "../../domain/invoices";
import {
  invoiceDeliveryState,
  invoicePaymentActivityAnnualCsv,
  invoicePaymentState,
  invoicePaymentSummary,
  recordInvoiceDeliveryAttempt,
  recordInvoicePayment,
  reverseInvoicePayment,
} from "../../domain/invoiceActivity";
import type {
  InvoiceDeliveryInput,
  InvoiceDeliveryState,
  InvoicePaymentInput,
  InvoicePaymentState,
} from "../../domain/invoiceActivity";
import type {
  InvoiceDraft,
  InvoiceGstMode,
  InvoiceRecord,
  InvoiceSettings,
  InvoiceVersion,
  Workspace,
} from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import InvoiceActivityDialog from "./InvoiceActivityDialog";
import InvoiceVoiceField from "./InvoiceVoiceField";

interface Props {
  workspace: Workspace;
  day: string;
  readOnly: boolean;
  onMutate: (update: (workspace: Workspace) => Workspace) => boolean;
  voice: VoiceControls;
}

type InvoiceFormLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type InvoiceFormDraft = Omit<
  InvoiceDraft,
  "lines" | "dueDate" | "jobReference"
> & {
  dueDate: string;
  jobReference: string;
  lines: InvoiceFormLine[];
};

type EditorMode = "new" | "draft" | "correction";

interface EditorState {
  mode: EditorMode;
  recordId: string | null;
  initial: InvoiceDraft;
  gstMode: InvoiceGstMode;
}

interface PrintState {
  version: InvoiceVersion;
  recordStatus: InvoiceRecord["status"];
  voidedAt: string | null;
  voidReason: string | null;
}
type DeliveryFilter =
  | "all"
  | "not-applicable"
  | Exclude<InvoiceDeliveryState, null>;
type PaymentFilter =
  | "all"
  | "not-applicable"
  | Exclude<InvoicePaymentState, null>;
interface ActivityTarget {
  recordId: string;
  version: number;
}

function toFormDraft(draft: InvoiceDraft): InvoiceFormDraft {
  return {
    issueDate: draft.issueDate,
    dueDate: draft.dueDate ?? "",
    customerName: draft.customerName,
    customerAddress: draft.customerAddress,
    customerAbn: draft.customerAbn,
    jobReference: draft.jobReference ?? "",
    lines: draft.lines.map(line => ({
      id: line.id,
      description: line.description,
      quantity: line.quantityMilli ? String(line.quantityMilli / 1000) : "",
      unitPrice: line.unitPriceCents
        ? (line.unitPriceCents / 100).toFixed(2)
        : "",
    })),
  };
}

function parseQuantity(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(text)) return null;
  const result = Math.round(Number(text) * 1000);
  return Number.isSafeInteger(result) && result <= 1_000_000_000
    ? result
    : null;
}

function parseUnitPrice(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
  const result = Math.round(Number(text) * 100);
  return Number.isSafeInteger(result) ? result : null;
}

function fromFormDraft(form: InvoiceFormDraft): InvoiceDraft | null {
  const lines: InvoiceDraft["lines"] = [];
  for (const line of form.lines) {
    const quantityMilli = parseQuantity(line.quantity);
    const unitPriceCents = parseUnitPrice(line.unitPrice);
    if (quantityMilli === null || unitPriceCents === null) return null;
    lines.push({
      id: line.id,
      description: line.description,
      quantityMilli,
      unitPriceCents,
    });
  }
  return normalizeInvoiceDraft(
    {
      issueDate: form.issueDate,
      dueDate: form.dueDate || null,
      customerName: form.customerName,
      customerAddress: form.customerAddress,
      customerAbn: form.customerAbn,
      jobReference: form.jobReference,
      lines,
    },
    false
  );
}

function displayDate(value: string | null): string {
  if (!value) return "Not set";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date not recorded";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  );
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function settingsComplete(settings: InvoiceSettings | undefined): boolean {
  return Boolean(
    settings?.supplierName.trim() &&
      settings.supplierAddress.trim() &&
      isValidAbn(settings.supplierAbn)
  );
}

function invoiceVersionDraft(version: InvoiceVersion): InvoiceDraft {
  return {
    issueDate: version.issueDate,
    dueDate: version.dueDate,
    customerName: version.customerName,
    customerAddress: version.customerAddress,
    customerAbn: version.customerAbn,
    jobReference: version.jobReference ?? "",
    lines: version.lines.map(line => ({ ...line })),
  };
}

function createCsvDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function InvoiceEditor({
  mode,
  initial,
  gstMode,
  settings,
  readOnly,
  voice,
  onClose,
  onSaveDraft,
  onIssue,
  onCorrect,
  onRestoreFocus,
}: {
  mode: EditorMode;
  initial: InvoiceDraft;
  gstMode: InvoiceGstMode;
  settings?: InvoiceSettings;
  readOnly: boolean;
  voice: VoiceControls;
  onClose: () => void;
  onSaveDraft: (draft: InvoiceDraft) => void;
  onIssue: (draft: InvoiceDraft) => void;
  onCorrect: (draft: InvoiceDraft, reason: string) => void;
  onRestoreFocus: () => void;
}) {
  const [form, setForm] = useState<InvoiceFormDraft>(() =>
    toFormDraft(initial)
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [error, setError] = useState("");
  const [dictatingLineId, setDictatingLineId] = useState<string | null>(null);
  const [referenceDictationPending, setReferenceDictationPending] =
    useState(false);
  const draft = fromFormDraft(form);
  const totals = draft ? calculateInvoiceTotals(draft.lines, gstMode) : null;
  const complete =
    draft !== null && normalizeInvoiceDraft(draft, true) !== null;

  useEffect(() => {
    if (!dictatingLineId || voice.listening) return;
    const finalText = voice.finalTranscript.trim();
    if (finalText) {
      setForm(current => ({
        ...current,
        lines: current.lines.map(line =>
          line.id === dictatingLineId
            ? { ...line, description: finalText }
            : line
        ),
      }));
    }
    if (!finalText && !voice.error) {
      setError(
        "No final speech transcript was received. Interim words were discarded; type the description or try dictating again."
      );
    }
    const timer = window.setTimeout(() => setDictatingLineId(null), 200);
    return () => window.clearTimeout(timer);
  }, [dictatingLineId, voice.error, voice.finalTranscript, voice.listening]);

  useEffect(
    () => () => {
      voice.abort();
      voice.clear();
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  const updateField = <K extends keyof Omit<InvoiceFormDraft, "lines">>(
    key: K,
    value: InvoiceFormDraft[K]
  ) => setForm(current => ({ ...current, [key]: value }));

  const updateLine = (id: string, patch: Partial<InvoiceFormLine>) =>
    setForm(current => ({
      ...current,
      lines: current.lines.map(line =>
        line.id === id ? { ...line, ...patch } : line
      ),
    }));

  const toggleDictation = (lineId: string) => {
    if (referenceDictationPending) {
      setError("Finish or cancel the job-reference dictation first.");
      return;
    }
    if (!voice.supported) {
      setError("Voice dictation is not available in this browser.");
      return;
    }
    if (dictatingLineId === lineId && voice.listening) {
      voice.stop();
      return;
    }
    if (voice.listening) voice.abort();
    voice.clear();
    setError("");
    setDictatingLineId(lineId);
    voice.start();
  };

  const stopDictation = () => {
    voice.stop();
  };

  const checkedDraft = (): InvoiceDraft | null => {
    const parsed = fromFormDraft(form);
    if (!parsed) {
      setError("Check the dates, ABN and numeric amounts, then try again.");
      return null;
    }
    return parsed;
  };

  const saveDraft = () => {
    if (voice.listening || dictatingLineId || referenceDictationPending) {
      setError("Stop dictation and review the final transcript before saving.");
      return;
    }
    const parsed = checkedDraft();
    if (!parsed) return;
    setError("");
    onSaveDraft(parsed);
  };

  const issue = () => {
    if (voice.listening || dictatingLineId || referenceDictationPending) {
      setError(
        "Stop dictation and review the final transcript before issuing."
      );
      return;
    }
    const parsed = checkedDraft();
    if (!parsed) return;
    if (!complete) {
      setError(
        "Add a customer name and at least one complete line item before issuing."
      );
      return;
    }
    setError("");
    onIssue(parsed);
  };

  const correct = () => {
    if (voice.listening || dictatingLineId || referenceDictationPending) {
      setError(
        "Stop dictation and review the final transcript before saving a correction."
      );
      return;
    }
    const parsed = checkedDraft();
    if (!parsed) return;
    if (!complete || correctionReason.trim().length < 3) {
      setError(
        "A complete invoice and a clear correction reason are required."
      );
      return;
    }
    setError("");
    onCorrect(parsed, correctionReason.trim());
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="invoice-editor-dialog-content"
        showCloseButton={false}
        onCloseAutoFocus={event => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <section className="invoice-editor">
          <header className="invoice-editor-header">
            <div>
              <p className="invoice-kicker">
                {mode === "correction"
                  ? "PRESERVED REVISION"
                  : "PRIVATE INVOICE DRAFT"}
              </p>
              <DialogTitle id="invoice-editor-title">
                {mode === "new"
                  ? "New invoice"
                  : mode === "draft"
                    ? "Edit draft"
                    : "Correct issued invoice"}
              </DialogTitle>
            </div>
            <button
              type="button"
              className="invoice-icon-button"
              onClick={onClose}
              aria-label="Close editor"
            >
              <X size={18} />
            </button>
          </header>

          <div className="invoice-form-grid">
            <label>
              Issue date
              <input
                type="date"
                value={form.issueDate}
                onChange={event => updateField("issueDate", event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label>
              Due date <span className="invoice-optional">optional</span>
              <input
                type="date"
                value={form.dueDate}
                min={form.issueDate}
                onChange={event => updateField("dueDate", event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="invoice-form-wide">
              Customer name
              <input
                value={form.customerName}
                maxLength={200}
                onChange={event =>
                  updateField("customerName", event.target.value)
                }
                placeholder="Name or business"
                disabled={readOnly}
                required
              />
            </label>
            <label className="invoice-form-wide">
              Customer address{" "}
              <span className="invoice-optional">optional</span>
              <textarea
                value={form.customerAddress}
                maxLength={500}
                rows={2}
                onChange={event =>
                  updateField("customerAddress", event.target.value)
                }
                placeholder="Postal address"
                disabled={readOnly}
              />
            </label>
            <label className="invoice-form-wide">
              Customer ABN <span className="invoice-optional">optional</span>
              <input
                value={form.customerAbn}
                maxLength={16}
                onChange={event =>
                  updateField("customerAbn", event.target.value)
                }
                placeholder="11 digits, if supplied"
                disabled={readOnly}
              />
            </label>
            <div className="invoice-form-wide">
              <InvoiceVoiceField
                label="Job / reference (optional)"
                value={form.jobReference}
                onChange={value => updateField("jobReference", value)}
                voice={voice}
                maxLength={MAX_INVOICE_JOB_REFERENCE_LENGTH}
                placeholder="Purchase order, job name or project reference"
                disabled={readOnly}
                onPendingChange={setReferenceDictationPending}
                onStart={() => setDictatingLineId(null)}
                onAbort={() => setDictatingLineId(null)}
              />
            </div>
          </div>

          <div className="invoice-lines-heading">
            <div>
              <h3>Line items</h3>
              <p>
                Prices are AUD. GST follows the one global supplier setting.
              </p>
            </div>
            <button
              type="button"
              className="invoice-button invoice-button-secondary"
              onClick={() => {
                if (form.lines.length >= 50) return;
                setForm(current => ({
                  ...current,
                  lines: [
                    ...current.lines,
                    {
                      id: nanoid(),
                      description: "",
                      quantity: "1",
                      unitPrice: "",
                    },
                  ],
                }));
              }}
              disabled={readOnly || form.lines.length >= 50}
            >
              <Plus size={15} /> Add line
            </button>
          </div>

          <p className="invoice-voice-disclosure">
            Optional dictation is off until you tap a microphone. Your browser's
            speech provider may process audio; Steadier stores no audio. Only
            the finished transcript is copied into the editable field; interim
            words are discarded. Text is saved only when you explicitly save,
            issue or correct.
          </p>

          {form.lines.length === 0 ? (
            <p className="invoice-lines-empty">
              Add a line item to issue this invoice.
            </p>
          ) : (
            <div className="invoice-line-editor-list">
              {form.lines.map((line, index) => {
                const quantityMilli = parseQuantity(line.quantity);
                const unitPriceCents = parseUnitPrice(line.unitPrice);
                const lineTotalCents =
                  quantityMilli !== null &&
                  unitPriceCents !== null &&
                  quantityMilli > 0
                    ? Math.round((quantityMilli * unitPriceCents) / 1000)
                    : null;
                return (
                  <fieldset className="invoice-line-editor" key={line.id}>
                    <legend>Item {index + 1}</legend>
                    <label className="invoice-line-description">
                      Description
                      <textarea
                        value={line.description}
                        maxLength={MAX_INVOICE_DESCRIPTION_LENGTH}
                        rows={2}
                        onChange={event => {
                          if (dictatingLineId === line.id) {
                            voice.abort();
                            setDictatingLineId(null);
                          }
                          updateLine(line.id, {
                            description: event.target.value,
                          });
                        }}
                        disabled={readOnly}
                        placeholder="Work or goods supplied"
                      />
                    </label>
                    <div className="invoice-line-numbers">
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.quantity}
                          onChange={event =>
                            updateLine(line.id, {
                              quantity: event.target.value,
                            })
                          }
                          disabled={readOnly}
                        />
                      </label>
                      <label>
                        Unit price (AUD)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={event =>
                            updateLine(line.id, {
                              unitPrice: event.target.value,
                            })
                          }
                          disabled={readOnly}
                        />
                      </label>
                      <div className="invoice-line-total">
                        Line total
                        <strong>
                          {lineTotalCents === null
                            ? "—"
                            : formatMoney(lineTotalCents)}
                        </strong>
                      </div>
                      <div className="invoice-line-actions">
                        {voice.supported && (
                          <button
                            type="button"
                            className={`invoice-icon-button ${dictatingLineId === line.id && voice.listening ? "is-listening" : ""}`}
                            onClick={() => toggleDictation(line.id)}
                            disabled={readOnly}
                            aria-label={
                              dictatingLineId === line.id && voice.listening
                                ? "Stop dictation"
                                : "Dictate description"
                            }
                            title="Start dictation; edit the transcript before saving"
                          >
                            <Mic size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="invoice-icon-button"
                          onClick={() =>
                            setForm(current => ({
                              ...current,
                              lines: current.lines.filter(
                                item => item.id !== line.id
                              ),
                            }))
                          }
                          disabled={readOnly}
                          aria-label={`Remove draft item ${index + 1}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}

          {dictatingLineId && (
            <div className="invoice-voice-notice" role="status">
              {voice.listening
                ? "Listening. Interim words are not saved; stop or wait for a final result, then review and edit it."
                : "Voice capture stopped. Review and edit the transcript before saving."}
              {voice.listening && (
                <button type="button" onClick={stopDictation}>
                  Stop
                </button>
              )}
            </div>
          )}
          {voice.error && (
            <p className="invoice-form-error" role="status">
              {voice.error}
            </p>
          )}

          {mode === "correction" && (
            <label className="invoice-form-wide invoice-correction-reason">
              Why is this version being corrected?{" "}
              <span className="invoice-required">required</span>
              <textarea
                value={correctionReason}
                maxLength={MAX_INVOICE_REASON_LENGTH}
                rows={3}
                onChange={event => setCorrectionReason(event.target.value)}
                disabled={readOnly}
                placeholder="Record the reason. The prior issued version will be retained."
              />
            </label>
          )}

          {totals && (
            <div className="invoice-total-preview">
              <span>
                Subtotal <strong>{formatMoney(totals.subtotalCents)}</strong>
              </span>
              {gstMode !== "off" && (
                <span>
                  GST at 10% <strong>{formatMoney(totals.gstCents)}</strong>
                </span>
              )}
              <span className="invoice-total-final">
                Total <strong>{formatMoney(totals.totalCents)}</strong>
              </span>
            </div>
          )}

          {mode !== "correction" && gstMode !== "off" && (
            <p className="invoice-tax-note">
              GST is set globally for every line. Do not use this invoice
              profile for GST-free, input-taxed or mixed-treatment sales.
            </p>
          )}
          {error && (
            <p className="invoice-form-error" role="alert">
              {error}
            </p>
          )}

          <footer className="invoice-editor-footer">
            <button
              type="button"
              className="invoice-button invoice-button-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            {!readOnly && mode !== "correction" && (
              <>
                <button
                  type="button"
                  className="invoice-button invoice-button-secondary"
                  onClick={saveDraft}
                  disabled={
                    voice.listening ||
                    Boolean(dictatingLineId) ||
                    referenceDictationPending
                  }
                >
                  <Save size={15} /> Save draft
                </button>
                <button
                  type="button"
                  className="invoice-button invoice-button-primary"
                  onClick={issue}
                  disabled={
                    voice.listening ||
                    Boolean(dictatingLineId) ||
                    referenceDictationPending ||
                    !draft ||
                    !canIssueInvoice(draft, settings)
                  }
                  title="Complete the draft and save a supplier profile before issuing"
                >
                  Issue invoice
                </button>
              </>
            )}
            {!readOnly && mode === "correction" && (
              <button
                type="button"
                className="invoice-button invoice-button-primary"
                onClick={correct}
                disabled={
                  voice.listening ||
                  Boolean(dictatingLineId) ||
                  referenceDictationPending ||
                  !complete ||
                  correctionReason.trim().length < 3
                }
              >
                Save corrected version
              </button>
            )}
          </footer>
          {mode !== "correction" && !readOnly && (
            <p className="invoice-owner-action-note">
              Nothing is sent externally. Saving a draft does not issue it.
              Issuing saves a numbered, permanent invoice record.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function InvoicePrintSheet({ printState }: { printState: PrintState }) {
  const { version, recordStatus, voidedAt, voidReason } = printState;
  const inclusive = version.gstMode === "inclusive";
  const exclusive = version.gstMode === "exclusive";
  return (
    <article id="invoice-print-sheet" className="invoice-print-sheet">
      {recordStatus === "void" && (
        <div className="invoice-print-void">VOID RECORD — NOT FOR PAYMENT</div>
      )}
      <header className="invoice-print-header">
        <div>
          <p className="invoice-print-kicker">
            {version.gstMode === "off" ? "INVOICE" : "TAX INVOICE"}
          </p>
          <h1>{version.supplierName}</h1>
          <p className="invoice-print-multiline">{version.supplierAddress}</p>
          <p>ABN {formatAbn(version.supplierAbn)}</p>
        </div>
        <div className="invoice-print-id">
          <strong>{version.invoiceNumber}</strong>
          <span>
            {version.version > 1
              ? `Revision ${version.version}`
              : "Issued copy"}
          </span>
          <span>Issue date: {displayDate(version.issueDate)}</span>
          {version.dueDate && (
            <span>Due date: {displayDate(version.dueDate)}</span>
          )}
        </div>
      </header>
      <section className="invoice-print-customer">
        <p className="invoice-print-kicker">BILL TO</p>
        <strong>{version.customerName}</strong>
        {version.customerAddress && (
          <p className="invoice-print-multiline">{version.customerAddress}</p>
        )}
        {version.customerAbn && <p>ABN {formatAbn(version.customerAbn)}</p>}
        {version.jobReference && (
          <p>
            <strong>Job / reference:</strong> {version.jobReference}
          </p>
        )}
      </section>
      <table className="invoice-print-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Unit price</th>
            <th>Line total</th>
          </tr>
        </thead>
        <tbody>
          {version.lines.map(line => {
            const lineCents = Math.round(
              (line.quantityMilli * line.unitPriceCents) / 1000
            );
            return (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{(line.quantityMilli / 1000).toLocaleString("en-AU")}</td>
                <td>{formatMoney(line.unitPriceCents)}</td>
                <td>{formatMoney(lineCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <section className="invoice-print-totals">
        <div>
          <span>{inclusive ? "Subtotal (ex GST)" : "Subtotal"}</span>
          <strong>{formatMoney(version.subtotalCents)}</strong>
        </div>
        {version.gstMode !== "off" && (
          <div>
            <span>GST 10% {inclusive ? "(included)" : "(added)"}</span>
            <strong>{formatMoney(version.gstCents)}</strong>
          </div>
        )}
        <div className="invoice-print-grand-total">
          <span>Total AUD</span>
          <strong>{formatMoney(version.totalCents)}</strong>
        </div>
      </section>
      {exclusive && (
        <p className="invoice-print-tax-footnote">
          GST of 10% has been added to all listed items.
        </p>
      )}
      {inclusive && (
        <p className="invoice-print-tax-footnote">
          The listed prices include 10% GST on all items.
        </p>
      )}
      {version.correctionReason && (
        <section className="invoice-print-correction">
          <strong>Corrected version {version.version}</strong>
          <p>{version.correctionReason}</p>
          <p>
            This version is linked to {version.invoiceNumber}; earlier issued
            versions remain in the Steadier record history.
          </p>
        </section>
      )}
      {recordStatus === "void" && (
        <section className="invoice-print-correction">
          <strong>Voided record</strong>
          <p>
            Voided{" "}
            {voidedAt
              ? displayDate(voidedAt.slice(0, 10))
              : "date not recorded"}
            . {voidReason}
          </p>
          <p>
            Voiding in Steadier preserves this record; it is not a credit note
            or adjustment note.
          </p>
        </section>
      )}
      <footer className="invoice-print-footer">
        Issued {displayDate(version.issuedAt.slice(0, 10))} · AUD ·
        Australia/Adelaide date
      </footer>
    </article>
  );
}

export default function InvoicesView({
  workspace,
  day,
  readOnly,
  onMutate,
  voice,
}: Props) {
  const records = workspace.invoices ?? [];
  const storedSettings = workspace.invoiceSettings;
  const [settingsOpen, setSettingsOpen] = useState(
    !settingsComplete(storedSettings)
  );
  const [settingsDraft, setSettingsDraft] = useState<InvoiceSettings>(
    () => storedSettings ?? emptyInvoiceSettings(adelaideTimestamp())
  );
  const [gstConfirmed, setGstConfirmed] = useState(
    Boolean(
      storedSettings?.gstMode !== "off" &&
        storedSettings?.gstConfirmedAt &&
        isGstConfirmationCurrent(storedSettings)
    )
  );
  const [settingsError, setSettingsError] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const voidTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [printState, setPrintState] = useState<PrintState | null>(null);
  const [financialYear, setFinancialYear] = useState(
    () => availableInvoiceFinancialYears(day, records)[0] ?? ""
  );
  const [includeHistory, setIncludeHistory] = useState(false);
  const [filter, setFilter] = useState<"all" | "draft" | "issued" | "void">(
    "all"
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [activityTarget, setActivityTarget] = useState<ActivityTarget | null>(
    null
  );
  const yearOptions = useMemo(
    () => availableInvoiceFinancialYears(day, records),
    [day, records]
  );

  const restoreFocus = (trigger: HTMLButtonElement | null) => {
    if (trigger?.isConnected) trigger.focus();
    else pageHeadingRef.current?.focus();
  };

  useEffect(() => {
    if (!storedSettings) return;
    setSettingsDraft(storedSettings);
    setGstConfirmed(
      Boolean(
        storedSettings.gstMode !== "off" &&
          storedSettings.gstConfirmedAt &&
          isGstConfirmationCurrent(storedSettings)
      )
    );
  }, [storedSettings]);

  useEffect(() => {
    if (!printState) return;
    const oldTitle = document.title;
    document.title = `${printState.version.invoiceNumber}-v${printState.version.version}`;
    const timer = window.setTimeout(() => window.print(), 250);
    const afterPrint = () => {
      document.title = oldTitle;
      setPrintState(null);
    };
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", afterPrint);
      document.title = oldTitle;
    };
  }, [printState]);

  const visibleRecords = useMemo(() => {
    const query = searchTerm.trim().normalize("NFC").toLocaleLowerCase("en-AU");
    return [...records]
      .filter(record => {
        if (filter !== "all" && record.status !== filter) return false;
        const paymentState =
          invoicePaymentState(record, day) ?? "not-applicable";
        const deliveryState = invoiceDeliveryState(record) ?? "not-applicable";
        if (paymentFilter !== "all" && paymentState !== paymentFilter) {
          return false;
        }
        if (deliveryFilter !== "all" && deliveryState !== deliveryFilter) {
          return false;
        }
        if (!query) return true;
        const searchable = [
          record.invoiceNumber ?? "",
          record.draft.customerName,
          record.draft.jobReference ?? "",
          ...record.draft.lines.map(line => line.description),
          ...record.versions.flatMap(version => [
            version.invoiceNumber,
            version.customerName,
            version.jobReference ?? "",
            ...version.lines.map(line => line.description),
          ]),
        ];
        return searchable.some(value =>
          value.normalize("NFC").toLocaleLowerCase("en-AU").includes(query)
        );
      })
      .sort((left, right) => {
        const leftDate =
          left.versions.at(-1)?.issueDate ?? left.draft.issueDate;
        const rightDate =
          right.versions.at(-1)?.issueDate ?? right.draft.issueDate;
        return (
          rightDate.localeCompare(leftDate) ||
          right.createdAt.localeCompare(left.createdAt)
        );
      });
  }, [records, filter, searchTerm, deliveryFilter, paymentFilter, day]);
  const invoiceGroups = useMemo(
    () =>
      groupByStable(visibleRecords, record =>
        monthGroup(record.versions.at(-1)?.issueDate ?? record.draft.issueDate)
      ),
    [visibleRecords]
  );

  const updateSupplierField = (
    field: "supplierName" | "supplierAddress" | "supplierAbn",
    value: string
  ) => {
    const profileChanged = settingsDraft[field] !== value;
    if (profileChanged && settingsDraft.gstMode !== "off") {
      setGstConfirmed(false);
      setSettingsDraft(current => ({
        ...current,
        [field]: value,
        gstConfirmedAt: null,
        gstConfirmedProfile: null,
      }));
      return;
    }
    setSettingsDraft(current => ({ ...current, [field]: value }));
  };

  const persistSettings = () => {
    const at = adelaideTimestamp();
    const gstMode = settingsDraft.gstMode;
    if (gstMode !== "off" && !gstConfirmed) {
      setSettingsError(
        "Confirm GST registration and that every invoice line will be standard-rated before enabling GST."
      );
      return;
    }
    const next: InvoiceSettings = {
      ...settingsDraft,
      supplierAbn: settingsDraft.supplierAbn.replace(/[\s-]/g, ""),
      gstConfirmedAt: gstMode === "off" ? null : at,
      gstConfirmedProfile:
        gstMode === "off"
          ? null
          : {
              supplierName: settingsDraft.supplierName.trim().normalize("NFC"),
              supplierAddress: settingsDraft.supplierAddress
                .trim()
                .normalize("NFC"),
              supplierAbn: settingsDraft.supplierAbn.replace(/[\s-]/g, ""),
            },
      updatedAt: at,
    };
    if (next.supplierAbn && !isValidAbn(next.supplierAbn)) {
      setSettingsError(
        "Enter a valid 11-digit ABN checksum. This does not verify registration with the ABR."
      );
      return;
    }
    if (
      gstMode !== "off" &&
      (!next.supplierName.trim() ||
        !next.supplierAddress.trim() ||
        !next.supplierAbn)
    ) {
      setSettingsError(
        "Add the business name, address and ABN before enabling GST."
      );
      return;
    }
    let changed = false;
    const accepted = onMutate(current => {
      const updated = saveInvoiceSettings(current, next, at);
      changed = updated !== current;
      return updated;
    });
    if (!accepted || !changed) {
      setSettingsError(
        "Invoice settings were not saved. Check sync and try again."
      );
      return;
    }
    setSettingsDraft(next);
    setSettingsError("");
    setSettingsStatus("Supplier and GST settings saved.");
    setSettingsOpen(false);
  };

  const openNew = (trigger?: HTMLButtonElement) => {
    if (trigger) editorTriggerRef.current = trigger;
    setStatusMessage("");
    setEditor({
      mode: "new",
      recordId: null,
      initial: emptyInvoiceDraft(day),
      gstMode: storedSettings?.gstMode ?? "off",
    });
  };

  const openDraft = (record: InvoiceRecord, trigger?: HTMLButtonElement) => {
    if (trigger) editorTriggerRef.current = trigger;
    setEditor({
      mode: "draft",
      recordId: record.id,
      initial: record.draft,
      gstMode: storedSettings?.gstMode ?? "off",
    });
  };

  const openCorrection = (
    record: InvoiceRecord,
    trigger?: HTMLButtonElement
  ) => {
    if (trigger) editorTriggerRef.current = trigger;
    const latest = record.versions.at(-1);
    if (!latest || record.status !== "issued") return;
    setEditor({
      mode: "correction",
      recordId: record.id,
      initial: invoiceVersionDraft(latest),
      gstMode: latest.gstMode,
    });
  };

  const saveDraft = (draft: InvoiceDraft) => {
    const at = adelaideTimestamp();
    const newId = editor?.recordId ?? nanoid();
    let changed = false;
    const accepted = onMutate(current => {
      const next = editor?.recordId
        ? updateInvoiceDraft(current, newId, draft, at)
        : createInvoiceDraft(current, draft, newId, at);
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage("Draft was not saved. Check sync and try again.");
      return;
    }
    setEditor(null);
    setStatusMessage("Draft saved. It has not been issued or sent.");
  };

  const issueDraft = (draft: InvoiceDraft) => {
    if (!storedSettings || !canIssueInvoice(draft, storedSettings)) {
      setStatusMessage(
        "Complete the supplier profile, ABN, customer name and line items before issuing."
      );
      return;
    }
    const at = adelaideTimestamp();
    const id = editor?.recordId ?? nanoid();
    let issued = false;
    const accepted = onMutate(current => {
      const withDraft = editor?.recordId
        ? updateInvoiceDraft(current, id, draft, at)
        : createInvoiceDraft(current, draft, id, at);
      if (withDraft === current && !editor?.recordId) return current;
      const next = issueInvoiceDraft(withDraft, id, at);
      issued = next !== withDraft;
      return issued ? next : current;
    });
    if (!accepted || !issued) {
      setStatusMessage(
        "Invoice was not issued. Check the supplier profile and sync, then try again."
      );
      return;
    }
    setEditor(null);
    setStatusMessage(
      "Invoice issued and numbered. It has not been emailed or sent."
    );
  };

  const saveCorrection = (draft: InvoiceDraft, reason: string) => {
    if (!editor?.recordId) return;
    const at = adelaideTimestamp();
    let changed = false;
    const accepted = onMutate(current => {
      const next = reviseIssuedInvoice(
        current,
        editor.recordId!,
        draft,
        reason,
        at
      );
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage(
        "Correction was not saved. Check that the issued record is still current and sync is available."
      );
      return;
    }
    setEditor(null);
    setStatusMessage(
      "Corrected version saved. The previously issued copy remains in history."
    );
  };

  const confirmVoid = () => {
    if (!voidTarget) return;
    if (voidReason.trim().length < 3) {
      setVoidError("Give a short reason to preserve with the record.");
      return;
    }
    const at = adelaideTimestamp();
    let changed = false;
    const accepted = onMutate(current => {
      const next = voidInvoice(current, voidTarget.id, voidReason, at);
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setVoidError("This record was not voided. Check sync and try again.");
      return;
    }
    setVoidTarget(null);
    setVoidReason("");
    setVoidError("");
    setStatusMessage(
      "Record marked void. It was retained and its number will not be reused."
    );
  };

  const commitInvoiceActivity = (
    recordId: string,
    expectedVersion: number,
    update: (current: Workspace) => Workspace,
    successMessage: string
  ): boolean => {
    let changed = false;
    let stale = false;
    const accepted = onMutate(current => {
      const record = current.invoices?.find(invoice => invoice.id === recordId);
      if (
        record?.status !== "issued" ||
        record.versions.at(-1)?.version !== expectedVersion
      ) {
        stale = true;
        return current;
      }
      const next = update(current);
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage(
        stale
          ? "Activity was not saved because the invoice changed. Close this dialog and reopen it for the current version."
          : "Activity was not saved. Check the amount, date and sync state, then try again."
      );
      return false;
    }
    setStatusMessage(successMessage);
    return true;
  };

  const saveDeliveryAttempt = (
    recordId: string,
    input: InvoiceDeliveryInput,
    expectedVersion: number
  ) => {
    const at = adelaideTimestamp();
    return commitInvoiceActivity(
      recordId,
      expectedVersion,
      current =>
        recordInvoiceDeliveryAttempt(
          current,
          recordId,
          input,
          nanoid(),
          at,
          day
        ),
      "Manual delivery attempt recorded. Steadier did not send an email."
    );
  };

  const savePayment = (
    recordId: string,
    input: InvoicePaymentInput,
    expectedVersion: number
  ) => {
    const at = adelaideTimestamp();
    return commitInvoiceActivity(
      recordId,
      expectedVersion,
      current =>
        recordInvoicePayment(current, recordId, input, nanoid(), at, day),
      "Payment entry recorded. No money was processed or transferred."
    );
  };

  const savePaymentReversal = (
    recordId: string,
    paymentId: string,
    input: InvoicePaymentInput,
    expectedVersion: number
  ) => {
    const at = adelaideTimestamp();
    return commitInvoiceActivity(
      recordId,
      expectedVersion,
      current =>
        reverseInvoicePayment(
          current,
          recordId,
          paymentId,
          input,
          nanoid(),
          at,
          day
        ),
      "Reversal recorded; the original receipt remains in the invoice history."
    );
  };

  const exportAnnualCsv = () => {
    const csv = invoicesAnnualCsv(records, financialYear, includeHistory);
    if (!csv) {
      setStatusMessage("Choose a valid Australian financial year.");
      return;
    }
    createCsvDownload(csv, `steadier-invoices-FY${financialYear}.csv`);
    setStatusMessage(
      `Annual CSV prepared for FY ${financialYear}. No tax return was created or lodged.`
    );
  };

  const exportPaymentActivityCsv = () => {
    const csv = invoicePaymentActivityAnnualCsv(records, financialYear);
    if (!csv) {
      setStatusMessage("Choose a valid Australian financial year.");
      return;
    }
    createCsvDownload(csv, `steadier-invoice-payments-FY${financialYear}.csv`);
    setStatusMessage(
      `Payment and reversal events prepared for FY ${financialYear}, by event date. This is not a tax or accounting report.`
    );
  };

  const printVersion = (record: InvoiceRecord, version: InvoiceVersion) => {
    setPrintState({
      version,
      recordStatus: record.status,
      voidedAt: record.voidedAt,
      voidReason: record.voidReason,
    });
  };

  const gstModeLabel = (mode: InvoiceGstMode) =>
    mode === "exclusive"
      ? "10% GST added to prices"
      : mode === "inclusive"
        ? "Prices include 10% GST"
        : "GST off";

  const activityRecord = activityTarget
    ? records.find(record => record.id === activityTarget.recordId)
    : undefined;

  return (
    <div className="invoices-view">
      <div className="invoices-page-header">
        <div>
          <p className="invoice-kicker">PRIVATE BUSINESS RECORDS · AUSTRALIA</p>
          <h1 ref={pageHeadingRef} tabIndex={-1}>
            Invoices
          </h1>
          <p>
            Make a PDF record, keep every version, and export the year's line
            details.
          </p>
        </div>
        <button
          type="button"
          className="invoice-button invoice-button-primary"
          onClick={event => openNew(event.currentTarget)}
          disabled={readOnly || records.length >= 5000}
        >
          <Plus size={16} /> New invoice
        </button>
      </div>

      <div className="invoice-boundary-notice">
        <ShieldCheck size={18} />
        <p>
          Stored in the shared Workspace and normal sync/backups. Supplier,
          customer and invoice data are excluded from Claude/ChatGPT context and
          Server sheet exports. You may log manually reported delivery attempts,
          receipts and reversals; Steadier does not send email, process
          payments, connect to a bank, reconcile accounts, or prepare/lodge BAS
          or tax returns. This is not a full accounting ledger or tax-compliance
          guarantee.
        </p>
      </div>

      <section className="invoice-settings-card">
        <div className="invoice-settings-heading">
          <div>
            <p className="invoice-kicker">USED FOR EVERY NEW INVOICE</p>
            <h2>Supplier &amp; GST settings</h2>
            <p>
              {storedSettings?.supplierName
                ? `${storedSettings.supplierName} · ${gstModeLabel(storedSettings.gstMode)}`
                : "Set the business details once. GST starts off."}
            </p>
          </div>
          {!settingsOpen && (
            <button
              type="button"
              className="invoice-button invoice-button-secondary"
              onClick={() => setSettingsOpen(true)}
              disabled={readOnly}
            >
              <Pencil size={15} /> Edit settings
            </button>
          )}
        </div>
        {storedSettings &&
          storedSettings.gstMode !== "off" &&
          !isGstConfirmationCurrent(storedSettings) && (
            <p className="invoice-form-error" role="status">
              The confirmed supplier profile no longer matches these settings.
              Reconfirm GST registration and scope before issuing another
              invoice.
            </p>
          )}
        {settingsOpen && (
          <div className="invoice-settings-form">
            <div className="invoice-form-grid">
              <label className="invoice-form-wide">
                Business name
                <input
                  maxLength={200}
                  value={settingsDraft.supplierName}
                  onChange={event =>
                    updateSupplierField("supplierName", event.target.value)
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="invoice-form-wide">
                Business address
                <textarea
                  rows={3}
                  maxLength={500}
                  value={settingsDraft.supplierAddress}
                  onChange={event =>
                    updateSupplierField("supplierAddress", event.target.value)
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="invoice-form-wide">
                ABN
                <input
                  maxLength={16}
                  value={settingsDraft.supplierAbn}
                  onChange={event =>
                    updateSupplierField("supplierAbn", event.target.value)
                  }
                  placeholder="11 digits"
                  disabled={readOnly}
                />
                <small>
                  Checksum is checked locally; ABN registration is not verified
                  against the ABR.
                </small>
              </label>
            </div>

            <fieldset className="invoice-gst-settings">
              <legend>One GST setting for all invoice lines</legend>
              <label className="invoice-radio-row">
                <input
                  type="radio"
                  name="invoice-gst-mode"
                  checked={settingsDraft.gstMode === "off"}
                  onChange={() => {
                    setSettingsDraft(current => ({
                      ...current,
                      gstMode: "off",
                      gstConfirmedAt: null,
                      gstConfirmedProfile: null,
                    }));
                    setGstConfirmed(false);
                  }}
                  disabled={readOnly}
                />
                <span>
                  <strong>GST off</strong>
                  <small>
                    Default. No GST is calculated or shown as charged.
                  </small>
                </span>
              </label>
              <label className="invoice-radio-row">
                <input
                  type="radio"
                  name="invoice-gst-mode"
                  checked={settingsDraft.gstMode === "exclusive"}
                  onChange={() =>
                    setSettingsDraft(current => ({
                      ...current,
                      gstMode: "exclusive",
                    }))
                  }
                  disabled={readOnly}
                />
                <span>
                  <strong>Add 10% GST</strong>
                  <small>
                    Amounts entered exclude GST; the tax is added to the total.
                  </small>
                </span>
              </label>
              <label className="invoice-radio-row">
                <input
                  type="radio"
                  name="invoice-gst-mode"
                  checked={settingsDraft.gstMode === "inclusive"}
                  onChange={() =>
                    setSettingsDraft(current => ({
                      ...current,
                      gstMode: "inclusive",
                    }))
                  }
                  disabled={readOnly}
                />
                <span>
                  <strong>Prices include 10% GST</strong>
                  <small>
                    Amounts entered include GST; the included amount is shown
                    separately.
                  </small>
                </span>
              </label>
              {settingsDraft.gstMode !== "off" && (
                <label className="invoice-gst-confirm">
                  <input
                    type="checkbox"
                    checked={gstConfirmed}
                    onChange={event => setGstConfirmed(event.target.checked)}
                    disabled={readOnly}
                  />
                  <span>
                    I confirm this business is currently GST-registered and
                    every line in this invoice register is a standard-rated
                    taxable sale.
                  </span>
                </label>
              )}
              <p className="invoice-settings-caveat">
                This global setting cannot represent GST-free, input-taxed or
                mixed-tax invoices. Keep GST off if those cases apply. Steadier
                does not determine whether registration or GST applies.
              </p>
            </fieldset>
            {settingsError && (
              <p className="invoice-form-error" role="alert">
                {settingsError}
              </p>
            )}
            {settingsStatus && (
              <p className="invoice-form-status" role="status">
                {settingsStatus}
              </p>
            )}
            <div className="invoice-settings-actions">
              <button
                type="button"
                className="invoice-button invoice-button-primary"
                onClick={persistSettings}
                disabled={readOnly}
              >
                <Save size={15} /> Save supplier settings
              </button>
              {storedSettings && (
                <button
                  type="button"
                  className="invoice-button invoice-button-secondary"
                  onClick={() => {
                    setSettingsDraft(storedSettings);
                    setGstConfirmed(
                      Boolean(
                        storedSettings.gstMode !== "off" &&
                          storedSettings.gstConfirmedAt &&
                          isGstConfirmationCurrent(storedSettings)
                      )
                    );
                    setSettingsError("");
                    setSettingsOpen(false);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="invoice-export-card">
        <div>
          <p className="invoice-kicker">ANNUAL RECORD</p>
          <h2>Annual invoice and payment exports</h2>
          <p>
            Download records for your accountant. Steadier does not prepare or
            lodge a tax return, BAS or cash/accrual report.
          </p>
        </div>
        <div className="invoice-export-controls">
          <label>
            Australian financial year
            <select
              value={financialYear}
              onChange={event => setFinancialYear(event.target.value)}
            >
              {yearOptions.map(year => (
                <option key={year} value={year}>
                  FY {year}
                </option>
              ))}
            </select>
          </label>
          <label className="invoice-history-check">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={event => setIncludeHistory(event.target.checked)}
            />
            Include voided and superseded history (clearly marked)
          </label>
          <p className="invoice-export-help">
            Invoice CSV is grouped by invoice issue year and includes current
            payment/delivery summaries. Payment CSV is grouped by receipt or
            reversal date. These are different views; do not add audit-history
            rows as though they were separate invoices.
          </p>
          <button
            type="button"
            className="invoice-button invoice-button-secondary"
            onClick={exportAnnualCsv}
          >
            <Download size={15} /> Download invoice CSV
          </button>
          <button
            type="button"
            className="invoice-button invoice-button-secondary"
            onClick={exportPaymentActivityCsv}
          >
            <Download size={15} /> Download payment activity CSV
          </button>
        </div>
      </section>

      <section className="invoice-list-section">
        <div className="invoice-list-heading">
          <div>
            <p className="invoice-kicker">PERMANENT RECORD</p>
            <h2>Invoice list</h2>
          </div>
        </div>
        <div className="invoice-list-controls">
          <label className="invoice-search-label">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search invoice records</span>
            <input
              type="search"
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Invoice, customer, job or line"
              aria-label="Search invoice number, customer, job/reference or line description"
            />
          </label>
          <label className="invoice-filter-label">
            Invoice
            <select
              value={filter}
              onChange={event => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">All records</option>
              <option value="draft">Drafts</option>
              <option value="issued">Issued</option>
              <option value="void">Voided</option>
            </select>
          </label>
          <label className="invoice-filter-label">
            Delivery
            <select
              value={deliveryFilter}
              onChange={event =>
                setDeliveryFilter(event.target.value as DeliveryFilter)
              }
            >
              <option value="all">All</option>
              <option value="not-applicable">Not applicable</option>
              <option value="not-sent">Not sent</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="invoice-filter-label">
            Payment
            <select
              value={paymentFilter}
              onChange={event =>
                setPaymentFilter(event.target.value as PaymentFilter)
              }
            >
              <option value="all">All</option>
              <option value="not-applicable">Not applicable</option>
              <option value="unpaid">Unpaid</option>
              <option value="part-paid">Part-paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="credit-due">Credit due</option>
              <option value="void">Voided</option>
            </select>
          </label>
        </div>
        {statusMessage && (
          <p className="invoice-form-status" role="status">
            {statusMessage}
          </p>
        )}
        {visibleRecords.length === 0 ? (
          <div className="invoice-empty-state">
            <FileText size={24} />
            <h3>
              {records.length === 0
                ? "No invoice records yet"
                : "No invoices match these filters"}
            </h3>
            <p>
              {records.length === 0
                ? "Drafts stay in the shared Workspace until you explicitly save or issue them. Nothing is emailed."
                : "Try another search or clear the filters. No records have been changed."}
            </p>
            {records.length > 0 ? (
              <button
                type="button"
                className="invoice-button invoice-button-secondary"
                onClick={() => {
                  setSearchTerm("");
                  setFilter("all");
                  setDeliveryFilter("all");
                  setPaymentFilter("all");
                }}
              >
                Clear search and filters
              </button>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  className="invoice-button invoice-button-secondary"
                  onClick={event => openNew(event.currentTarget)}
                >
                  <Plus size={15} /> Create first draft
                </button>
              )
            )}
          </div>
        ) : (
          <div className="accordion-group-list invoice-record-groups">
            {invoiceGroups.map(group => (
              <AccordionSection
                key={group.key}
                persistenceKey={group.key}
                title={group.label}
                count={group.items.length}
                collapsible={visibleRecords.length > 5}
                defaultOpen={
                  group.key === monthGroup(day).key ||
                  group.items.some(
                    record => invoicePaymentState(record, day) === "overdue"
                  )
                }
                autoOpen={group.items.some(
                  record => invoicePaymentState(record, day) === "overdue"
                )}
                revealToken={searchTerm && group.items.length ? searchTerm : ""}
                className="invoice-month-group"
              >
          <div className="invoice-record-list">
                  {group.items.map(record => {
              const latest = record.versions.at(-1);
              const displayNumber =
                record.invoiceNumber ?? "Draft · unnumbered";
              const paymentState = invoicePaymentState(record, day);
              const deliveryState = invoiceDeliveryState(record);
              const paymentSummary = invoicePaymentSummary(record);
              const paymentLabel =
                paymentState === null
                  ? "Not applicable"
                  : paymentState === "part-paid"
                    ? "Part-paid"
                    : paymentState === "credit-due"
                      ? "Credit due"
                      : paymentState === "void"
                        ? "Voided"
                        : paymentState.charAt(0).toUpperCase() +
                          paymentState.slice(1);
              const deliveryLabel =
                deliveryState === null
                  ? "Not applicable"
                  : deliveryState === "not-sent"
                    ? "Not sent"
                    : deliveryState.charAt(0).toUpperCase() +
                      deliveryState.slice(1);
              const jobReference =
                latest?.jobReference ?? record.draft.jobReference ?? "";
              return (
                <article
                  className={`invoice-record-card invoice-record-${record.status}`}
                  key={record.id}
                >
                  <div className="invoice-record-main">
                    <div>
                      <span
                        className={`invoice-status-tag invoice-status-${record.status}`}
                      >
                        {record.status === "void"
                          ? "Voided · retained"
                          : record.status}
                      </span>
                      <h3>{displayNumber}</h3>
                      <p>
                              {(latest?.customerName ??
                                record.draft.customerName) ||
                          "Customer not entered"}
                      </p>
                      <small>
                        {displayDate(
                          latest?.issueDate ?? record.draft.issueDate
                        )}
                        {latest &&
                          ` · ${latest.version} version${latest.version === 1 ? "" : "s"}`}
                      </small>
                      {jobReference && (
                        <p className="invoice-record-reference">
                          Job / reference: {jobReference}
                        </p>
                      )}
                    </div>
                    {latest && (
                      <strong className="invoice-record-total">
                        {formatMoney(latest.totalCents)}
                      </strong>
                    )}
                  </div>
                  <div className="invoice-activity-statuses">
                    <span
                      className={`invoice-status-tag invoice-activity-${deliveryState ?? "na"}`}
                    >
                      Delivery · {deliveryLabel}
                    </span>
                    <span
                      className={`invoice-status-tag invoice-activity-${paymentState ?? "na"}`}
                    >
                      Payment · {paymentLabel}
                    </span>
                  </div>
                  {record.status === "issued" && latest && (
                    <p className="invoice-balance-summary">
                            Received{" "}
                            {formatMoney(paymentSummary.netReceivedCents)}
                      {paymentSummary.creditDueCents > 0
                        ? ` · Credit due ${formatMoney(paymentSummary.creditDueCents)}`
                        : ` · Balance ${formatMoney(paymentSummary.balanceDueCents)}`}
                    </p>
                  )}
                  {record.status === "void" && (
                    <p className="invoice-void-reason">
                      <AlertTriangle size={14} /> {record.voidReason}
                    </p>
                  )}
                  {record.versions.length > 1 && (
                    <div className="invoice-version-history">
                      <strong>Issued history</strong>
                      {record.versions.map(version => (
                        <div
                          className="invoice-version-row"
                          key={`${record.id}-${version.version}`}
                        >
                          <span>
                            Version {version.version}
                            {version.correctionReason
                              ? ` · ${version.correctionReason}`
                              : " · Original"}
                          </span>
                          <span>
                            {displayDate(version.issueDate)} ·{" "}
                            {formatMoney(version.totalCents)}
                          </span>
                          <button
                            type="button"
                            className="invoice-button invoice-button-small"
                            onClick={() => printVersion(record, version)}
                          >
                            <Printer size={14} /> PDF / print
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="invoice-record-actions">
                    {latest && record.status !== "draft" && (
                      <button
                        type="button"
                        className="invoice-button invoice-button-secondary"
                        onClick={event => {
                                activityTriggerRef.current =
                                  event.currentTarget;
                          setActivityTarget({
                            recordId: record.id,
                            version: latest.version,
                          });
                        }}
                      >
                        <History size={14} /> Delivery / payment history
                      </button>
                    )}
                    {record.status === "draft" && !readOnly && (
                      <button
                        type="button"
                        className="invoice-button invoice-button-secondary"
                        onClick={event =>
                          openDraft(record, event.currentTarget)
                        }
                      >
                        <Pencil size={14} /> Edit / issue draft
                      </button>
                    )}
                    {latest && (
                      <button
                        type="button"
                        className="invoice-button invoice-button-secondary"
                        onClick={() => printVersion(record, latest)}
                      >
                        <Printer size={14} /> PDF / print
                      </button>
                    )}
                    {record.status === "issued" && !readOnly && (
                      <button
                        type="button"
                        className="invoice-button invoice-button-secondary"
                        onClick={event =>
                          openCorrection(record, event.currentTarget)
                        }
                      >
                        <Pencil size={14} /> Correct issued invoice
                      </button>
                    )}
                    {record.status !== "void" && !readOnly && (
                      <button
                        type="button"
                        className="invoice-button invoice-button-quiet"
                        onClick={event => {
                          voidTriggerRef.current = event.currentTarget;
                          setVoidTarget(record);
                          setVoidReason("");
                          setVoidError("");
                        }}
                      >
                        Mark void
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
              </AccordionSection>
            ))}
          </div>
        )}
      </section>

      <p className="invoice-retention-note">
        Issued invoices and prior versions stay in the Workspace; voiding never
        deletes or reuses a number. Corrections are retained as history. A
        version's PDF is regenerated on demand from its frozen snapshot; PDF
        files are not stored separately. A required ATO adjustment note may
        still need a separate process, so do not treat “void” or “correct” as
        proof of tax compliance.
      </p>

      {editor && (
        <InvoiceEditor
          key={`${editor.mode}-${editor.recordId ?? "new"}`}
          mode={editor.mode}
          initial={editor.initial}
          gstMode={editor.gstMode}
          settings={storedSettings}
          readOnly={readOnly}
          voice={voice}
          onClose={() => setEditor(null)}
          onRestoreFocus={() => restoreFocus(editorTriggerRef.current)}
          onSaveDraft={saveDraft}
          onIssue={issueDraft}
          onCorrect={saveCorrection}
        />
      )}

      {activityTarget && activityRecord && (
        <InvoiceActivityDialog
          key={`${activityRecord.id}-${activityTarget.version}`}
          record={activityRecord}
          day={day}
          expectedVersion={activityTarget.version}
          readOnly={readOnly || activityRecord.status !== "issued"}
          voice={voice}
          onClose={() => setActivityTarget(null)}
          onRestoreFocus={() => restoreFocus(activityTriggerRef.current)}
          onRecordDelivery={(input, expectedVersion) =>
            saveDeliveryAttempt(activityRecord.id, input, expectedVersion)
          }
          onRecordPayment={(input, expectedVersion) =>
            savePayment(activityRecord.id, input, expectedVersion)
          }
          onReversePayment={(paymentId, input, expectedVersion) =>
            savePaymentReversal(
              activityRecord.id,
              paymentId,
              input,
              expectedVersion
            )
          }
        />
      )}

      {voidTarget && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setVoidTarget(null);
          }}
        >
          <DialogContent
            className="invoice-void-dialog-content"
            showCloseButton={false}
            onCloseAutoFocus={event => {
              event.preventDefault();
              restoreFocus(voidTriggerRef.current);
            }}
          >
            <section className="invoice-void-dialog">
              <button
                type="button"
                className="invoice-icon-button invoice-dialog-close"
                onClick={() => setVoidTarget(null)}
                aria-label="Cancel void"
              >
                <X size={18} />
              </button>
              <AlertTriangle size={24} />
              <DialogTitle id="invoice-void-title">
                Mark this record void?
              </DialogTitle>
              <DialogDescription>
                The record and every issued version will remain. An issued
                number is never reused. This is not a credit note or adjustment
                note.
              </DialogDescription>
              <label>
                Reason for voiding
                <textarea
                  value={voidReason}
                  onChange={event => setVoidReason(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Required for the permanent record"
                />
              </label>
              {voidError && (
                <p className="invoice-form-error" role="alert">
                  {voidError}
                </p>
              )}
              <div className="invoice-editor-footer">
                <button
                  type="button"
                  className="invoice-button invoice-button-secondary"
                  onClick={() => setVoidTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="invoice-button invoice-button-primary"
                  onClick={confirmVoid}
                  disabled={readOnly || voidReason.trim().length < 3}
                >
                  Confirm void record
                </button>
              </div>
            </section>
          </DialogContent>
        </Dialog>
      )}

      {printState &&
        typeof document !== "undefined" &&
        createPortal(
          <InvoicePrintSheet printState={printState} />,
          document.body
        )}
    </div>
  );
}
