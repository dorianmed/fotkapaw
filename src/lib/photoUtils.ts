import { PhotoPoint, SensorConfig } from "@/types/photo";

/**
 * Estymuje wymiary sensora na podstawie danych EXIF.
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

/**
 * Poprawiona funkcja obliczania rogów z rotacją zgodną z ruchem wskazówek zegara (Azymut).
 */
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

  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];

  const rad = (headingDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return corners.map(([x, y]) => {
    // Rotacja dla współrzędnych geograficznych (CW)
    const rx = x * cosA + y * sinA;
    const ry = -x * sinA + y * cosA;
    return [lat + ry * latPerMeter, lng + rx * lngPerMeter] as [number, number];
  });
}

/**
 * Próbuje oszacować wymiary sensora (mm) na podstawie danych EXIF.
 * Jeśli brakuje danych, zwraca wartości z domyślnego sensora.
 */
export function estimateSensorDimensions(exif: any, defaultSensor: SensorConfig) {
  // Próbujemy wyciągnąć rozdzielczość (różne aparaty różnie to nazywają)
  const widthPx = exif.ExifImageWidth || exif.PixelXDimension || exif.ImageWidth || 4000;
  const heightPx = exif.ExifImageHeight || exif.PixelYDimension || exif.ImageHeight || 3000;
  
  const focal35 = exif.FocalLengthIn35mmFormat;
  const focalReal = exif.FocalLength;

  // Jeśli mamy obie ogniskowe, możemy policzyć Crop Factor i rozmiar matrycy
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

  // Jeśli nie, wracamy do bezpiecznych domyślnych danych
  return {
    width: defaultSensor.sensorWidth,
    height: defaultSensor.sensorHeight,
    focal: focalReal || defaultSensor.focalLength || 24,
    resX: widthPx
  };
}
  return {
    width: defaultSensor.sensorWidth,
    height: defaultSensor.sensorHeight,
    focal: focalReal || defaultSensor.focalLength,
    resX: widthPx || defaultSensor.resolutionX
  };
}

/**
 * Calculate ground footprint dimensions at a given altitude.
 */
export function calcFootprint(sensor: SensorConfig, altitudeAGL?: number) {
  const alt = altitudeAGL ?? sensor.flightAltitude;
  const groundWidth = (sensor.sensorWidth / sensor.focalLength) * alt;
  const groundHeight = (sensor.sensorHeight / sensor.focalLength) * alt;
  return { groundWidth, groundHeight };
}

/**
 * Calculate GSD (Ground Sample Distance) in cm/px.
 */
export function calcGSD(sensor: SensorConfig, altitudeAGL?: number): number {
  const alt = altitudeAGL ?? sensor.flightAltitude;
  // GSD = (sensorWidth_mm / (focalLength_mm * resolutionX)) * altitude_m * 100 (to cm)
  return (sensor.sensorWidth / (sensor.focalLength * sensor.resolutionX)) * alt * 100;
}

/**
 * Calculate footprint corners around a center point, rotated by heading.
 * Heading in degrees, 0=north, clockwise.
 * The longer side (width) is perpendicular to flight direction.
 */
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

  // Unrotated corners relative to center (in meters, x=east, y=north)
  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];

  const rad = (headingDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return corners.map(([x, y]) => {
    const rx = x * cosA - y * sinA;
    const ry = x * sinA + y * cosA;
    return [lat + ry * latPerMeter, lng + rx * lngPerMeter] as [number, number];
  });
}

/**
 * Calculate heading (bearing) between two points in degrees.
 */
export function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Calculate distance in meters between two GPS points.
 */
export function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Calculate speed between two photos in m/s.
 */
export function calcSpeed(p1: PhotoPoint, p2: PhotoPoint): number | undefined {
  if (!p1.timestamp || !p2.timestamp) return undefined;
  const dt = Math.abs(p2.timestamp.getTime() - p1.timestamp.getTime()) / 1000;
  if (dt === 0) return undefined;
  const dist = calcDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  return dist / dt;
}

/**
 * Assign headings to photos based on flight direction.
 * Photos should be sorted by timestamp or filename.
 */
