/**
 * Pobiera wysokość terenu z modelu Copernicus DEM (30 m) przez OpenTopoData.
 * Endpoint: https://api.opentopodata.org/v1/copernicus30m
 * Limity: 100 punktów / zapytanie, 1 req/s, 1000 req/dzień (publiczny serwer).
 */

const ENDPOINT = "https://api.opentopodata.org/v1/copernicus30m";
const BATCH = 100;
const RATE_DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchTerrainHeights(
  coords: { lat: number; lng: number }[],
  onProgress?: (done: number, total: number) => void
): Promise<(number | null)[]> {
  const result: (number | null)[] = [];
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    const locs = batch.map((c) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`).join("|");
    try {
      const res = await fetch(`${ENDPOINT}?locations=${locs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      for (const r of json.results ?? []) {
        result.push(typeof r.elevation === "number" ? r.elevation : null);
      }
    } catch {
      for (let k = 0; k < batch.length; k++) result.push(null);
    }
    onProgress?.(Math.min(i + BATCH, coords.length), coords.length);
    if (i + BATCH < coords.length) await sleep(RATE_DELAY_MS);
  }
  return result;
}

export async function fetchTerrainHeight(lat: number, lng: number): Promise<number | null> {
  const [height] = await fetchTerrainHeights([{ lat, lng }]);
  return height ?? null;
}
