import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import type { VoiceControls } from "../../hooks/useVoice";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  voice: VoiceControls;
  maxLength: number;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  appendFinal?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onStart?: () => void;
  onAbort?: () => void;
}

export default function InvoiceVoiceField({
  label,
  value,
  onChange,
  voice,
  maxLength,
  disabled = false,
  multiline = false,
  rows = 3,
  required = false,
  placeholder,
  appendFinal = false,
  onPendingChange,
  onStart,
  onAbort,
}: Props) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const pendingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!pending || voice.listening) return;

    const finalText = voice.finalTranscript.trim();
    if (finalText) {
      const nextValue =
        appendFinal && value.trim()
          ? `${value.trimEnd()}\n${finalText}`
          : finalText;
      if (nextValue.length > maxLength) {
        setMessage(
          `The final transcript is longer than ${maxLength} characters and was not added. Shorten it or type the text instead.`
        );
      } else {
        onChange(nextValue);
        setMessage("");
      }
    } else {
      setMessage(
        voice.error ||
          "No final transcript was received. Interim words were discarded; type the text or try dictating again."
      );
    }

    setPending(false);
    onPendingChange?.(false);
    voice.clear();
  }, [
    appendFinal,
    maxLength,
    onChange,
    onPendingChange,
    pending,
    value,
    voice,
  ]);

  useEffect(
    () => () => {
      if (pendingRef.current) voice.abort();
    },
    [voice.abort]
  );

  const beginOrStop = () => {
    if (pending && voice.listening) {
      voice.stop();
      return;
    }
    if (pending) return;
    if (!voice.supported) {
      setMessage("Voice dictation is not available in this browser.");
      return;
    }
    onStart?.();
    if (voice.listening) voice.abort();
    voice.clear();
    setMessage("");
    setPending(true);
    onPendingChange?.(true);
    voice.start();
  };

  const handleChange = (next: string) => {
    if (pending || voice.listening) {
      voice.abort();
      voice.clear();
      setPending(false);
      onPendingChange?.(false);
      onAbort?.();
    }
    setMessage("");
    onChange(next);
  };

  const control = multiline ? (
    <textarea
      value={value}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      onChange={event => handleChange(event.target.value)}
    />
  ) : (
    <input
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      onChange={event => handleChange(event.target.value)}
    />
  );

  return (
    <div className="invoice-voice-field">
      <label className="invoice-voice-field-label">
        {label}
        {control}
      </label>
      {voice.supported && (
        <button
          type="button"
          className={`invoice-icon-button ${pending && voice.listening ? "is-listening" : ""}`}
          onClick={beginOrStop}
          disabled={disabled || (pending && !voice.listening)}
          aria-label={
            pending && voice.listening
              ? `Finish dictating ${label.toLowerCase()}`
              : `Dictate ${label.toLowerCase()}`
          }
          title={
            pending && voice.listening
              ? "Stop and use the final transcript"
              : "Start optional dictation"
          }
        >
          <Mic size={16} />
        </button>
      )}
      {(message || (pending && voice.listening)) && (
        <small className="invoice-voice-field-status" role="status">
          {pending && voice.listening
            ? "Listening; tap the microphone to finish."
            : message}
        </small>
      )}
    </div>
  );
}
