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

/** Konwersja WGS84 (lat/lng) -> wybrany układ. Zwraca [x, y] gdzie x=Easting, y=Northing
 *  (dla geograficznego: x=lng, y=lat). */
export function projectCoords(lat: number, lng: number, system: CoordinateSystem): [number, number] {
  if (system === "wgs84") return [lng, lat];
  if (system === "puwg1992") {
    const { x, y } = gaussKruger(lat, lng, 19.0, 0.9993, 500000, -5300000);
    return [y, x]; // y=Easting, x=Northing -> [E, N]
  }
  const zone = lng < 16.5 ? 5 : lng < 19.5 ? 6 : lng < 22.5 ? 7 : 8;
  const L0 = zone * 3;
  const FE = zone * 1000000 + 500000;
  const { x, y } = gaussKruger(lat, lng, L0, 0.999923, FE, 0);
  return [y, x];
}

export const EXPORT_EPSG: { value: CoordinateSystem; label: string; epsg: string }[] = [
  { value: "wgs84", label: "WGS 84 (EPSG:4326)", epsg: "4326" },
  { value: "puwg1992", label: "PUWG 1992 (EPSG:2180)", epsg: "2180" },
  { value: "puwg2000", label: "PUWG 2000 z. auto (EPSG:2176-2179)", epsg: "2176" },
];

// ─── Inwersja Gaussa-Krügera (układ płaski -> WGS84) ──────────────
// E = Easting (Y geodezyjne), N = Northing (X geodezyjne)
function inverseGaussKruger(E: number, N: number, L0deg: number, scale: number, FE: number, FN: number): [number, number] {
  const M = (N - FN) / scale; // łuk południka
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
    ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);

  const sinP = Math.sin(phi1);
  const cosP = Math.cos(phi1);
  const tanP = Math.tan(phi1);
  const ep2 = e2 / (1 - e2);
  const C1 = ep2 * cosP * cosP;
  const T1 = tanP * tanP;
  const N1 = a / Math.sqrt(1 - e2 * sinP * sinP);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinP * sinP, 1.5);
  const D = (E - FE) / (N1 * scale);

  const lat =
    phi1 -
    ((N1 * tanP) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4)) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6)) / 720);

  const lng =
    (L0deg * Math.PI) / 180 +
    (D -
      ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120) /
      cosP;

  return [(lat * 180) / Math.PI, (lng * 180) / Math.PI];
}

/** Konwersja [Easting(Y), Northing(X)] w wybranym układzie -> [lat, lng] WGS84.
 *  Dla wgs84 przyjmujemy [Y=lng, X=lat] (czyli x=lat, y=lng). */
export function unprojectCoords(x: number, y: number, system: CoordinateSystem): [number, number] {
  // x = współrzędna X geodezyjna (Northing), y = Y geodezyjna (Easting)
  if (system === "wgs84") return [x, y]; // x=lat, y=lng
  if (system === "puwg1992") {
    return inverseGaussKruger(y, x, 19.0, 0.9993, 500000, -5300000);
  }
  // PUWG 2000 – strefa wynika z prefiksu Eastingu (5xxxxxx..8xxxxxx)
  const zone = Math.floor(y / 1000000);
  const L0 = zone * 3;
  const FE = zone * 1000000 + 500000;
  return inverseGaussKruger(y, x, L0, 0.999923, FE, 0);
}

/** Numer strefy PUWG 2000 (5-8) na podstawie długości geograficznej. */
export function puwg2000Zone(lng: number): number {
  return lng < 16.5 ? 5 : lng < 19.5 ? 6 : lng < 22.5 ? 7 : 8;
}

/** Kod EPSG dla danego układu (PUWG 2000 zależny od strefy/długości). */
export function epsgForSystem(system: CoordinateSystem, lng?: number): string {
  if (system === "wgs84") return "4326";
  if (system === "puwg1992") return "2180";
  const zone = lng !== undefined ? puwg2000Zone(lng) : 7;
  return String(2176 + (zone - 5)); // 2176..2179
}

/** Liczba miejsc po przecinku przy eksporcie współrzędnych. */
export function exportPrecision(system: CoordinateSystem): number {
  return system === "wgs84" ? 7 : 2;
}

/** Treść pliku .prj (WKT) dla danego układu. */
export function prjWkt(system: CoordinateSystem, lng?: number): string {
  if (system === "puwg1992") {
    return 'PROJCS["ETRS89 / Poland CS92",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",19],PARAMETER["scale_factor",0.9993],PARAMETER["false_easting",500000],PARAMETER["false_northing",-5300000],UNIT["metre",1],AUTHORITY["EPSG","2180"]]';
  }
  if (system === "puwg2000") {
    const zone = lng !== undefined ? puwg2000Zone(lng) : 7;
    const cm = zone * 3;
    const fe = zone * 1000000 + 500000;
    const epsg = epsgForSystem("puwg2000", lng);
    return `PROJCS["ETRS89 / Poland CS2000 zone ${zone}",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${cm}],PARAMETER["scale_factor",0.999923],PARAMETER["false_easting",${fe}],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","${epsg}"]]`;
  }
  return 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
}
