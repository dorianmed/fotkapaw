export interface PhotoPoint {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  altitude?: number;
  timestamp?: Date;
  heading?: number; // flight heading in degrees
  speed?: number; // m/s
  thumbnailUrl?: string;
  // Ground footprint in meters
  footprintWidth: number;
  footprintHeight: number;
  // Footprint corners [lat, lng][]
  footprintCorners: [number, number][];
  gsd?: number; // ground sample distance in cm/px
  // Per-photo sensor info from EXIF
  sensorInfo?: {
    sensorWidth: number;
    sensorHeight: number;
    focalLength: number;
    resolutionX: number;
    source?: "exif" | "estimated" | "fallback";
  };
}

export interface KmlLayer {
  id: string;
  name: string;
  visible: boolean;
  color: string;
  geojson: GeoJSON.FeatureCollection;
}

export interface SensorConfig {
  resolutionX: number;
  resolutionY: number;
  sensorWidth: number;  // mm
  sensorHeight: number; // mm
  focalLength: number;  // mm
  flightAltitude: number; // meters AGL
}

export interface OverlapPair {
  id1: string;
  id2: string;
  forward: number;
  lateral: number;
  type: "forward" | "lateral" | "both";
  alongTrack: number;
  acrossTrack: number;
}

export interface OverlapStats {
  pairs: OverlapPair[];
  avgForward: number;
  avgLateral: number;
}

export type MeasureMode = "none" | "distance" | "area";

export interface MeasurementSummary {
  distanceMeters: number;
  areaSquareMeters: number;
  pointCount: number;
}

export const DEFAULT_SENSOR: SensorConfig = {
  resolutionX: 1280,
  resolutionY: 960,
  sensorWidth: 4.8,
  sensorHeight: 3.6,
  focalLength: 5.4,
  flightAltitude: 120,
};
