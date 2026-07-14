import { OverlapPair, OverlapStats, PhotoPoint, SensorConfig } from "@/types/photo";

type OverlapCandidate = {
  photo: PhotoPoint;
  forward: number;
  lateral: number;
  type: "forward" | "lateral" | "both";
  alongTrack: number;
  acrossTrack: number;
};

/**
 * Baza znanych kamer dronowych (Model EXIF -> wymiary sensora w mm i ogniskowa).
 * Klucz "match" porównywany jest jako zawiera-się (case-insensitive) z exif.Model.
 */
const KNOWN_CAMERAS: { match: string; width: number; height: number; focal?: number }[] = [
  // DJI Phantom 4 Multispectral (każda z 6 kamer: RGB + 5x MS)
  { match: "FC6360", width: 5.0, height: 3.75, focal: 5.73 },
  // DJI Phantom 4 Pro / Advanced (1")
  { match: "FC6310", width: 13.2, height: 8.8, focal: 8.8 },
  { match: "FC330",  width: 6.17, height: 4.55, focal: 3.61 }, // P4 standard
  // DJI Mavic 3 Multispectral – MS sensory 1/2.8" + RGB 4/3 Hasselblad
  { match: "M3M",    width: 5.6,  height: 4.2,  focal: 4.34 },
  { match: "FC8482", width: 17.3, height: 13.0, focal: 12.29 },
  // DJI Mavic 3 / Mavic 3 Enterprise
  { match: "M3E",    width: 17.3, height: 13.0, focal: 12.29 },
  { match: "L1D-20c", width: 13.2, height: 8.8,  focal: 10.26 }, // Mavic 2 Pro
  // DJI Mini / Air
  { match: "FC7203", width: 6.17, height: 4.55, focal: 4.49 },
  { match: "FC2403", width: 6.17, height: 4.55, focal: 4.49 },
  { match: "FC3582", width: 9.65, height: 7.24, focal: 6.72 },
  // Autel
  { match: "XT701",  width: 13.2, height: 8.8,  focal: 10.0 },
  // MicaSense
  { match: "RedEdge", width: 4.8, height: 3.6, focal: 5.5 },
  { match: "Altum",   width: 7.12, height: 5.33, focal: 8.0 },
];

const MULTISPECTRAL_NAME_RE = /(^|[_-])\d{1,2}\.(tif|tiff)$/i;

export function looksLikeMultispectralBand(filename?: string, exif?: any) {
  const name = filename ?? "";
  const widthPx = Number(exif?.ExifImageWidth || exif?.PixelXDimension || exif?.ImageWidth || 0);
  const heightPx = Number(exif?.ExifImageHeight || exif?.PixelYDimension || exif?.ImageHeight || 0);
  return MULTISPECTRAL_NAME_RE.test(name) || (widthPx === 1280 && heightPx === 960 && !exif?.Model && !exif?.FocalLength);
}

/**
 * Estymacja wymiarów sensora z EXIF.
 * Priorytet: znana kamera (Model) -> sensor wprost z EXIF -> 35mm equiv -> FocalPlaneRes -> fallback.
 */
export function estimateSensorDimensions(exif: any, filename?: string) {
  const widthPx = exif.ExifImageWidth || exif.PixelXDimension || exif.ImageWidth || 4000;
  const heightPx = exif.ExifImageHeight || exif.PixelYDimension || exif.ImageHeight || 3000;
  const focal35 = Number(exif.FocalLengthIn35mmFormat);
  const focalReal = Number(exif.FocalLength);
  const exifSensorWidth = Number(exif.SensorWidth || exif.sensorWidth);
  const exifSensorHeight = Number(exif.SensorHeight || exif.sensorHeight);
  const model = String(exif.Model || exif.model || "").trim();

  if (looksLikeMultispectralBand(filename, exif)) {
    return {
      width: 5.0, height: 3.75, focal: focalReal > 0 ? focalReal : 5.73,
      resX: widthPx, resY: heightPx, source: "estimated" as const,
    };
  }

  // 1) Znana kamera po Model
  if (model) {
    const m = model.toUpperCase();
    const hit = KNOWN_CAMERAS.find((c) => m.includes(c.match.toUpperCase()));
    if (hit) {
      return {
        width: hit.width, height: hit.height,
        focal: focalReal > 0 ? focalReal : (hit.focal ?? 8.8),
        resX: widthPx, resY: heightPx, source: "exif" as const,
      };
    }
  }

  // 2) Sensor podany wprost w EXIF
  if (exifSensorWidth > 0 && exifSensorHeight > 0 && focalReal > 0) {
    return {
      width: exifSensorWidth, height: exifSensorHeight, focal: focalReal,
      resX: widthPx, resY: heightPx, source: "exif" as const,
    };
  }

  // 3) 35mm equivalent
  if (focal35 > 0 && focalReal > 0) {
    const cropFactor = focal35 / focalReal;
    const estimatedWidth = 36 / cropFactor;
    const aspectRatio = widthPx / heightPx;
    return {
      width: estimatedWidth, height: estimatedWidth / aspectRatio, focal: focalReal,
      resX: widthPx, resY: heightPx, source: "estimated" as const,
    };
  }

  // 4) FocalPlaneResolution
  const fpResX = Number(exif.FocalPlaneXResolution);
  const fpResUnit = Number(exif.FocalPlaneResolutionUnit); // 2=inch, 3=cm, 4=mm
  if (fpResX > 0 && focalReal > 0) {
    let pixelPitchMm: number;
    if (fpResUnit === 3) pixelPitchMm = 10 / fpResX;
    else if (fpResUnit === 4) pixelPitchMm = 1 / fpResX;
    else pixelPitchMm = 25.4 / fpResX;
    return {
      width: widthPx * pixelPitchMm, height: heightPx * pixelPitchMm, focal: focalReal,
      resX: widthPx, resY: heightPx, source: "estimated" as const,
    };
  }

  // 5) Fallback
  return {
    width: 13.2, height: 8.8,
    focal: focalReal > 0 ? focalReal : 8.8,
    resX: widthPx, resY: heightPx, source: "fallback" as const,
  };
}

