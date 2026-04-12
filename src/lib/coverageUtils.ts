import { PhotoPoint, KmlLayer } from "@/types/photo";

/** Point-in-polygon test (ray casting) */
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0], xi = polygon[i][1];
    const yj = polygon[j][0], xj = polygon[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Extract all polygon rings from a KML layer's GeoJSON */
function extractPolygons(layer: KmlLayer): [number, number][][] {
  const polygons: [number, number][][] = [];
  for (const feature of layer.geojson.features) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
      // GeoJSON coords are [lng, lat], convert to [lat, lng]
      const ring = (geom.coordinates as number[][][])[0].map(
        (c) => [c[1], c[0]] as [number, number]
      );
      polygons.push(ring);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates as number[][][][]) {
        const ring = poly[0].map((c) => [c[1], c[0]] as [number, number]);
        polygons.push(ring);
      }
    }
  }
  return polygons;
}

export interface CoverageResult {
  /** 0-100% */
  coveragePercent: number;
  totalCells: number;
  coveredCells: number;
  /** Uncovered grid cells as [lat, lng] center points */
  gaps: { lat: number; lng: number; latSize: number; lngSize: number }[];
}

/**
 * Check what percentage of a KML polygon area is covered by photo footprints.
 * Uses a grid sampling approach.
 */
export function analyzeCoverage(
  layer: KmlLayer,
  photos: PhotoPoint[],
  gridResolution = 50
): CoverageResult {
  const polygons = extractPolygons(layer);
  if (polygons.length === 0) {
    return { coveragePercent: 0, totalCells: 0, coveredCells: 0, gaps: [] };
  }

  // Find bounding box of all polygons
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const ring of polygons) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  const latStep = (maxLat - minLat) / gridResolution;
  const lngStep = (maxLng - minLng) / gridResolution;

  if (latStep === 0 || lngStep === 0) {
    return { coveragePercent: 0, totalCells: 0, coveredCells: 0, gaps: [] };
  }

  // Pre-filter photos that have footprint corners
  const photosWithCorners = photos.filter((p) => p.footprintCorners.length === 4);

  let totalCells = 0;
  let coveredCells = 0;
  const gaps: CoverageResult["gaps"] = [];

  for (let i = 0; i < gridResolution; i++) {
    for (let j = 0; j < gridResolution; j++) {
      const cellLat = minLat + latStep * (i + 0.5);
      const cellLng = minLng + lngStep * (j + 0.5);

      // Check if this cell center is inside any KML polygon
      let insideKml = false;
      for (const ring of polygons) {
        if (pointInPolygon(cellLat, cellLng, ring)) {
          insideKml = true;
          break;
        }
      }
      if (!insideKml) continue;

      totalCells++;

      // Check if covered by any photo footprint
      let covered = false;
      for (const photo of photosWithCorners) {
        if (pointInPolygon(cellLat, cellLng, photo.footprintCorners)) {
          covered = true;
          break;
        }
      }

      if (covered) {
        coveredCells++;
      } else {
        gaps.push({ lat: cellLat, lng: cellLng, latSize: latStep, lngSize: lngStep });
      }
    }
  }

  const coveragePercent = totalCells > 0 ? (coveredCells / totalCells) * 100 : 0;

  return { coveragePercent, totalCells, coveredCells, gaps };
}
