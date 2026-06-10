/**
 * Import/export utilities for DXF, SHP, TXT/CSV, KML vector files.
 * All imports convert to GeoJSON FeatureCollection.
 */
import DxfParser from "dxf-parser";
import shp from "shpjs";
import { CoordinateSystem, unprojectCoords, exportPrecision, prjWkt } from "@/lib/coordinateUtils";

// ─── DXF Import ───────────────────────────────────────────────

export async function importDxf(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await file.text();
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error("Nie udało się sparsować pliku DXF");

  const features: GeoJSON.Feature[] = [];

  for (const entity of dxf.entities ?? []) {
    if (entity.type === "POINT" && (entity as any).position) {
      const p = (entity as any).position;
      features.push({
        type: "Feature",
        properties: { name: (entity as any).layer || "point", layer: (entity as any).layer },
        geometry: { type: "Point", coordinates: [p.x, p.y] },
      });
    } else if (entity.type === "LINE" && (entity as any).vertices) {
      const verts = (entity as any).vertices;
      features.push({
        type: "Feature",
        properties: { name: (entity as any).layer || "line", layer: (entity as any).layer },
        geometry: { type: "LineString", coordinates: verts.map((v: any) => [v.x, v.y]) },
      });
    } else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      const verts = (entity as any).vertices ?? [];
      const coords = verts.map((v: any) => [v.x, v.y]);
      if (coords.length < 2) continue;
      const isClosed = (entity as any).shape === true || (entity as any).type === "POLYLINE" && (entity as any).shape;
      if (isClosed && coords.length >= 3) {
        const ring = [...coords, coords[0]];
        features.push({
          type: "Feature",
          properties: { name: (entity as any).layer || "polygon", layer: (entity as any).layer },
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      } else {
        features.push({
          type: "Feature",
          properties: { name: (entity as any).layer || "polyline", layer: (entity as any).layer },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    } else if (entity.type === "CIRCLE" && (entity as any).center) {
      // Approximate circle as polygon
      const c = (entity as any).center;
      const r = (entity as any).radius ?? 1;
      const pts = 36;
      const ring: number[][] = [];
      for (let i = 0; i <= pts; i++) {
        const angle = (2 * Math.PI * i) / pts;
        ring.push([c.x + r * Math.cos(angle), c.y + r * Math.sin(angle)]);
      }
      features.push({
        type: "Feature",
        properties: { name: (entity as any).layer || "circle", layer: (entity as any).layer },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

// ─── SHP Import ───────────────────────────────────────────────

export async function importShp(file: File): Promise<GeoJSON.FeatureCollection> {
  const buffer = await file.arrayBuffer();
  const geojson = await shp(buffer);
  // shpjs can return a single FeatureCollection or an array
  if (Array.isArray(geojson)) {
    const allFeatures = geojson.flatMap((fc: any) => fc.features ?? []);
    return { type: "FeatureCollection", features: allFeatures };
  }
  return geojson as GeoJSON.FeatureCollection;
}

// ─── TXT/CSV Import ──────────────────────────────────────────

export type TxtDelimiter = "auto" | "space" | "tab" | "semicolon" | "comma";

export interface TxtImportOptions {
  crs: CoordinateSystem;
  delimiter: TxtDelimiter;
  /** Numer pierwszej linii z danymi (1-based) – pomija nagłówki. */
  startLine: number;
  /** Numery kolumn (1-based). X = współrzędna północna (geodezyjna X / szerokość). */
  colX: number;
  colY: number;
  colH?: number;
  colName?: number;
  colCode?: number;
}

function splitByDelimiter(line: string, delimiter: TxtDelimiter): string[] {
  switch (delimiter) {
    case "tab": return line.split("\t").map((s) => s.trim());
    case "semicolon": return line.split(";").map((s) => s.trim());
    case "comma": return line.split(",").map((s) => s.trim());
    case "space": return line.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    default: {
      const parts = line.split(/[\t;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      return parts.length >= 2 ? parts : line.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    }
  }
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

/** Import TXT/CSV z pełną kontrolą: układ, separator, kolumny, linia startowa. */
export function importTxtAdvanced(text: string, opts: TxtImportOptions): GeoJSON.FeatureCollection {
  const rawLines = text.split(/\r?\n/);
  const features: GeoJSON.Feature[] = [];

  for (let i = (opts.startLine - 1); i < rawLines.length; i++) {
    const line = rawLines[i]?.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const fields = splitByDelimiter(line, opts.delimiter);
    const X = num(fields[opts.colX - 1]); // północna
    const Y = num(fields[opts.colY - 1]); // wschodnia
    if (X === null || Y === null) continue;
    const h = opts.colH ? num(fields[opts.colH - 1]) : null;
    const name = opts.colName ? (fields[opts.colName - 1] ?? "") : "";
    const code = opts.colCode ? (fields[opts.colCode - 1] ?? "") : "";

    const [lat, lng] = unprojectCoords(X, Y, opts.crs);

    features.push({
      type: "Feature",
      properties: { name: name || `Punkt ${features.length + 1}`, code, altitude: h },
      geometry: { type: "Point", coordinates: h !== null ? [lng, lat, h] : [lng, lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

export function importTxt(text: string): GeoJSON.FeatureCollection {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  const features: GeoJSON.Feature[] = [];

  for (const line of lines) {
    // Try common delimiters: tab, semicolon, comma, multiple spaces
    const parts = line.split(/[\t;,]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    // Also try single space if other methods didn't yield enough fields
    const partsSingle = parts.length < 2 ? line.split(/\s+/).map((s) => s.trim()).filter(Boolean) : parts;
    const fields = partsSingle.length >= 2 ? partsSingle : parts;

    if (fields.length < 2) continue;

    // Try to find two numeric fields for coordinates
    // Common formats: nr x y h code, x y, x y h, nr x y, x y code
    let x: number | null = null;
    let y: number | null = null;
    let h: number | null = null;
    let name = "";
    let code = "";

    // Find first two consecutive numeric values as X, Y
    const numericIndices: number[] = [];
    for (let i = 0; i < fields.length; i++) {
      const num = parseFloat(fields[i].replace(",", "."));
      if (!isNaN(num)) numericIndices.push(i);
    }

    if (numericIndices.length >= 2) {
      x = parseFloat(fields[numericIndices[0]].replace(",", "."));
      y = parseFloat(fields[numericIndices[1]].replace(",", "."));
      if (numericIndices.length >= 3) {
        h = parseFloat(fields[numericIndices[2]].replace(",", "."));
      }
      // Name is the first non-numeric field, or the field before coordinates
      if (numericIndices[0] > 0) {
        name = fields[0];
      }
      // Code is last field if not numeric
      const lastField = fields[fields.length - 1];
      if (isNaN(parseFloat(lastField.replace(",", ".")))) {
        code = lastField;
      }
    } else {
      continue;
    }

    if (x === null || y === null) continue;

    // Auto-detect: if x > 180 or y > 180, assume projected coordinates (pass as-is)
    // If both < 180, assume lat/lng. Heuristic: if x < y and both look like Polish coords...
    // For simplicity: if both < 180, treat first as Y (lat or northing) second as X (lng or easting)
    // Standard geodetic: x=easting(lng), y=northing(lat)
    let lng = x;
    let lat = y;
    // If looks like geographic coordinates (both < 180), keep as is (first=X/lng, second=Y/lat is common in surveying)
    // Actually in Polish surveying: X=northing, Y=easting, so swap
    if (Math.abs(x) <= 180 && Math.abs(y) <= 180) {
      // Looks like WGS84 — assume first column = latitude/northing, second = longitude/easting
      lat = x;
      lng = y;
    }

    features.push({
      type: "Feature",
      properties: { name: name || `Punkt ${features.length + 1}`, code, altitude: h },
      geometry: { type: "Point", coordinates: h !== null ? [lng, lat, h] : [lng, lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

// ─── GML Import (EGiB / GESUT / BDOT500) ─────────────────────
// Obsługuje pliki GML z C-GEO / EWMAPA (posList lub pojedyncze gml:pos).
// Geometria w EPSG:2176-2179 (PUWG 2000) lub 2180 (PUWG 1992),
// kolejność współrzędnych: X (północ) Y (wschód).

export interface GmlLayerResult {
  name: string;
  color: string;
  crs: CoordinateSystem;
  geojson: GeoJSON.FeatureCollection;
}

interface GmlCategory { key: string; label: string; color: string; }

function gmlCategory(localName: string): GmlCategory {
  const n = localName;
  // EGiB
  if (n.includes("Dzialka")) return { key: "egb-dzialki", label: "Działki ewidencyjne", color: "#16a34a" };
  if (n.includes("Budynek") || n.includes("BlokBudynku")) return { key: "egb-budynki", label: "Budynki", color: "#ea580c" };
  if (n.includes("PunktGraniczny")) return { key: "egb-punkty", label: "Punkty graniczne", color: "#dc2626" };
  if (n.includes("KonturUzytku")) return { key: "egb-uzytki", label: "Kontury użytków", color: "#84cc16" };
  if (n.includes("KonturKlasyfikacyjny") || n.includes("Klasouzytek")) return { key: "egb-klasy", label: "Kontury klasyfikacyjne", color: "#a16207" };
  if (n.includes("Adres")) return { key: "egb-adresy", label: "Adresy / punkty adresowe", color: "#7c3aed" };
  // GESUT
  if (n.includes("Wodociag")) return { key: "ges-wod", label: "GESUT — sieć wodociągowa", color: "#2563eb" };
  if (n.includes("Kanaliz")) return { key: "ges-kan", label: "GESUT — sieć kanalizacyjna", color: "#92400e" };
  if (n.includes("Elektro")) return { key: "ges-en", label: "GESUT — sieć elektroenergetyczna", color: "#dc2626" };
  if (n.includes("Gaz")) return { key: "ges-gaz", label: "GESUT — sieć gazowa", color: "#f59e0b" };
  if (n.includes("Cieplow")) return { key: "ges-cieplo", label: "GESUT — sieć cieplownicza", color: "#e11d48" };
  if (n.includes("Telekom")) return { key: "ges-tel", label: "GESUT — sieć telekomunikacyjna", color: "#0891b2" };
  if (n.startsWith("GES_")) return { key: "ges-inne", label: "GESUT — inne", color: "#475569" };
  // BDOT500
  if (n.includes("Budowle")) return { key: "ot-budowle", label: "BDOT500 — budowle", color: "#b45309" };
  if (n.includes("Ogrodzenia")) return { key: "ot-ogrodz", label: "BDOT500 — ogrodzenia", color: "#78716c" };
  if (n.includes("Komunikacja")) return { key: "ot-komun", label: "BDOT500 — komunikacja", color: "#525252" };
  if (n.includes("Zagospodarowanie")) return { key: "ot-zagosp", label: "BDOT500 — zagospodarowanie", color: "#0d9488" };
  if (n.startsWith("OT_")) return { key: "ot-inne", label: "BDOT500 — inne", color: "#57534e" };
  return { key: "inne", label: "GML — inne obiekty", color: "#6366f1" };
}

function gmlSystem(srsName: string | null): CoordinateSystem {
  const code = srsName?.match(/(\d{4,5})\s*$/)?.[1] ?? "";
  if (code === "2180") return "puwg1992";
  if (code === "4326") return "wgs84";
  return "puwg2000"; // 2176..2179 oraz domyślnie
}

function srsOf(el: Element): string | null {
  let cur: Element | null = el;
  while (cur) {
    const s = cur.getAttribute?.("srsName");
    if (s) return s;
    cur = cur.parentElement;
  }
  const d = Array.from(el.getElementsByTagName("*")).find((e) => e.getAttribute("srsName"));
  return d?.getAttribute("srsName") ?? null;
}

function parsePosListText(txt: string): [number, number][] {
  const nums = txt.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]); // [X północ, Y wschód]
  return out;
}

function coordsOf(geomEl: Element): [number, number][] {
  // dla poligonu bierzemy tylko obwód zewnętrzny (exterior)
  const exterior = Array.from(geomEl.getElementsByTagName("*")).find((e) => e.localName === "exterior");
  const scope = exterior ?? geomEl;
  const posLists = Array.from(scope.getElementsByTagName("*")).filter((e) => e.localName === "posList");
  if (posLists.length) return posLists.flatMap((pl) => parsePosListText(pl.textContent || ""));
  const poss = Array.from(scope.getElementsByTagName("*")).filter((e) => e.localName === "pos");
  return poss.map((p) => {
    const n = (p.textContent || "").trim().split(/\s+/).map(Number);
    return [n[0], n[1]] as [number, number];
  });
}

function descText(feat: Element, localName: string): string | null {
  const el = Array.from(feat.getElementsByTagName("*")).find((e) => e.localName === localName);
  return el?.textContent?.trim() || null;
}

export async function importGml(file: File): Promise<GmlLayerResult[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Niepoprawny plik GML");

  const members = Array.from(doc.getElementsByTagName("*")).filter((el) => el.localName === "featureMember");
  const groups = new Map<string, { cat: GmlCategory; features: GeoJSON.Feature[]; system: CoordinateSystem }>();

  for (const m of members) {
    const feat = Array.from(m.children)[0];
    if (!feat) continue;
    const ln = feat.localName;
    // pomijamy elementy prezentacji graficznej i rzędne (etykiety/wysokości)
    if (ln === "PrezentacjaGraficzna" || /Rzedna$/.test(ln) || ln === "Etykieta") continue;

    // wybór geometrii: poligon > powierzchnia > krzywa > linia > punkt
    const all = Array.from(feat.getElementsByTagName("*"));
    const geomEl =
      all.find((e) => e.localName === "Polygon") ||
      all.find((e) => e.localName === "Surface") ||
      all.find((e) => e.localName === "Curve") ||
      all.find((e) => e.localName === "LineString") ||
      all.find((e) => e.localName === "Point");
    if (!geomEl) continue;

    const system = gmlSystem(srsOf(geomEl));
    const raw = coordsOf(geomEl);
    if (raw.length === 0) continue;

    const ll = raw.map(([X, Y]) => unprojectCoords(X, Y, system)); // [lat, lng]
    const ring = ll.map(([lat, lng]) => [lng, lat] as [number, number]);

    const kind = geomEl.localName;
    let geometry: GeoJSON.Geometry;
    if (kind === "Point") {
      geometry = { type: "Point", coordinates: ring[0] };
    } else if (kind === "Polygon" || kind === "Surface") {
      const closed = [...ring];
      const a = closed[0], b = closed[closed.length - 1];
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) closed.push(a);
      geometry = { type: "Polygon", coordinates: [closed] };
    } else {
      geometry = { type: "LineString", coordinates: ring };
    }

    const name = descText(feat, "idDzialki") || descText(feat, "lokalnyId") || ln;
    const cat = gmlCategory(ln);
    const g = groups.get(cat.key) ?? { cat, features: [], system };
    g.features.push({ type: "Feature", properties: { name, klasa: ln }, geometry });
    groups.set(cat.key, g);
  }

  return Array.from(groups.values()).map((g) => ({
    name: g.cat.label,
    color: g.cat.color,
    crs: g.system,
    geojson: { type: "FeatureCollection", features: g.features },
  }));
}

// ─── DXF Export ───────────────────────────────────────────────

export function exportDxf(geojson: GeoJSON.FeatureCollection, name: string): void {
  let dxfContent = "0\nSECTION\n2\nENTITIES\n";

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (geom.type === "Point") {
      const [x, y] = geom.coordinates;
      dxfContent += `0\nPOINT\n8\n${name}\n10\n${x}\n20\n${y}\n30\n0\n`;
    } else if (geom.type === "LineString") {
      dxfContent += `0\nPOLYLINE\n8\n${name}\n66\n1\n70\n0\n`;
      for (const [x, y] of geom.coordinates) {
        dxfContent += `0\nVERTEX\n8\n${name}\n10\n${x}\n20\n${y}\n30\n0\n`;
      }
      dxfContent += `0\nSEQEND\n`;
    } else if (geom.type === "Polygon") {
      dxfContent += `0\nPOLYLINE\n8\n${name}\n66\n1\n70\n1\n`;
      for (const [x, y] of geom.coordinates[0]) {
        dxfContent += `0\nVERTEX\n8\n${name}\n10\n${x}\n20\n${y}\n30\n0\n`;
      }
      dxfContent += `0\nSEQEND\n`;
    }
  }

  dxfContent += "0\nENDSEC\n0\nEOF\n";
  downloadBlob(new Blob([dxfContent], { type: "application/dxf" }), `${name}.dxf`);
}

// ─── SHP Export (as GeoJSON — true SHP needs binary) ──────────

export function exportGeoJson(geojson: GeoJSON.FeatureCollection, name: string): void {
  const json = JSON.stringify(geojson, null, 2);
  downloadBlob(new Blob([json], { type: "application/geo+json" }), `${name}.geojson`);
}

// ─── TXT Export ───────────────────────────────────────────────

/**
 * Eksport TXT obsługujący punkty, linie i powierzchnie.
 * Współrzędne wejściowe są już w docelowym układzie ([E, N] lub [lng, lat]).
 * Zapisuje kolumny: obj  nr  X  Y  H  kod  (X=północna, Y=wschodnia).
 * Gdy podany `system` inny niż wgs84 – dokłada plik .prj (WKT).
 */
export function exportTxt(
  geojson: GeoJSON.FeatureCollection,
  name: string,
  opts?: { precision?: number; system?: CoordinateSystem; lngForPrj?: number; withPrj?: boolean }
): void {
  const p = opts?.precision ?? 7;
  const lines: string[] = ["obj\tnr\tX\tY\tH\tkod"];
  let objIdx = 0;

  const writePt = (coord: number[], code: string, ptIdx: number) => {
    const Y = coord[0]; // wschodnia / lng
    const X = coord[1]; // północna / lat
    const H = coord[2];
    lines.push(`${objIdx}\t${ptIdx}\t${X.toFixed(p)}\t${Y.toFixed(p)}\t${(H ?? 0).toFixed(p === 7 ? 3 : 2)}\t${code}`);
  };

  for (const f of geojson.features) {
    objIdx++;
    const code = String(f.properties?.code ?? f.properties?.name ?? "");
    const geom = f.geometry;
    if (geom.type === "Point") {
      writePt(geom.coordinates as number[], code, 1);
    } else if (geom.type === "LineString") {
      (geom.coordinates as number[][]).forEach((c, i) => writePt(c, code, i + 1));
    } else if (geom.type === "Polygon") {
      (geom.coordinates[0] as number[][]).forEach((c, i) => writePt(c, code, i + 1));
    }
  }

  downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `${name}.txt`);

  // Plik .prj zapisujemy TYLKO na wyraźne żądanie (domyślnie wyłączone),
  // bo użytkownik chce wyłącznie współrzędne w pliku TXT.
  if (opts?.withPrj && opts?.system && opts.system !== "wgs84") {
    const prj = prjWkt(opts.system, opts.lngForPrj);
    downloadBlob(new Blob([prj], { type: "text/plain" }), `${name}.prj`);
  }
}

/**
 * Zapis pliku. Gdy przeglądarka wspiera File System Access API (Chrome/Edge),
 * pokazuje okno wyboru miejsca zapisu. W przeciwnym razie pobiera plik klasycznie.
 */
async function downloadBlob(blob: Blob, filename: string) {
  const w = window as any;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const ext = (filename.split(".").pop() || "").toLowerCase();
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: ext ? [{ description: ext.toUpperCase(), accept: { "application/octet-stream": [`.${ext}`] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") return; // użytkownik anulował
      // w innym wypadku fallback do klasycznego pobierania
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
