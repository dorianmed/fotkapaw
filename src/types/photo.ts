export interface PhotoPoint {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  altitude?: number;
  timestamp?: Date;
  // Ground footprint in meters
  footprintWidth: number;
  footprintHeight: number;
  // Footprint corners [lat, lng][]
  footprintCorners: [number, number][];
}

export interface KmlLayer {
  id: string;
  name: string;
  visible: boolean;
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

export const DEFAULT_SENSOR: SensorConfig = {
  resolutionX: 1280,
  resolutionY: 960,
  sensorWidth: 4.8,
  sensorHeight: 3.6,
  focalLength: 5.4,
  flightAltitude: 120,
};