export function calcFootprint(sensor: SensorConfig, altitudeAGL?: number) {
  const alt = altitudeAGL ?? sensor.flightAltitude;
  const groundWidth = (sensor.sensorWidth / sensor.focalLength) * alt;
  const groundHeight = (sensor.sensorHeight / sensor.focalLength) * alt;
  return { groundWidth, groundHeight };
}

export function calcGSD(sensor: SensorConfig, altitudeAGL?: number): number {
  const alt = altitudeAGL ?? sensor.flightAltitude;
  const gsdX = (sensor.sensorWidth / (sensor.focalLength * sensor.resolutionX)) * alt * 100;
  const gsdY = (sensor.sensorHeight / (sensor.focalLength * sensor.resolutionY)) * alt * 100;
  return (gsdX + gsdY) / 2;
}

export function calcFootprintCorners(
  lat: number,
  lng: number,
  groundWidth: number,
  groundHeight: number,
  headingDeg: number = 0
): [number, number][] {
  const latPerMeter = 1 / 111320;
  const lngPerMeter = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const halfW = groundWidth / 2;
  const halfH = groundHeight / 2;

  const corners = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
  const rad = (headingDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return corners.map(([x, y]) => {
    const rx = x * cosA + y * sinA;
    const ry = -x * sinA + y * cosA;
    return [lat + ry * latPerMeter, lng + rx * lngPerMeter] as [number, number];
  });
}

export function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function projectPhotoOffsetMeters(origin: PhotoPoint, target: PhotoPoint) {
  const distance = calcDistance(origin.lat, origin.lng, target.lat, target.lng);
  const bearing = calcBearing(origin.lat, origin.lng, target.lat, target.lng);
  const headingDiffSigned = (((bearing - (origin.heading ?? 0)) + 540) % 360) - 180;
  const radians = (headingDiffSigned * Math.PI) / 180;

  return {
    distance,
    headingDiff: Math.abs(headingDiffSigned),
    alongTrack: distance * Math.cos(radians),
    acrossTrack: distance * Math.sin(radians),
  };
}

function calcAxisOverlapPercent(shift: number, dimension: number) {
  if (dimension <= 0) return 0;
  return Math.max(0, (1 - Math.abs(shift) / dimension) * 100);
}

export function assignHeadings(photos: PhotoPoint[]): PhotoPoint[] {
  if (photos.length < 2) return photos;
  const sorted = [...photos].sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));

  // Use IMMEDIATE neighbour for heading (i → i+1). Lookahead of 3 photos
  // crossed strips and produced wildly wrong "along-track" decomposition.
  return sorted.map((photo, index) => {
    if (typeof photo.heading === "number" && Number.isFinite(photo.heading)) return photo;
    const heading = index < sorted.length - 1
      ? calcBearing(photo.lat, photo.lng, sorted[index + 1].lat, sorted[index + 1].lng)
      : calcBearing(sorted[index - 1].lat, sorted[index - 1].lng, photo.lat, photo.lng);
    return { ...photo, heading };
  });
}

export function findOverlappingPhotos(selected: PhotoPoint, photos: PhotoPoint[]): OverlapCandidate[] {
  const results: OverlapCandidate[] = [];
  for (const photo of photos) {
    if (photo.id === selected.id) continue;
    const { distance, alongTrack, acrossTrack } = projectPhotoOffsetMeters(selected, photo);
    const maxReach = Math.max(selected.footprintWidth, selected.footprintHeight, photo.footprintWidth, photo.footprintHeight);
    if (distance > maxReach * 2) continue;
    const avgAlongDim = (selected.footprintHeight + photo.footprintHeight) / 2;
    const avgAcrossDim = (selected.footprintWidth + photo.footprintWidth) / 2;
    const forward = calcAxisOverlapPercent(Math.abs(alongTrack), avgAlongDim);
    const lateral = calcAxisOverlapPercent(Math.abs(acrossTrack), avgAcrossDim);
    const type: "forward" | "lateral" | "both" = forward > 0 && lateral > 0
      ? "both"
      : Math.abs(alongTrack) >= Math.abs(acrossTrack) ? "forward" : "lateral";
    if (forward > 0 || lateral > 0) {
      results.push({ photo, forward, lateral, type, alongTrack, acrossTrack });
    }
  }
  return results;
}

