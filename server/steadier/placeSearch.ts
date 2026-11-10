/**
 * Address search for saved places, through OpenStreetMap Nominatim.
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
  const base = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  const [lat, lng] = (near ?? ADELAIDE).split(",").map(Number);
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");
  // Prefer results within roughly 50 km, without excluding others.
  url.searchParams.set("viewbox", `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`);
  url.searchParams.set("bounded", "0");
  const response = await fetcher(url, {
    headers: {
      // Nominatim's usage policy requires an identifying User-Agent.
      "User-Agent": `Steadier self-hosted (${process.env.PUBLIC_ORIGIN ?? "unknown"})`,
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("MAPS_FAILED");
  const body = (await response.json()) as {
    name?: string;
    display_name?: string;
    lat?: string;
    lon?: string;
  }[];
  if (!Array.isArray(body)) throw new Error("MAPS_FAILED");
  return body
    .map(r => ({
      name: String(r.name || String(r.display_name ?? "").split(",")[0]).slice(0, 120),
      address: String(r.display_name ?? "").slice(0, 300),
      lat: Number(r.lat),
      lng: Number(r.lon),
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
