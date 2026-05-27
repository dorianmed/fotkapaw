/**
 * Pobiera wysokość terenu z Open-Meteo Elevation API (Copernicus DEM 90m, GLO-90).
 * Endpoint: https://api.open-meteo.com/v1/elevation
 * - Brak klucza, pełny CORS, brak realnych limitów dziennych.
 * - Do 100 punktów na jedno zapytanie (lat=...&long=... rozdzielone przecinkami).
 *
 * Dane bazują na Copernicus DEM (GLO-90) – ten sam model co wskazany w docs Sentinel Hub,
 * tylko serwowany przez darmowe, CORS-friendly API Open-Meteo.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const BATCH = 100;

async function fetchBatch(batch: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const lats = batch.map((c) => c.lat.toFixed(6)).join(",");
  const lngs = batch.map((c) => c.lng.toFixed(6)).join(",");
  try {
    const res = await fetch(`${ENDPOINT}?latitude=${lats}&longitude=${lngs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arr: unknown = json?.elevation;
    if (Array.isArray(arr)) {
      return arr.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
    }
    if (typeof arr === "number") return [arr];
    return batch.map(() => null);
  } catch {
    return batch.map(() => null);
  }
}

export async function fetchTerrainHeights(
  coords: { lat: number; lng: number }[],
  onProgress?: (done: number, total: number) => void
): Promise<(number | null)[]> {
  const result: (number | null)[] = [];
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    const part = await fetchBatch(batch);
    // dopasuj długość na wypadek krótkiej odpowiedzi
    for (let k = 0; k < batch.length; k++) result.push(part[k] ?? null);
    onProgress?.(Math.min(i + BATCH, coords.length), coords.length);
  }
  return result;
}

export async function fetchTerrainHeight(lat: number, lng: number): Promise<number | null> {
  const [h] = await fetchTerrainHeights([{ lat, lng }]);
  return h ?? null;
}
