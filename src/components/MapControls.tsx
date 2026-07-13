import { useRef, useState } from "react";
import { Ruler, Pentagon, Ban, Layers, Check, Download, Loader2, Upload, FileText, Map as MapIcon } from "lucide-react";
import { MeasureMode, MeasurementSummary } from "@/types/photo";

interface MapControlsProps {
  measureMode: MeasureMode;
  measurement: MeasurementSummary | null;
  onMeasureModeChange: (mode: MeasureMode) => void;
  onClearMeasurement: () => void;
  baseLayer: "osm" | "google" | "wms";
  onBaseLayerChange: (value: "osm" | "google" | "wms") => void;
  // PRG / KIEG overlays
  prgAdmin: boolean;
  prgParcels: boolean;
  onTogglePrgAdmin: (value: boolean) => void;
  onTogglePrgParcels: (value: boolean) => void;
  // Import
  onImportKml: (file: File) => void;
  onImportVector: (file: File) => void;
  // WMS
  wmsUrl: string;
  wmsLayers: string[];
  wmsSelectedLayer: string | null;
  wmsLoading: boolean;
  onWmsUrlChange: (value: string) => void;
  onWmsLoadLayers: () => void;
  onWmsLayerChange: (value: string) => void;
}

const BASE_OPTIONS: { value: "osm" | "google" | "wms"; label: string; hint: string }[] = [
  { value: "osm", label: "Mapa", hint: "OpenStreetMap" },
  { value: "google", label: "Satelita", hint: "Google" },
  { value: "wms", label: "WMS", hint: "Ortofoto / usługa" },
];

const MapControls = ({
  measureMode, measurement, onMeasureModeChange, onClearMeasurement,
  baseLayer, onBaseLayerChange,
  prgAdmin, prgParcels, onTogglePrgAdmin, onTogglePrgParcels,
  onImportKml, onImportVector,
  wmsUrl, wmsLayers, wmsSelectedLayer, wmsLoading,
  onWmsUrlChange, onWmsLoadLayers, onWmsLayerChange,
}: MapControlsProps) => {
  const [measureOpen, setMeasureOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const kmlInputRef = useRef<HTMLInputElement>(null);
  const vecInputRef = useRef<HTMLInputElement>(null);

  const measuring = measureMode !== "none";

  return (
    <div className="absolute right-2 top-56 z-[1100] flex flex-col items-end gap-2">
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
              title="Wyczyść pomiar"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-foreground hover:bg-muted"
            >
              <Ban className="h-3.5 w-3.5" /> Wyczyść
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
          <div className="flex w-56 flex-col gap-1 rounded-lg border bg-card p-1 shadow-lg">
            {BASE_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => onBaseLayerChange(o.value)}
                title={o.hint}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${baseLayer === o.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
              >
                <span>{o.label}</span>
                {baseLayer === o.value && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}

            {/* Konfiguracja WMS – rozwija się pod opcją WMS */}
            {baseLayer === "wms" && (
              <div className="mt-1 space-y-1.5 rounded-md border bg-muted/40 p-2">
                <label className="block text-[10px] font-semibold text-muted-foreground">Adres WMS</label>
                <input
                  value={wmsUrl}
                  onChange={(e) => onWmsUrlChange(e.target.value)}
                  placeholder="https://…/wms"
                  className="h-7 w-full rounded border bg-background px-1.5 text-[11px] text-foreground"
                />
                <button
                  onClick={onWmsLoadLayers}
                  disabled={wmsLoading || !wmsUrl}
                  className="flex h-7 w-full items-center justify-center gap-1.5 rounded bg-primary text-[11px] text-primary-foreground disabled:opacity-50"
                >
                  {wmsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Pobierz warstwy
                </button>
                {wmsLayers.length > 0 && (
                  <div className="space-y-1">
                    <label className="block text-[10px] font-semibold text-muted-foreground">Warstwa domyślna</label>
                    <select
                      value={wmsSelectedLayer ?? ""}
                      onChange={(e) => onWmsLayerChange(e.target.value)}
                      className="h-7 w-full rounded border bg-background px-1 text-[11px] text-foreground"
                    >
                      {wmsLayers.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
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
