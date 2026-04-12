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
 * Próbuje oszacować wymiary sensora z EXIF.
 * Priorytet: 35mm equivalent + focal, potem bezpośrednie pola EXIF, na końcu fallback techniczny.
 */
export function estimateSensorDimensions(exif: any) {
  const widthPx = exif.ExifImageWidth || exif.PixelXDimension || exif.ImageWidth || 4000;
  const heightPx = exif.ExifImageHeight || exif.PixelYDimension || exif.ImageHeight || 3000;
  const focal35 = Number(exif.FocalLengthIn35mmFormat);
  const focalReal = Number(exif.FocalLength);
  const exifSensorWidth = Number(exif.SensorWidth || exif.sensorWidth);
  const exifSensorHeight = Number(exif.SensorHeight || exif.sensorHeight);

  // Try pixel pitch from FocalPlaneResolution
  const fpResX = Number(exif.FocalPlaneXResolution);
  const fpResUnit = Number(exif.FocalPlaneResolutionUnit); // 2=inch, 3=cm, 4=mm

  if (focal35 > 0 && focalReal > 0) {
    const cropFactor = focal35 / focalReal;
    const estimatedWidth = 36 / cropFactor;
    const aspectRatio = widthPx / heightPx;
    return {
      width: estimatedWidth,
      height: estimatedWidth / aspectRatio,
      focal: focalReal,
      resX: widthPx,
      resY: heightPx,
      source: "estimated" as const,
    };
  }

  if (exifSensorWidth > 0 && exifSensorHeight > 0 && focalReal > 0) {
    return {
      width: exifSensorWidth,
      height: exifSensorHeight,
      focal: focalReal,
      resX: widthPx,
      resY: heightPx,
      source: "exif" as const,
    };
  }

  // Try deriving from FocalPlaneResolution
  if (fpResX > 0 && focalReal > 0) {
    let pixelPitchMm: number;
    if (fpResUnit === 3) pixelPitchMm = 10 / fpResX; // cm
    else if (fpResUnit === 4) pixelPitchMm = 1 / fpResX; // mm
    else pixelPitchMm = 25.4 / fpResX; // inch (default)
    const sw = widthPx * pixelPitchMm;
    const sh = heightPx * pixelPitchMm;
    return {
      width: sw,
      height: sh,
      focal: focalReal,
      resX: widthPx,
      resY: heightPx,
      source: "estimated" as const,
    };
  }

  // Fallback: assume typical small sensor
  return {
    width: 13.2,
    height: 8.8,
    focal: focalReal > 0 ? focalReal : 8.8,
    resX: widthPx,
    resY: heightPx,
    source: "fallback" as const,
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
  return (sensor.sensorWidth / (sensor.focalLength * sensor.resolutionX)) * alt * 100;
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

  return sorted.map((photo, index) => {
    const nextIdx = Math.min(index + 3, sorted.length - 1);
    const prevIdx = Math.max(index - 3, 0);
    const heading = index < sorted.length - 1
      ? calcBearing(photo.lat, photo.lng, sorted[nextIdx].lat, sorted[nextIdx].lng)
      : calcBearing(sorted[prevIdx].lat, sorted[prevIdx].lng, photo.lat, photo.lng);

    return { ...photo, heading };
  });
}

export function findOverlappingPhotos(selected: PhotoPoint, photos: PhotoPoint[]): OverlapCandidate[] {
  const results: OverlapCandidate[] = [];

  for (const photo of photos) {
    if (photo.id === selected.id) continue;

    const { distance, headingDiff, alongTrack, acrossTrack } = projectPhotoOffsetMeters(selected, photo);
    const maxReach = Math.max(selected.footprintWidth, selected.footprintHeight, photo.footprintWidth, photo.footprintHeight);
    if (distance > maxReach * 2) continue;

    const avgAlongDim = (selected.footprintHeight + photo.footprintHeight) / 2;
    const avgAcrossDim = (selected.footprintWidth + photo.footprintWidth) / 2;
    const forward = calcAxisOverlapPercent(alongTrack, avgAlongDim);
    const lateral = calcAxisOverlapPercent(acrossTrack, avgAcrossDim);
    const type: "forward" | "lateral" | "both" = headingDiff < 45 || headingDiff > 135 ? "forward" : "lateral";

    if (forward > 0 || lateral > 0) {
      results.push({
        photo,
        forward,
        lateral,
        type,
        alongTrack,
        acrossTrack,
      });
    }
  }

  return results;
}

function addUniquePair(collection: Map<string, OverlapPair>, sourceId: string, candidate: OverlapCandidate) {
  const key = [sourceId, candidate.photo.id].sort().join("-");
  if (collection.has(key)) return;

  collection.set(key, {
    id1: sourceId,
    id2: candidate.photo.id,
    forward: candidate.forward,
    lateral: candidate.lateral,
    type: candidate.type,
    alongTrack: Math.abs(candidate.alongTrack),
    acrossTrack: Math.abs(candidate.acrossTrack),
  });
}

export function analyzeOverlap(photos: PhotoPoint[]): OverlapStats {
  if (photos.length < 2) return { pairs: [], avgForward: 0, avgLateral: 0 };

  const sortedPhotos = [...photos].sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
  const forwardPairs = new Map<string, OverlapPair>();
  const lateralPairs = new Map<string, OverlapPair>();

  for (const photo of sortedPhotos) {
    const overlaps = findOverlappingPhotos(photo, sortedPhotos);

    const nearestForward = overlaps
      .filter((candidate) => candidate.type === "forward" && candidate.forward > 0 && candidate.alongTrack > 0)
      .sort((a, b) => Math.abs(a.alongTrack) - Math.abs(b.alongTrack))[0];

    if (nearestForward) {
      addUniquePair(forwardPairs, photo.id, nearestForward);
    }

    const nearestLateral = overlaps
      .filter((candidate) => candidate.type === "lateral" && candidate.lateral > 0)
      .sort((a, b) => Math.abs(a.acrossTrack) - Math.abs(b.acrossTrack))[0];

    if (nearestLateral) {
      addUniquePair(lateralPairs, photo.id, nearestLateral);
    }
  }

  const forwardValues = [...forwardPairs.values()].map((pair) => pair.forward).filter((value) => value > 0);
  const lateralValues = [...lateralPairs.values()].map((pair) => pair.lateral).filter((value) => value > 0);
  const pairs = [...forwardPairs.values(), ...lateralPairs.values()];

  return {
    pairs,
    avgForward: forwardValues.length > 0 ? forwardValues.reduce((sum, value) => sum + value, 0) / forwardValues.length : 0,
    avgLateral: lateralValues.length > 0 ? lateralValues.reduce((sum, value) => sum + value, 0) / lateralValues.length : 0,
  };
}