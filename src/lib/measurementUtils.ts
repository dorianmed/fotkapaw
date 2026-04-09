import { PhotoPoint } from "@/types/photo";
import { calcDistance } from "@/lib/photoUtils";

export interface SnapTarget {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "center" | "corner";
  photoId: string;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export function createPhotoSnapTargets(photos: PhotoPoint[]): SnapTarget[] {
  return photos.flatMap((photo) => {
    const center: SnapTarget = {
      id: `${photo.id}-center`,
      lat: photo.lat,
      lng: photo.lng,
      label: `${photo.filename} · środek`,
      kind: "center",
      photoId: photo.id,
    };

    const corners = photo.footprintCorners.map(([lat, lng], index) => ({
      id: `${photo.id}-corner-${index}`,
      lat,
      lng,
      label: `${photo.filename} · narożnik ${index + 1}`,
      kind: "corner" as const,
      photoId: photo.id,
    }));

    return [center, ...corners];
  });
}

export function findNearestSnapTarget(point: LatLngPoint, targets: SnapTarget[], snapDistanceMeters: number = 15) {
  let nearest: SnapTarget | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const distance = calcDistance(point.lat, point.lng, target.lat, target.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = target;
    }
  }

  return nearest && nearestDistance <= snapDistanceMeters ? nearest : null;
}

export function calcPolylineDistance(points: LatLngPoint[]) {
  if (points.length < 2) return 0;

  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += calcDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return distance;
}

export function calcPolygonArea(points: LatLngPoint[]) {
  if (points.length < 3) return 0;

  const origin = points[0];
  const meanLatRadians = (points.reduce((sum, point) => sum + point.lat, 0) / points.length) * Math.PI / 180;
  const projected = points.map((point) => ({
    x: (point.lng - origin.lng) * 111320 * Math.cos(meanLatRadians),
    y: (point.lat - origin.lat) * 111320,
  }));

  let sum = 0;
  for (let i = 0; i < projected.length; i++) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) / 2;
}