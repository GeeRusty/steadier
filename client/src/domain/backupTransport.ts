const COPY_UNAVAILABLE_ERROR = "Copy is unavailable in this browser.";
const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/**
 * Requests a browser download. A request does not prove that the browser saved
 * the file, especially on mobile browsers or embedded previews.
 */
export function downloadBackup(
  text: string,
  filename: string,
  mime = "application/json"
): void {
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;

  try {
    url = URL.createObjectURL(new Blob([text], { type: mime }));
    const objectUrl = url;
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_LIFETIME_MS);
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor?.remove();
  }
}

/**
 * Copies private backup text without reading from the clipboard. If the modern
 * clipboard API is unavailable or denied, use the browser's legacy copy route.
 */
export async function copyBackupText(text: string): Promise<void> {
  try {
    const clipboard =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (typeof clipboard?.writeText === "function") {
      try {
        await clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the legacy, user-gesture-compatible copy mechanism.
      }
    }
  } catch {
    // An inaccessible clipboard API still permits attempting the legacy route.
  }

  legacyCopy(text);
}

function legacyCopy(text: string): void {
  let textarea: HTMLTextAreaElement | null = null;
  const previousFocus =
    typeof document === "undefined" ? null : document.activeElement;

  try {
    if (typeof document === "undefined" || !document.body)
      throw new Error(COPY_UNAVAILABLE_ERROR);

    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("readonly", "");
    textarea.className = "rr-block rr-mask";
    textarea.setAttribute("data-private", "true");
    textarea.setAttribute("data-hj-suppress", "true");
    textarea.setAttribute("data-ms-mask", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    if (!document.execCommand("copy")) throw new Error(COPY_UNAVAILABLE_ERROR);
  } catch {
    throw new Error(COPY_UNAVAILABLE_ERROR);
  } finally {
    try {
      textarea?.remove();
    } catch {
      // Cleanup is best effort and must not expose browser-specific errors.
    }
    try {
      (previousFocus as HTMLElement | null)?.focus();
    } catch {
      // Restoring focus is best effort after an attempted private copy.
    }
  }
}
