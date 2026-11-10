import { useState } from "react";
import { AlertTriangle, Plus, RotateCcw, Send, X } from "lucide-react";
import {
  invoicePaymentReversibleCents,
  invoicePaymentSummary,
} from "../../domain/invoiceActivity";
import type {
  InvoiceDeliveryInput,
  InvoicePaymentInput,
} from "../../domain/invoiceActivity";
import type { InvoiceRecord } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import InvoiceVoiceField from "./InvoiceVoiceField";

interface Props {
  record: InvoiceRecord;
  day: string;
  expectedVersion: number;
  readOnly: boolean;
  voice: VoiceControls;
  onClose: () => void;
  onRestoreFocus: () => void;
  onRecordDelivery: (
    input: InvoiceDeliveryInput,
    expectedVersion: number
  ) => boolean;
  onRecordPayment: (
    input: InvoicePaymentInput,
    expectedVersion: number
  ) => boolean;
  onReversePayment: (
    paymentId: string,
    input: InvoicePaymentInput,
    expectedVersion: number
  ) => boolean;
}

type ActivityMode = "history" | "delivery" | "payment" | "reversal";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
    )
  );
}

function displayTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function paymentEventLabel(kind: "payment" | "reversal"): string {
  return kind === "payment" ? "Payment received" : "Payment reversal";
}

