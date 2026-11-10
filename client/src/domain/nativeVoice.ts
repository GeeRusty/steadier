/**
 * The Android WebView's origin-locked native Tools/Voice flow inserts an
 * editable draft into the focused field. This helper only detects that
 * capability and identifies its synthetic input events; it sends no native
 * commands and never treats a transcript as a save/submit action.
 */
type ReactNativeWebViewWindow = Window & {
  ReactNativeWebView?: { postMessage?: unknown };
};

export function hasNativeVoiceDraftHandoff(): boolean {
  if (typeof window === "undefined" || window.location.protocol !== "https:")
    return false;
  const bridge = (window as ReactNativeWebViewWindow).ReactNativeWebView;
  return typeof bridge?.postMessage === "function";
}

export function isNativeVoiceDraftEvent(event: Event): boolean {
  return hasNativeVoiceDraftHandoff() && !event.isTrusted;
}
