export type DrawMode = "none" | "point" | "line" | "polygon";

export interface DrawnFeatureAttrs {
  name: string;
  description: string;
}

export interface DrawnFeature {
  id: string;
  coordinates: [number, number][];
  /** Wysokości (m n.p.m.) odpowiadające kolejnym wierzchołkom – np. z GPS. */
  heights?: (number | null)[];
  attrs: DrawnFeatureAttrs;
}

export interface DrawingLayer {
  id: string;
  name: string;
  type: "point" | "line" | "polygon";
  visible: boolean;
  color: string;
  /** Domyślny układ współrzędnych warstwy (do eksportu). */
  crs?: "wgs84" | "puwg1992" | "puwg2000";
  features: DrawnFeature[];
}
