import type { SiteCard, Workspace } from "./types";

export const MAX_SITE_CARDS = 200;
export const SITE_CARD_TITLE_LIMIT = 120;
export const SITE_CARD_CATEGORY_LIMIT = 80;
export const SITE_CARD_PURPOSE_LIMIT = 500;
export const SITE_CARD_URL_LIMIT = 2048;

export interface SiteCardInput {
  title: string;
  category: string;
  purpose: string;
  url: string | null;
}

/**
 * Accept only a public HTTPS link without credentials, query tokens or fragments.
 * Site Cards never fetch or embed their URL; the owner opens it explicitly.
 */
export function normalizePublicHttpsUrl(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate || candidate.length > SITE_CARD_URL_LIMIT) return null;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.startsWith("[") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isCanonicalPublicHttpsUrl(value: string): boolean {
  return normalizePublicHttpsUrl(value) === value;
}

export function createSiteCardId(): string {
  const token =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `site-${token}`;
}

function validInput(input: SiteCardInput): boolean {
  const title = input.title.trim();
  const category = input.category.trim();
  const purpose = input.purpose.trim();
  const url = input.url?.trim() ?? "";
  return (
    title.length > 0 &&
    title.length <= SITE_CARD_TITLE_LIMIT &&
    category.length <= SITE_CARD_CATEGORY_LIMIT &&
    purpose.length <= SITE_CARD_PURPOSE_LIMIT &&
    (!url || normalizePublicHttpsUrl(url) !== null)
  );
}

export function saveSiteCard(
  workspace: Workspace,
  input: SiteCardInput,
  id: string | null,
  at: string
): Workspace {
  if (!validInput(input)) return workspace;
  const current = workspace.siteCards ?? [];
  const existing = id ? current.find(card => card.id === id) : undefined;
  if (!existing && current.length >= MAX_SITE_CARDS) return workspace;
  const urlText = input.url?.trim() ?? "";
  const next: SiteCard = {
    id: existing?.id ?? id ?? createSiteCardId(),
    title: input.title.trim(),
    category: input.category.trim(),
    purpose: input.purpose.trim(),
    url: urlText ? normalizePublicHttpsUrl(urlText) : null,
    status: existing?.status ?? "active",
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  return {
    ...workspace,
    siteCards: existing
      ? current.map(card => (card.id === existing.id ? next : card))
      : [next, ...current],
  };
}

export function setSiteCardStatus(
  workspace: Workspace,
  id: string,
  status: SiteCard["status"],
  at: string
): Workspace {
  const current = workspace.siteCards ?? [];
  if (!current.some(card => card.id === id)) return workspace;
  return {
    ...workspace,
    siteCards: current.map(card =>
      card.id === id ? { ...card, status, updatedAt: at } : card
    ),
  };
}
