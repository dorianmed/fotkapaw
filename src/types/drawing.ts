export type DrawMode = "none" | "point" | "line" | "polygon";

export interface DrawnFeature {
  id: string;
  type: "point" | "line" | "polygon";
  coordinates: [number, number][];
  name: string;
  color: string;
}