export function assignHeadings(photos: PhotoPoint[]): PhotoPoint[] {
  if (photos.length < 2) return photos;

  const sorted = [...photos].sort((a, b) => {
    if (a.timestamp && b.timestamp) return a.timestamp.getTime() - b.timestamp.getTime();
    return a.filename.localeCompare(b.filename);
  });

  return sorted.map((photo, i) => {
    let heading: number;
    
    // Aproksymacja: patrzymy 3 punkty w przód/tył, aby zniwelować błędy i "pływanie" GPS
    const lookAheadIndex = Math.min(i + 3, sorted.length - 1);
    const lookBackIndex = Math.max(i - 3, 0);

    if (i < sorted.length - 1 && lookAheadIndex > i) {
      heading = calcBearing(photo.lat, photo.lng, sorted[lookAheadIndex].lat, sorted[lookAheadIndex].lng);
    } else {
      heading = calcBearing(sorted[lookBackIndex].lat, sorted[lookBackIndex].lng, photo.lat, photo.lng);
    }

    let speed: number | undefined;
    if (i < sorted.length - 1) {
      speed = calcSpeed(photo, sorted[i + 1]);
    } else if (i > 0) {
      speed = calcSpeed(sorted[i - 1], photo);
    }

    return { ...photo, heading, speed };
  });
}

/**
 * Calculate overlap percentage between two photos along a line.
 */
export function calcOverlapBetween(
  p1: PhotoPoint,
  p2: PhotoPoint,
): { forward: number; lateral: number } {
  const dist = calcDistance(p1.lat, p1.lng, p2.lat, p2.lng);

  // Determine direction relative to flight heading
  const bearing = calcBearing(p1.lat, p1.lng, p2.lat, p2.lng);
  const headingDiff = Math.abs(((bearing - (p1.heading ?? 0)) + 180) % 360 - 180);

  // If along flight direction (within 45°), it's forward overlap
  // Otherwise it's lateral
  const avgH = (p1.footprintHeight + p2.footprintHeight) / 2;
  const avgW = (p1.footprintWidth + p2.footprintWidth) / 2;

  if (headingDiff < 45 || headingDiff > 135) {
    // Forward direction - overlap based on footprint height (along-track)
    const forwardOverlap = Math.max(0, ((avgH - dist) / avgH) * 100);
    return { forward: forwardOverlap, lateral: 0 };
  } else {
    // Lateral direction
    const lateralOverlap = Math.max(0, ((avgW - dist) / avgW) * 100);
    return { forward: 0, lateral: lateralOverlap };
  }
}

/**
 * Analyze overlap coverage for all photos.
 */
export function analyzeOverlap(photos: PhotoPoint[]) {
  if (photos.length < 2) return { pairs: [], avgForward: 0, avgLateral: 0 };

  const pairs: { i: number; j: number; forward: number; lateral: number; distance: number }[] = [];

  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const p1 = photos[i];
      const p2 = photos[j];
      const distance = calcDistance(p1.lat, p1.lng, p2.lat, p2.lng);

      const maxDist = Math.max(p1.footprintWidth, p1.footprintHeight) * 2;
      if (distance < maxDist) {
        const overlap = calcOverlapBetween(p1, p2);
        pairs.push({ i, j, ...overlap, distance });
      }
    }
  }

  const forwardPairs = pairs.filter(p => p.forward > 0);
  const lateralPairs = pairs.filter(p => p.lateral > 0);

  const avgForward = forwardPairs.length > 0
    ? forwardPairs.reduce((s, p) => s + p.forward, 0) / forwardPairs.length
    : 0;
  const avgLateral = lateralPairs.length > 0
    ? lateralPairs.reduce((s, p) => s + p.lateral, 0) / lateralPairs.length
    : 0;

  return { pairs, avgForward, avgLateral };
}

/**
 * Find photos overlapping with a given photo.
 */
export function findOverlappingPhotos(photo: PhotoPoint, allPhotos: PhotoPoint[]): { photo: PhotoPoint; forward: number; lateral: number }[] {
  const results: { photo: PhotoPoint; forward: number; lateral: number }[] = [];
  for (const other of allPhotos) {
    if (other.id === photo.id) continue;
    const dist = calcDistance(photo.lat, photo.lng, other.lat, other.lng);
    const maxDist = Math.max(photo.footprintWidth, photo.footprintHeight) * 2;
    if (dist < maxDist) {
      const overlap = calcOverlapBetween(photo, other);
      if (overlap.forward > 0 || overlap.lateral > 0) {
        results.push({ photo: other, ...overlap });
      }
    }
  }
  return results;
}
