/**
 * Import/export utilities for DXF, SHP, TXT/CSV, KML vector files.
 * All imports convert to GeoJSON FeatureCollection.
 */
import DxfParser from "dxf-parser";
import shp from "shpjs";

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

export function exportTxt(geojson: GeoJSON.FeatureCollection, name: string): void {
  const lines: string[] = ["nr\tx\ty\th\tcode"];
  let idx = 1;
  for (const f of geojson.features) {
    if (f.geometry.type === "Point") {
      const [x, y, h] = f.geometry.coordinates;
      lines.push(`${idx}\t${x.toFixed(7)}\t${y.toFixed(7)}\t${(h ?? 0).toFixed(3)}\t${f.properties?.code ?? ""}`);
      idx++;
    }
  }
  downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `${name}.txt`);
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
