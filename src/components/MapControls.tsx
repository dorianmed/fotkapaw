import { useState } from "react";
import { Ruler, Pentagon, Ban, Layers, Check } from "lucide-react";
import { MeasureMode, MeasurementSummary } from "@/types/photo";

interface MapControlsProps {
  measureMode: MeasureMode;
  measurement: MeasurementSummary | null;
  onMeasureModeChange: (mode: MeasureMode) => void;
  onClearMeasurement: () => void;
  baseLayer: "osm" | "google" | "wms";
  onBaseLayerChange: (value: "osm" | "google" | "wms") => void;
}

const BASE_OPTIONS: { value: "osm" | "google" | "wms"; label: string; hint: string }[] = [
  { value: "osm", label: "Mapa", hint: "OpenStreetMap" },
  { value: "google", label: "Satelita", hint: "Google" },
  { value: "wms", label: "WMS", hint: "Ortofoto / usługa" },
];

const MapControls = ({
  measureMode, measurement, onMeasureModeChange, onClearMeasurement,
  baseLayer, onBaseLayerChange,
}: MapControlsProps) => {
  const [measureOpen, setMeasureOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  const measuring = measureMode !== "none";

  return (
    <div className="absolute right-2 top-36 z-[1100] flex flex-col items-end gap-2">
      {/* ── Pomiary (mała linijka pod zoomem) ── */}
      <div className="flex items-start gap-2">
        {measureOpen && (
          <div className="flex flex-col gap-1 rounded-lg border bg-card p-1 shadow-lg">
            <button
              onClick={() => onMeasureModeChange("distance")}
              title="Pomiar odległości"
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${measureMode === "distance" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
            >
              <Ruler className="h-3.5 w-3.5" /> Dystans
            </button>
            <button
              onClick={() => onMeasureModeChange("area")}
              title="Pomiar powierzchni"
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${measureMode === "area" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
            >
              <Pentagon className="h-3.5 w-3.5" /> Pow.
            </button>
            <button
              onClick={() => { onMeasureModeChange("none"); onClearMeasurement(); }}
              title="Wyłącz / wyczyść"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-foreground hover:bg-muted"
            >
              <Ban className="h-3.5 w-3.5" /> Wyłącz
            </button>
          </div>
        )}
        <button
          onClick={() => setMeasureOpen((v) => !v)}
          title="Pomiary na mapie"
          className={`rounded-lg border p-2.5 shadow-lg transition-colors ${measuring ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
        >
          <Ruler className="h-5 w-5" />
        </button>
      </div>

      {/* Odczyt pomiaru */}
      {measuring && measurement && measurement.pointCount > 0 && (
        <div className="rounded-lg border bg-card/95 px-2.5 py-1.5 text-[11px] font-mono text-foreground shadow-lg backdrop-blur">
          {measureMode === "distance" ? (
            <div>{measurement.distanceMeters.toFixed(2)} m</div>
          ) : (
            <>
              <div>{measurement.areaSquareMeters.toFixed(1)} m²</div>
              <div className="text-muted-foreground">{(measurement.areaSquareMeters / 10000).toFixed(4)} ha</div>
            </>
          )}
        </div>
      )}

      {/* ── Podkład mapy (ikona warstw → trzy opcje jak w Google) ── */}
      <div className="flex items-start gap-2">
        {layersOpen && (
          <div className="flex flex-col gap-1 rounded-lg border bg-card p-1 shadow-lg">
            {BASE_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => { onBaseLayerChange(o.value); setLayersOpen(false); }}
                title={o.hint}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${baseLayer === o.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
              >
                <span>{o.label}</span>
                {baseLayer === o.value && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setLayersOpen((v) => !v)}
          title="Podkład mapy"
          className="rounded-lg border bg-card p-2.5 text-foreground shadow-lg"
        >
          <Layers className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default MapControls;
