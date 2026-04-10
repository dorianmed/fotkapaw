export interface PhotoPoint {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  altitude?: number;
  timestamp?: Date;
  heading?: number;
  speed?: number;
  thumbnailUrl?: string;
  footprintWidth: number;
  footprintHeight: number;
  footprintCorners: [number, number][];
  gsd?: number;
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
  weight: number;
  geojson: GeoJSON.FeatureCollection;
}

export interface FootprintStyle {
  color: string;
  fillOpacity: number;
  outlineOnly: boolean;
}

export interface SensorConfig {
  resolutionX: number;
  resolutionY: number;
  sensorWidth: number;
  sensorHeight: number;
  focalLength: number;
  flightAltitude: number;
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

export const DEFAULT_FOOTPRINT_STYLE: FootprintStyle = {
  color: "#1e3a5f",
  fillOpacity: 0.1,
  outlineOnly: false,
};