/**
 * Pokrycie obliczane bezpośrednio z geometrii:
 *  - podłużne (forward): pomiędzy sąsiednimi w czasie zdjęciami w obrębie tego samego pasa
 *      forward% = (1 - odległość / średnia długość footprintu w osi lotu) * 100
 *  - poprzeczne (lateral): najbliższy sąsiad NIE-czasowy w kierunku prostopadłym do osi lotu
 *      lateral% = (1 - odległość prostopadła / średnia szerokość footprintu) * 100
 */
export function analyzeOverlap(photos: PhotoPoint[]): OverlapStats {
  if (photos.length < 2) return { pairs: [], avgForward: 0, avgLateral: 0 };

  const sorted = [...photos].sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
  const forwardPairs: OverlapPair[] = [];
  const lateralPairs = new Map<string, OverlapPair>();

  // Forward: kolejne pary w czasie w tym samym pasie.
  // Wzór fotogrametryczny: p = (d_p - b_p) / d_p * 100%,
  // gdzie d_p = długość kadru w osi lotu (footprintHeight), b_p = baza podłużna.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const { alongTrack, acrossTrack } = projectPhotoOffsetMeters(a, b);
    const along = Math.abs(alongTrack);
    const across = Math.abs(acrossTrack);
    const avgAlongDim = (a.footprintHeight + b.footprintHeight) / 2;
    const avgAcrossDim = (a.footprintWidth + b.footprintWidth) / 2;
    if (avgAlongDim <= 0 || avgAcrossDim <= 0) continue;
    // Skok na sąsiedni pas: zbyt duża składowa poprzeczna albo zbyt długa baza.
    if (across > avgAcrossDim * 0.45) continue;
    if (along <= 0.05 || along > avgAlongDim * 1.5) continue;
    const forward = calcAxisOverlapPercent(along, avgAlongDim);
    if (forward > 0) {
      forwardPairs.push({
        id1: a.id, id2: b.id, forward, lateral: 0, type: "forward",
        alongTrack: along, acrossTrack: across,
      });
    }
  }

  // Lateral: dla każdego zdjęcia szukamy najbliższego sąsiada w sąsiednim pasie.
  // Wzór: q = (w - b_q) / w * 100%, gdzie w = szerokość kadru,
  // b_q = odległość między pasami (składowa poprzeczna).
  for (let i = 0; i < sorted.length; i++) {
    const photo = sorted[i];
    let best: { other: PhotoPoint; lateralDist: number; alongDist: number } | null = null;
    for (let j = 0; j < sorted.length; j++) {
      if (j === i) continue;
      if (sorted.length > 2 && (j === i - 1 || j === i + 1)) continue;
      const other = sorted[j];
      const { distance, acrossTrack, alongTrack } = projectPhotoOffsetMeters(photo, other);
      const avgAlongDim = (photo.footprintHeight + other.footprintHeight) / 2;
      const avgAcrossDim = (photo.footprintWidth + other.footprintWidth) / 2;
      const alongDist = Math.abs(alongTrack);
      const lateralDist = Math.abs(acrossTrack);
      // Sąsiedni pas: podobna pozycja w osi lotu, istotna składowa poprzeczna.
      if (alongDist > avgAlongDim * 0.75) continue;
      if (lateralDist < avgAcrossDim * 0.08) continue;
      if (lateralDist > avgAcrossDim * 1.5) continue;
      if (distance > Math.max(avgAlongDim, avgAcrossDim) * 2) continue;
      if (!best || alongDist < best.alongDist || (Math.abs(alongDist - best.alongDist) < 0.1 && lateralDist < best.lateralDist)) {
        best = { other, lateralDist, alongDist };
      }
    }
    if (best) {
      const avgAcrossDim = (photo.footprintWidth + best.other.footprintWidth) / 2;
      if (avgAcrossDim <= 0) continue;
      const lateral = calcAxisOverlapPercent(best.lateralDist, avgAcrossDim);
      if (lateral <= 0) continue;
      const key = [photo.id, best.other.id].sort().join("-");
      if (!lateralPairs.has(key)) {
        lateralPairs.set(key, {
          id1: photo.id, id2: best.other.id, forward: 0, lateral, type: "lateral",
          alongTrack: best.alongDist, acrossTrack: best.lateralDist,
        });
      }
    }
  }

  const fwd = forwardPairs.map((p) => p.forward).filter((v) => v > 0);
  const lat = [...lateralPairs.values()].map((p) => p.lateral).filter((v) => v > 0);
  return {
    pairs: [...forwardPairs, ...lateralPairs.values()],
    avgForward: fwd.length ? fwd.reduce((s, v) => s + v, 0) / fwd.length : 0,
    avgLateral: lat.length ? lat.reduce((s, v) => s + v, 0) / lat.length : 0,
  };
}