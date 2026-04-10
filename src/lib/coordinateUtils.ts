/**
 * Coordinate transformations: WGS84 ↔ PUWG 1992, PUWG 2000
 * Based on Gauss-Krüger projection with GRS80 ellipsoid.
 */

const a = 6378137.0;
const e2 = 0.00669437999014;
const e4 = e2 * e2;
const e6 = e4 * e2;
const e8 = e6 * e2;

function gaussKruger(latDeg: number, lngDeg: number, L0deg: number, scale: number, FE: number, FN: number) {
  const lat = (latDeg * Math.PI) / 180;
  const dL = ((lngDeg - L0deg) * Math.PI) / 180;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const tan2 = tanLat * tanLat;
  const tan4 = tan2 * tan2;

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const eta2 = (e2 / (1 - e2)) * cosLat * cosLat;

  const A0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const A2 = (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128);
  const A4 = (15 / 256) * (e4 + (3 * e6) / 4);
  const A6 = (35 * e6) / 3072;

  const sigma =
    a * (A0 * lat - A2 * Math.sin(2 * lat) + A4 * Math.sin(4 * lat) - A6 * Math.sin(6 * lat));

  const t = dL * cosLat;
  const t2 = t * t;

  const x =
    sigma +
    (N * sinLat * cosLat * t2) / 2 +
    (N * sinLat * cosLat * cosLat * cosLat * t2 * t2 * (5 - tan2 + 9 * eta2 + 4 * eta2 * eta2)) / 24 +
    (N * sinLat * Math.pow(cosLat, 5) * Math.pow(t, 6) * (61 - 58 * tan2 + tan4)) / 720;

  const y =
    N * t +
    (N * cosLat * cosLat * t2 * t * (1 - tan2 + eta2)) / 6 +
    (N * Math.pow(cosLat, 4) * Math.pow(t, 5) * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * tan2 * eta2)) / 120;

  return {
    x: x * scale + FN,
    y: y * scale + FE,
  };
}

export type CoordinateSystem = "wgs84" | "puwg1992" | "puwg2000";

export interface CoordinateResult {
  label: string;
  line1: string;
  line2: string;
}

export function formatCoordinates(lat: number, lng: number, system: CoordinateSystem): CoordinateResult {
  if (system === "wgs84") {
    return {
      label: "WGS 84",
      line1: `φ ${lat >= 0 ? "N" : "S"} ${Math.abs(lat).toFixed(7)}°`,
      line2: `λ ${lng >= 0 ? "E" : "W"} ${Math.abs(lng).toFixed(7)}°`,
    };
  }

  if (system === "puwg1992") {
    const { x, y } = gaussKruger(lat, lng, 19.0, 0.9993, 500000, -5300000);
    return {
      label: "PUWG 1992",
      line1: `X: ${x.toFixed(2)} m`,
      line2: `Y: ${y.toFixed(2)} m`,
    };
  }

  // PUWG 2000 — zone based on longitude
  const zone = lng < 16.5 ? 5 : lng < 19.5 ? 6 : lng < 22.5 ? 7 : 8;
  const L0 = zone * 3;
  const FE = zone * 1000000 + 500000;
  const { x, y } = gaussKruger(lat, lng, L0, 0.999923, FE, 0);
  return {
    label: `PUWG 2000 (z.${zone})`,
    line1: `X: ${x.toFixed(2)} m`,
    line2: `Y: ${y.toFixed(2)} m`,
  };
}

export const COORDINATE_SYSTEMS: { value: CoordinateSystem; label: string }[] = [
  { value: "wgs84", label: "WGS 84" },
  { value: "puwg1992", label: "PUWG 1992" },
  { value: "puwg2000", label: "PUWG 2000" },
];
