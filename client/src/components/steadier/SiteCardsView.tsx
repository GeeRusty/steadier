import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ExternalLink,
  Mic,
  Pencil,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import {
  isCanonicalPublicHttpsUrl,
  MAX_SITE_CARDS,
  normalizePublicHttpsUrl,
  SITE_CARD_CATEGORY_LIMIT,
  SITE_CARD_PURPOSE_LIMIT,
  SITE_CARD_TITLE_LIMIT,
  SITE_CARD_URL_LIMIT,
  type SiteCardInput,
} from "../../domain/siteCards";
import type { SiteCard, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  voice: VoiceControls;
  onSave: (input: SiteCardInput, id: string | null) => boolean;
  onStatusChange: (id: string, status: SiteCard["status"]) => boolean;
}

type DictationField = "title" | "purpose";
type CardDraft = Pick<SiteCardInput, "title" | "category" | "purpose"> & {
  url: string;
};

const emptyDraft = (): CardDraft => ({
  title: "",
  category: "",
  purpose: "",
  url: "",
});

function localTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SiteCardsView({
  workspace,
  readOnly,
  voice,
  onSave,
  onStatusChange,
}: Props) {
  const [draft, setDraft] = useState<CardDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [dictationField, setDictationField] = useState<DictationField | null>(
    null
  );
  const [dictationSource, setDictationSource] = useState<"typed" | "voice">(
    "typed"
  );

  useEffect(() => {
    if (!dictationField || !voice.transcript) return;
    setDraft(current => ({ ...current, [dictationField]: voice.transcript }));
  }, [dictationField, voice.transcript]);

  useEffect(
    () => () => {
      voice.abort();
      voice.clear();
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  const cards = workspace.siteCards ?? [];
  const visibleCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return cards
      .filter(card =>
        showArchived ? card.status === "archived" : card.status === "active"
      )
      .filter(
        card =>
          !needle ||
          [card.title, card.category, card.purpose, card.url ?? ""]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [cards, query, showArchived]);

  const urlText = draft.url.trim();
  const normalizedUrl = urlText ? normalizePublicHttpsUrl(urlText) : null;
  const urlError =
    urlText && !normalizedUrl
      ? "Use a public HTTPS URL without a password, query string or fragment. Private/local addresses are not allowed."
      : "";
  const voicePending =
    dictationSource === "voice" &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== draft[dictationField ?? "title"].trim());
  const canSave =
    !readOnly &&
    draft.title.trim().length > 0 &&
    draft.title.trim().length <= SITE_CARD_TITLE_LIMIT &&
    draft.category.trim().length <= SITE_CARD_CATEGORY_LIMIT &&
    draft.purpose.trim().length <= SITE_CARD_PURPOSE_LIMIT &&
    !urlError &&
    !voicePending &&
    (editingId !== null || cards.length < MAX_SITE_CARDS);

  const beginDictation = (field: DictationField) => {
    voice.clear();
    setDictationField(field);
    setDictationSource("voice");
    voice.start();
  };

  const changeDraft = (field: keyof CardDraft, value: string) => {
    if (dictationField) voice.abort();
    setDictationField(null);
    setDictationSource("typed");
    setDraft(current => ({ ...current, [field]: value }));
  };

  const edit = (card: SiteCard) => {
    setEditingId(card.id);
    setDraft({
      title: card.title,
      category: card.category,
      purpose: card.purpose,
      url: card.url ?? "",
    });
    setStatusMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reset = () => {
    voice.abort();
    voice.clear();
    setDictationField(null);
    setDictationSource("typed");
    setEditingId(null);
    setDraft(emptyDraft());
    setStatusMessage("");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    const input: SiteCardInput = {
      title: draft.title.trim(),
      category: draft.category.trim(),
      purpose: draft.purpose.trim(),
      url: normalizedUrl,
    };
    if (!onSave(input, editingId)) {
      setStatusMessage("Not saved. Check shared sync and try again.");
      return;
    }
    setStatusMessage(editingId ? "Card updated." : "Card saved.");
    reset();
  };

  const changeStatus = (card: SiteCard) => {
    const status = card.status === "active" ? "archived" : "active";
    if (!onStatusChange(card.id, status)) {
      setStatusMessage(
        "That change was not saved. Check shared sync and try again."
      );
      return;
    }
    setStatusMessage(
      status === "archived" ? "Card archived." : "Card restored."
    );
  };

  return (
    <section className="site-cards-view" aria-labelledby="site-cards-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">REFERENCE · OWNER-MANAGED</p>
          <h1 id="site-cards-title">Site Cards</h1>
          <p className="muted">
            Keep a short purpose and a safe link for the sites you rely on.
            Cards never create tasks.
          </p>
        </div>
        <span className="site-card-count">
          {cards.length} / {MAX_SITE_CARDS}
        </span>
      </header>

      <p className="notice site-cards-safety">
        Cards sync with your Steadier workspace and its backups, but are not
        included in Claude or ChatGPT context. Links are not opened, scraped or
        embedded here; open a public HTTPS site only when you choose. Never save
        passwords, private access links or account details in a card.
      </p>

      {!readOnly && (
        <form className="site-card-form" onSubmit={submit}>
          <h2>{editingId ? "Edit site card" : "Add a site card"}</h2>
          <label className="field">
            <span>Site or provider name</span>
            <input
              value={draft.title}
              maxLength={SITE_CARD_TITLE_LIMIT}
              onChange={event => changeDraft("title", event.target.value)}
              placeholder="For example, council rates"
              required
            />
          </label>
          <div className="site-card-voice-row">
            <button
              type="button"
              className="button small"
              onClick={() => beginDictation("title")}
              disabled={!voice.supported || voice.listening}
            >
              <Mic size={14} /> Dictate name
            </button>
            {voice.listening && dictationField === "title" && (
              <button
                type="button"
                className="button small"
                onClick={voice.stop}
              >
                <Square size={13} /> Stop
              </button>
            )}
            {dictationSource === "voice" && (
              <span className="small">
                Edit the recognised name before saving.
              </span>
            )}
          </div>
          <div className="form-pair">
            <label className="field">
              <span>Category</span>
              <input
                value={draft.category}
                maxLength={SITE_CARD_CATEGORY_LIMIT}
                onChange={event => changeDraft("category", event.target.value)}
                placeholder="Utilities, health, government…"
              />
            </label>
            <label className="field">
              <span>Public HTTPS URL (optional)</span>
              <input
                type="url"
                value={draft.url}
                maxLength={SITE_CARD_URL_LIMIT}
                onChange={event => changeDraft("url", event.target.value)}
                placeholder="https://example.com"
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? "site-card-url-error" : undefined}
              />
            </label>
          </div>
          {urlError && (
            <p id="site-card-url-error" className="form-error" role="alert">
              {urlError}
            </p>
          )}
          <label className="field">
            <span>Short purpose</span>
            <textarea
              value={draft.purpose}
              maxLength={SITE_CARD_PURPOSE_LIMIT}
              onChange={event => changeDraft("purpose", event.target.value)}
              placeholder="What you use this site for; keep it non-sensitive."
              rows={3}
            />
          </label>
          <div className="site-card-voice-row">
            <button
              type="button"
              className="button small"
              onClick={() => beginDictation("purpose")}
              disabled={!voice.supported || voice.listening}
            >
              <Mic size={14} /> Dictate purpose
            </button>
            {voice.listening && dictationField === "purpose" && (
              <button
                type="button"
                className="button small"
                onClick={voice.stop}
              >
                <Square size={13} /> Stop
              </button>
            )}
          </div>
          {voice.error && (
            <p className="form-error" role="alert">
              {voice.error}
            </p>
          )}
          {statusMessage && (
            <p className="small" role="status">
              {statusMessage}
            </p>
          )}
          <div className="site-card-form-footer">
            <span className="small">
              Voice is opt-in. Nothing is saved until you select Save card.
            </span>
            <div className="button-row">
              {editingId && (
                <button type="button" className="button" onClick={reset}>
                  <X size={14} /> Cancel edit
                </button>
              )}
              <button
                type="submit"
                className="button primary"
                disabled={!canSave}
              >
                <Save size={14} /> Save card
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="site-card-toolbar">
        <label className="field site-card-search">
          <span>Search cards</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Name, category or purpose"
          />
        </label>
        <button
          type="button"
          className="button"
          onClick={() => setShowArchived(value => !value)}
        >
          {showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}
          {showArchived
            ? "Show active"
            : `Archived (${cards.filter(card => card.status === "archived").length})`}
        </button>
      </div>

      {visibleCards.length ? (
        <div className="site-card-list">
          {visibleCards.map(card => (
            <article className="site-card" key={card.id}>
              <div className="site-card-header">
                <div>
                  <p className="eyebrow">{card.category || "REFERENCE"}</p>
                  <h2>{card.title}</h2>
                </div>
                <time dateTime={card.updatedAt}>
                  Updated {localTime(card.updatedAt)}
                </time>
              </div>
              {card.purpose && (
                <p className="site-card-purpose">{card.purpose}</p>
              )}
              {card.url && (
                <a
                  className="site-card-link"
                  href={
                    isCanonicalPublicHttpsUrl(card.url) ? card.url : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} /> Open site{" "}
                  <span className="small">(external)</span>
                </a>
              )}
              {!readOnly && (
                <div className="site-card-actions">
                  <button
                    type="button"
                    className="button small"
                    onClick={() => edit(card)}
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => changeStatus(card)}
                  >
                    {card.status === "active" ? (
                      <Archive size={13} />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                    {card.status === "active" ? "Archive" : "Restore"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="notice site-card-empty">
          {showArchived
            ? "No archived site cards match."
            : cards.length
              ? "No active site cards match."
              : "No site cards yet. Add a site you use often; links stay unopened until you choose."}
        </p>
      )}
      <span className="visually-hidden">{statusMessage}</span>
    </section>
  );
}
