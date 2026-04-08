import { PhotoPoint, SensorConfig } from "@/types/photo";

/**
 * Próbuje oszacować wymiary sensora na podstawie EXIF lub wraca do domyślnych.
 */
export function estimateSensorDimensions(exif: any, defaultSensor: SensorConfig) {
  const widthPx = exif.ExifImageWidth || exif.PixelXDimension || exif.ImageWidth || 4000;
  const heightPx = exif.ExifImageHeight || exif.PixelYDimension || exif.ImageHeight || 3000;
  const focal35 = exif.FocalLengthIn35mmFormat;
  const focalReal = exif.FocalLength;

  if (focal35 && focalReal && focalReal > 0) {
    const cropFactor = focal35 / focalReal;
    const estimatedWidth = 36 / cropFactor;
    const aspectRatio = widthPx / heightPx;
    return {
      width: estimatedWidth,
      height: estimatedWidth / aspectRatio,
      focal: focalReal,
      resX: widthPx
    };
  }

  return {
    width: defaultSensor.sensorWidth,
    height: defaultSensor.sensorHeight,
    focal: focalReal || defaultSensor.focalLength,
    resX: widthPx
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
  const dLng = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function assignHeadings(photos: PhotoPoint[]): PhotoPoint[] {
  if (photos.length < 2) return photos;
  const sorted = [...photos].sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));

  return sorted.map((photo, i) => {
    const nextIdx = Math.min(i + 3, sorted.length - 1);
    const prevIdx = Math.max(i - 3, 0);
    const heading = (i < sorted.length - 1) 
      ? calcBearing(photo.lat, photo.lng, sorted[nextIdx].lat, sorted[nextIdx].lng)
      : calcBearing(sorted[prevIdx].lat, sorted[prevIdx].lng, photo.lat, photo.lng);
    return { ...photo, heading };
  });
}

export function findOverlappingPhotos(selected: PhotoPoint, photos: PhotoPoint[]): { photo: PhotoPoint; forward: number; lateral: number; type: "forward" | "lateral" | "both" }[] {
  const results: { photo: PhotoPoint; forward: number; lateral: number; type: "forward" | "lateral" | "both" }[] = [];
  for (const p of photos) {
    if (p.id === selected.id) continue;
    const dist = calcDistance(selected.lat, selected.lng, p.lat, p.lng);
    const maxReach = Math.max(selected.footprintWidth, selected.footprintHeight, p.footprintWidth, p.footprintHeight);
    if (dist > maxReach * 2) continue;

    const bearing = calcBearing(selected.lat, selected.lng, p.lat, p.lng);
    const headingDiff = Math.abs(((bearing - (selected.heading ?? 0)) + 180) % 360 - 180);

    // Along-track = component along flight direction
    const alongTrack = dist * Math.cos(headingDiff * Math.PI / 180);
    // Across-track = component perpendicular to flight direction
    const acrossTrack = dist * Math.abs(Math.sin(headingDiff * Math.PI / 180));

    // footprintHeight = short side = along-track dimension
    // footprintWidth = long side = across-track dimension
    const avgAlongDim = (selected.footprintHeight + p.footprintHeight) / 2;
    const avgAcrossDim = (selected.footprintWidth + p.footprintWidth) / 2;

    const forward = Math.max(0, (1 - Math.abs(alongTrack) / avgAlongDim) * 100);
    const lateral = Math.max(0, (1 - acrossTrack / avgAcrossDim) * 100);

    // Classify pair: if bearing is mostly along heading → forward pair, else → lateral pair
    const type: "forward" | "lateral" | "both" = headingDiff < 45 || headingDiff > 135 ? "forward" : "lateral";

    if (forward > 0 || lateral > 0) {
      results.push({ photo: p, forward, lateral, type });
    }
  }
  return results;
}

export function analyzeOverlap(photos: PhotoPoint[]) {
  if (photos.length < 2) return { pairs: [], avgForward: 0, avgLateral: 0 };
  
  const pairs: { id1: string; id2: string; forward: number; lateral: number; type: "forward" | "lateral" | "both" }[] = [];
  const seen = new Set<string>();
  
  for (let i = 0; i < photos.length; i++) {
    const overlaps = findOverlappingPhotos(photos[i], photos);
    for (const o of overlaps) {
      const key = [photos[i].id, o.photo.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ id1: photos[i].id, id2: o.photo.id, forward: o.forward, lateral: o.lateral, type: o.type });
    }
  }
  
  // Forward overlap: only from along-track pairs (same strip)
  const forwardPairs = pairs.filter(p => p.type === "forward" && p.forward > 0);
  // Lateral overlap: only from cross-track pairs (between strips)
  const lateralPairs = pairs.filter(p => p.type === "lateral" && p.lateral > 0);
  
  const avgForward = forwardPairs.length > 0
    ? forwardPairs.reduce((s, p) => s + p.forward, 0) / forwardPairs.length
    : 0;
  const avgLateral = lateralPairs.length > 0
    ? lateralPairs.reduce((s, p) => s + p.lateral, 0) / lateralPairs.length
    : 0;
  
  return { pairs, avgForward, avgLateral };
}
