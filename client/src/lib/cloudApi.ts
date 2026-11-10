export async function privateRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(path, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: {
      "X-Steadier-Request": "1",
      ...(options.body ||
      (options.method &&
        !["GET", "HEAD"].includes(options.method.toUpperCase()))
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
}

export async function privateJSON<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await privateRequest(path, options);
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(
      json?.message ||
        json?.error ||
        (response.status === 401
          ? "Sign in to access your shared records."
          : "The private server could not answer. Retry when connected.")
    );
  }
  return json as T;
}

export function downloadPrivate(
  text: string,
  filename: string,
  type = "application/json"
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyPrivate(text: string) {
  if (!navigator.clipboard?.writeText)
    throw new Error(
      "Clipboard is unavailable here. Select the text and copy it manually."
    );
  await navigator.clipboard.writeText(text);
}

export async function privateOwnerRequest(
  owner: number,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("A verified account is required for this private request.");
  return privateRequest(path, {
    ...options,
    headers: { ...options.headers, "X-Steadier-Owner": String(owner) },
  });
}
export async function privateOwnerJSON<T>(
  owner: number,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await privateOwnerRequest(owner, path, options);
  const value = await response.json().catch(() => null);
  if (!response.ok || !value)
    throw new Error(
      value?.message ||
        "Private account access changed or could not be confirmed. Reconnect before continuing."
    );
  return value as T;
}
