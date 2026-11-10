/**
 * Address search for saved places (v2.7), through the Manus Maps proxy.
 * Only the typed search text (and an optional rough area to search near)
 * is sent; nothing is stored.
 */
export interface PlaceSearchResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Adelaide CBD: default search bias. */
const ADELAIDE = "-34.9285,138.6007";

export function parseNear(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Round to about 1 km: enough to rank results, not a precise location.
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export async function searchPlaces(
  query: string,
  near: string | null,
  fetcher: typeof fetch = fetch
): Promise<PlaceSearchResult[]> {
  const base = process.env.MANUS_API_URL;
  const key = process.env.MANUS_API_KEY;
  if (!base || !key) throw new Error("MAPS_UNAVAILABLE");
  const url = new URL(
    `${base.replace(/\/$/, "")}/v1/maps/proxy/maps/api/place/textsearch/json`
  );
  url.searchParams.set("query", query);
  url.searchParams.set("location", near ?? ADELAIDE);
  url.searchParams.set("radius", "50000");
  url.searchParams.set("region", "au");
  url.searchParams.set("key", key);
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("MAPS_FAILED");
  const body = (await response.json()) as {
    status?: string;
    results?: {
      name?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }[];
  };
  if (body.status && !["OK", "ZERO_RESULTS"].includes(body.status))
    throw new Error("MAPS_FAILED");
  return (body.results ?? [])
    .map(r => ({
      name: String(r.name ?? "").slice(0, 120),
      address: String(r.formatted_address ?? "").slice(0, 300),
      lat: Number(r.geometry?.location?.lat),
      lng: Number(r.geometry?.location?.lng),
    }))
    .filter(
      r =>
        r.name &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng) &&
        Math.abs(r.lat) <= 90 &&
        Math.abs(r.lng) <= 180
    )
    .slice(0, 6);
}
