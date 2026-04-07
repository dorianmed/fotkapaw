import { PhotoPoint, SensorConfig } from "@/types/photo";

/**
 * Calculate ground footprint dimensions at a given altitude.
 */
export function calcFootprint(sensor: SensorConfig, altitudeAGL?: number) {
  const alt = altitudeAGL ?? sensor.flightAltitude;
  // Ground width = (sensorWidth / focalLength) * altitude
  const groundWidth = (sensor.sensorWidth / sensor.focalLength) * alt;
  const groundHeight = (sensor.sensorHeight / sensor.focalLength) * alt;
  return { groundWidth, groundHeight };
}

/**
 * Calculate footprint corners around a center point.
 * Returns 4 corners as [lat, lng][].
 */
export function calcFootprintCorners(
  lat: number,
  lng: number,
  groundWidth: number,
  groundHeight: number
): [number, number][] {
  // Convert meters to approximate degrees
  const latPerMeter = 1 / 111320;
  const lngPerMeter = 1 / (111320 * Math.cos((lat * Math.PI) / 180));

  const halfW = (groundWidth / 2) * lngPerMeter;
  const halfH = (groundHeight / 2) * latPerMeter;

  return [
    [lat - halfH, lng - halfW],
    [lat - halfH, lng + halfW],
    [lat + halfH, lng + halfW],
    [lat + halfH, lng - halfW],
  ];
}

/**
 * Calculate overlap percentage between two photos along a line.
 */
export function calcOverlapBetween(
  p1: PhotoPoint,
  p2: PhotoPoint,
): { forward: number; lateral: number } {
  const dLat = (p2.lat - p1.lat) * 111320;
  const dLng = (p2.lng - p1.lng) * 111320 * Math.cos((p1.lat * Math.PI) / 180);
  const distance = Math.sqrt(dLat * dLat + dLng * dLng);

  // Determine if mostly forward or lateral based on direction
  const avgW = (p1.footprintWidth + p2.footprintWidth) / 2;
  const avgH = (p1.footprintHeight + p2.footprintHeight) / 2;

  const forwardOverlap = Math.max(0, ((avgH - distance) / avgH) * 100);
  const lateralOverlap = Math.max(0, ((avgW - distance) / avgW) * 100);

  return { forward: forwardOverlap, lateral: lateralOverlap };
}

/**
 * Analyze overlap coverage for all photos.
 * Returns overlap statistics.
 */
export function analyzeOverlap(photos: PhotoPoint[]) {
  if (photos.length < 2) return { pairs: [], avgForward: 0, avgLateral: 0 };

  // Sort photos and find nearest neighbors
  const pairs: { i: number; j: number; forward: number; lateral: number; distance: number }[] = [];

  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const p1 = photos[i];
      const p2 = photos[j];
      const dLat = (p2.lat - p1.lat) * 111320;
      const dLng = (p2.lng - p1.lng) * 111320 * Math.cos((p1.lat * Math.PI) / 180);
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);

      // Only consider nearby photos (within 2x footprint)
      const maxDist = Math.max(p1.footprintWidth, p1.footprintHeight) * 2;
      if (distance < maxDist) {
        const overlap = calcOverlapBetween(p1, p2);
        pairs.push({ i, j, ...overlap, distance });
      }
    }
  }

  const avgForward = pairs.length > 0
    ? pairs.reduce((s, p) => s + p.forward, 0) / pairs.length
    : 0;
  const avgLateral = pairs.length > 0
    ? pairs.reduce((s, p) => s + p.lateral, 0) / pairs.length
    : 0;

  return { pairs, avgForward, avgLateral };
}
