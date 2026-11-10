export type Appearance = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "steadier.appearance.v1";

type ReadValue = (key: string) => string | null;
type WriteValue = (key: string, value: string) => void;

export function normalizeAppearance(value: string | null | undefined): Appearance {
  return value === "dark" ? "dark" : "light";
}

export function readAppearance(
  readValue: ReadValue = key => window.localStorage.getItem(key)
): Appearance {
  try {
    return normalizeAppearance(readValue(APPEARANCE_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function persistAppearance(
  appearance: Appearance,
  writeValue: WriteValue = (key, value) => window.localStorage.setItem(key, value)
): void {
  try {
    writeValue(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    // Keep the in-memory preference usable if this WebView blocks storage.
  }
}

export function applyAppearance(
  root: Pick<HTMLElement, "dataset" | "style">,
  appearance: Appearance
): void {
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
}