export default function InvoiceActivityDialog({
  record,
  day,
  expectedVersion,
  readOnly,
  voice,
  onClose,
  onRestoreFocus,
  onRecordDelivery,
  onRecordPayment,
  onReversePayment,
}: Props) {
  const [mode, setMode] = useState<ActivityMode>("history");
  const [result, setResult] = useState<"sent" | "failed">("sent");
  const [date, setDate] = useState(day);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reversalPaymentId, setReversalPaymentId] = useState<string | null>(
    null
  );
  const [dictationPending, setDictationPending] = useState(false);
  const [error, setError] = useState("");

  const latest = record.versions.at(-1);
  const isCurrentVersion = latest?.version === expectedVersion;
  const canRecord =
    !readOnly && record.status === "issued" && isCurrentVersion && !!latest;
  const summary = invoicePaymentSummary(record);
  const payments = [...(record.paymentEvents ?? [])].reverse();
  const deliveries = [...(record.deliveryEvents ?? [])].reverse();
  const reversing = reversalPaymentId
    ? (record.paymentEvents ?? []).find(
        event => event.id === reversalPaymentId && event.kind === "payment"
      )
    : undefined;
  const reversibleCents = reversalPaymentId
    ? invoicePaymentReversibleCents(record, reversalPaymentId)
    : 0;
  const minimumDate =
    mode === "reversal" && reversing && latest
      ? reversing.date > latest.issueDate
        ? reversing.date
        : latest.issueDate
      : (latest?.issueDate ?? day);

  const openForm = (nextMode: ActivityMode) => {
    setMode(nextMode);
    setDate(day);
    setAmount("");
    setNote("");
    setReversalPaymentId(null);
    setError("");
  };

  const openReversal = (paymentId: string) => {
    const remaining = invoicePaymentReversibleCents(record, paymentId);
    if (remaining <= 0) return;
    setMode("reversal");
    setDate(day);
    setAmount((remaining / 100).toFixed(2));
    setNote("");
    setReversalPaymentId(paymentId);
    setError("");
  };

  const close = () => {
    if (voice.listening || dictationPending) {
      voice.abort();
      voice.clear();
      setDictationPending(false);
    }
    onClose();
  };

  const cancelForm = () => {
    if (voice.listening || dictationPending) {
      voice.abort();
      voice.clear();
      setDictationPending(false);
    }
    setMode("history");
    setError("");
  };

  const checkCapture = (): boolean => {
    if (voice.listening || dictationPending) {
      setError(
        "Finish dictation and review its editable final text before recording this event."
      );
      return false;
    }
    if (!canRecord || !latest) {
      setError(
        "This invoice changed or is no longer active. Close this window and reopen its current activity history."
      );
      return false;
    }
    return true;
  };

  const saveDelivery = () => {
    if (!checkCapture()) return;
    if (
      onRecordDelivery({ date, result, note: note.trim() }, expectedVersion)
    ) {
      close();
      return;
    }
    setError(
      "The delivery attempt was not recorded. Check sync and the invoice version, then try again."
    );
  };

  const savePayment = () => {
    if (!checkCapture()) return;
    const amountCents = parseAmount(amount);
    if (amountCents === null || amountCents > summary.balanceDueCents) {
      setError(
        `Enter an amount greater than $0 and no more than the current balance of ${formatMoney(summary.balanceDueCents)}.`
      );
      return;
    }
    if (
      onRecordPayment({ date, amountCents, note: note.trim() }, expectedVersion)
    ) {
      close();
      return;
    }
    setError(
      "The payment was not recorded. Check sync, the remaining balance and the invoice version, then try again."
    );
  };

  const saveReversal = () => {
    if (!checkCapture()) return;
    const amountCents = parseAmount(amount);
    if (
      !reversalPaymentId ||
      amountCents === null ||
      amountCents > reversibleCents ||
      note.trim().length < 3
    ) {
      setError(
        `Enter a reason of at least 3 characters and a reversal amount greater than $0 and no more than ${formatMoney(reversibleCents)}.`
      );
      return;
    }
    if (
      onReversePayment(
        reversalPaymentId,
        { date, amountCents, note: note.trim() },
        expectedVersion
      )
    ) {
      close();
      return;
    }
    setError(
      "The reversal was not recorded. Check sync, the original payment, dates and the invoice version, then try again."
    );
  };

  const attemptCount = (version: number) =>
    (record.deliveryEvents ?? []).filter(event => event.version === version)
      .length;

  const isForm = mode !== "history";

  return (
    <Dialog open onOpenChange={open => !open && close()}>
      <DialogContent
        className="invoice-activity-dialog-content"
        showCloseButton={false}
        onCloseAutoFocus={event => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <section className="invoice-activity-dialog">
          <header className="invoice-activity-header">
            <div>
              <p className="invoice-kicker">
                MANUAL RECORD · NO EMAIL OR PAYMENT PROCESSING
              </p>
              <DialogTitle id="invoice-activity-title">
                {record.invoiceNumber ?? "Invoice"} activity
              </DialogTitle>
              <p>
                Current invoice version {latest?.version ?? "not issued"} ·
                {latest ? ` issued ${displayDate(latest.issueDate)}` : " draft"}
              </p>
            </div>
            <button
              type="button"
              className="invoice-icon-button"
              onClick={close}
              aria-label="Close activity history"
            >
              <X size={18} />
            </button>
          </header>

          {mode === "history" ? (
            <>
              {record.status === "issued" && (
                <div className="invoice-activity-summary">
                  <div>
                    <span>Net received</span>
                    <strong>{formatMoney(summary.netReceivedCents)}</strong>
                  </div>
                  <div>
                    <span>Reversed</span>
                    <strong>{formatMoney(summary.reversedCents)}</strong>
                  </div>
                  <div>
                    <span>Balance due</span>
                    <strong>{formatMoney(summary.balanceDueCents)}</strong>
                  </div>
                  {summary.creditDueCents > 0 && (
                    <div className="invoice-credit-due">
                      <span>Credit due</span>
                      <strong>{formatMoney(summary.creditDueCents)}</strong>
                    </div>
                  )}
                </div>
              )}

              {!isCurrentVersion && record.status === "issued" && (
                <p className="invoice-form-error" role="alert">
                  <AlertTriangle size={15} /> This invoice has a newer version.
                  Reopen its activity history before adding another event.
                </p>
              )}
              {record.status === "void" && (
                <p className="invoice-activity-notice">
                  This record is void. Its history is retained, but new delivery
                  or payment entries are disabled.
                </p>
              )}

              <section className="invoice-activity-section">
                <div className="invoice-activity-section-heading">
                  <div>
                    <h3>Delivery attempts</h3>
                    <p>
                      Manual status only; Steadier does not send or verify
                      email.
                    </p>
                  </div>
                  {canRecord && (
                    <button
                      type="button"
                      className="invoice-button invoice-button-secondary"
                      onClick={() => openForm("delivery")}
                    >
                      <Send size={14} /> Log attempt
                    </button>
                  )}
                </div>
                {deliveries.length === 0 ? (
                  <p className="invoice-activity-empty">
                    Not sent — no attempt has been logged for any version.
                  </p>
                ) : (
                  <div className="invoice-activity-events">
                    {deliveries.map(event => {
                      const index =
                        (record.deliveryEvents ?? [])
                          .filter(item => item.version === event.version)
                          .indexOf(event) + 1;
                      return (
                        <article className="invoice-event-row" key={event.id}>
                          <div>
                            <strong>
                              {event.result === "sent"
                                ? "Sent manually"
                                : "Attempt failed"}
                            </strong>
                            <p>
                              {displayDate(event.date)} · attempt {index} of{" "}
                              {attemptCount(event.version)} · version{" "}
                              {event.version}
                            </p>
                            <small>
                              Recorded {displayTimestamp(event.recordedAt)}
                            </small>
                            {event.note && (
                              <p className="invoice-event-note">{event.note}</p>
                            )}
                          </div>
                          <span
                            className={`invoice-state-chip invoice-state-${event.result}`}
                          >
                            {event.result === "sent" ? "Sent" : "Failed"}
                          </span>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="invoice-activity-section">
                <div className="invoice-activity-section-heading">
                  <div>
                    <h3>Payment history</h3>
                    <p>
                      Record money already received; this does not move money.
                    </p>
                  </div>
                  {canRecord && summary.balanceDueCents > 0 && (
                    <button
                      type="button"
                      className="invoice-button invoice-button-secondary"
                      onClick={() => openForm("payment")}
                    >
                      <Plus size={14} /> Record payment
                    </button>
                  )}
                </div>
                {payments.length === 0 ? (
                  <p className="invoice-activity-empty">
                    No payment events recorded. Current balance:{" "}
                    {formatMoney(summary.balanceDueCents)}.
                  </p>
                ) : (
                  <div className="invoice-activity-events">
                    {payments.map(event => {
                      const remaining =
                        event.kind === "payment"
                          ? invoicePaymentReversibleCents(record, event.id)
                          : 0;
                      return (
                        <article className="invoice-event-row" key={event.id}>
                          <div>
                            <strong>{paymentEventLabel(event.kind)}</strong>
                            <p>
                              {displayDate(event.date)} · version{" "}
                              {event.version}
                              {event.kind === "reversal" &&
                                ` · reverses ${event.reversalOf}`}
                            </p>
                            <small>
                              Recorded {displayTimestamp(event.recordedAt)}
                            </small>
                            {event.note && (
                              <p className="invoice-event-note">{event.note}</p>
                            )}
                          </div>
                          <div className="invoice-event-amount">
                            <strong
                              className={
                                event.kind === "reversal" ? "is-reversal" : ""
                              }
                            >
                              {event.kind === "reversal" ? "−" : ""}
                              {formatMoney(event.amountCents)}
                            </strong>
                            {event.kind === "payment" &&
                              remaining > 0 &&
                              canRecord && (
                                <button
                                  type="button"
                                  className="invoice-button invoice-button-small"
                                  onClick={() => openReversal(event.id)}
                                >
                                  <RotateCcw size={13} /> Reverse up to{" "}
                                  {formatMoney(remaining)}
                                </button>
                              )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
              <p className="invoice-activity-privacy">
                These customer and payment notes are shared Workspace data and
                are backed up with the invoice. They are excluded from
                Claude/ChatGPT context and Server sheet exports. Do not enter
                bank/card details, account numbers, passwords or other secrets.
              </p>
            </>
          ) : (
            <>
              <div className="invoice-activity-form">
                {mode === "delivery" && (
                  <>
                    <p className="invoice-activity-notice">
                      Log an attempt only after you manually send the frozen
                      invoice yourself. This form does not email anyone or
                      confirm delivery.
                    </p>
                    <label>
                      Attempt result
                      <select
                        value={result}
                        onChange={event =>
                          setResult(event.target.value as "sent" | "failed")
                        }
                        disabled={!canRecord}
                      >
                        <option value="sent">Sent manually</option>
                        <option value="failed">Failed</option>
                      </select>
                    </label>
                  </>
                )}
                {mode === "payment" && (
                  <>
                    <p className="invoice-activity-notice">
                      Enter only a payment you have already received. The
                      maximum is {formatMoney(summary.balanceDueCents)}; no
                      transaction will be processed.
                    </p>
                    <label>
                      Amount received (AUD)
                      <input
                        type="number"
                        min="0.01"
                        max={(summary.balanceDueCents / 100).toFixed(2)}
                        step="0.01"
                        inputMode="decimal"
                        value={amount}
                        onChange={event => setAmount(event.target.value)}
                        disabled={!canRecord}
                        required
                      />
                    </label>
                  </>
                )}
                {mode === "reversal" && (
                  <>
                    <p className="invoice-activity-notice">
                      This appends a correction; it does not process a refund or
                      erase the original receipt. Remaining reversible amount:{" "}
                      {formatMoney(reversibleCents)}.
                    </p>
                    {reversing && (
                      <p className="invoice-activity-original">
                        Original receipt: {formatMoney(reversing.amountCents)}{" "}
                        on {displayDate(reversing.date)} · version{" "}
                        {reversing.version}
                      </p>
                    )}
                    <label>
                      Reversal amount (AUD)
                      <input
                        type="number"
                        min="0.01"
                        max={(reversibleCents / 100).toFixed(2)}
                        step="0.01"
                        inputMode="decimal"
                        value={amount}
                        onChange={event => setAmount(event.target.value)}
                        disabled={!canRecord}
                        required
                      />
                    </label>
                  </>
                )}

                {mode !== "reversal" && (
                  <label>
                    Activity date
                    <input
                      type="date"
                      value={date}
                      min={minimumDate}
                      max={day}
                      onChange={event => setDate(event.target.value)}
                      disabled={!canRecord}
                      required
                    />
                  </label>
                )}
                {mode === "reversal" && (
                  <label>
                    Reversal date
                    <input
                      type="date"
                      value={date}
                      min={minimumDate}
                      max={day}
                      onChange={event => setDate(event.target.value)}
                      disabled={!canRecord}
                      required
                    />
                  </label>
                )}
                <InvoiceVoiceField
                  label={
                    mode === "reversal" ? "Reason / note" : "Note (optional)"
                  }
                  value={note}
                  onChange={setNote}
                  voice={voice}
                  maxLength={1000}
                  rows={3}
                  multiline
                  appendFinal
                  required={mode === "reversal"}
                  disabled={!canRecord}
                  onPendingChange={setDictationPending}
                />
                <p className="invoice-voice-disclosure">
                  Optional dictation starts only when you tap the microphone.
                  Your browser’s speech provider may process audio; only the
                  finished, editable text is used. Nothing is saved until you
                  explicitly record the event.
                </p>
              </div>
              {error && (
                <p className="invoice-form-error" role="alert">
                  <AlertTriangle size={15} /> {error}
                </p>
              )}
              <div className="invoice-editor-footer">
                <button
                  type="button"
                  className="invoice-button invoice-button-secondary"
                  onClick={cancelForm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="invoice-button invoice-button-primary"
                  onClick={
                    mode === "delivery"
                      ? saveDelivery
                      : mode === "payment"
                        ? savePayment
                        : saveReversal
                  }
                  disabled={
                    readOnly ||
                    !canRecord ||
                    voice.listening ||
                    dictationPending ||
                    (mode === "payment" && summary.balanceDueCents <= 0) ||
                    (mode === "reversal" && reversibleCents <= 0)
                  }
                >
                  {mode === "delivery"
                    ? "Record attempt"
                    : mode === "payment"
                      ? "Record payment"
                      : "Record reversal"}
                </button>
              </div>
            </>
          )}

          {mode === "history" && (
            <div className="invoice-editor-footer">
              <button
                type="button"
                className="invoice-button invoice-button-secondary"
                onClick={close}
              >
                Close
              </button>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
