import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SearchBar from "@/components/SearchBar";
import { DEFAULT_FOOTPRINT_STYLE, FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, OverlapStats, PhotoPoint, SensorConfig } from "@/types/photo";
import { BarChart3, Camera, ChevronDown, ChevronRight, Download, FileText, FolderOpen, Layers, Map, MoveHorizontal, PenTool, Ruler, Trash2, Upload, Eye, EyeOff, ZoomIn, Crosshair, ShieldCheck, Square, Minus, CircleDot, Plus, Edit2 } from "lucide-react";
import { CoverageResult } from "@/lib/coverageUtils";
import { Slider } from "@/components/ui/slider";
import { DrawingLayer } from "@/types/drawing";
import { exportDxf, exportGeoJson, exportTxt } from "@/lib/vectorImportExport";
import { CoordinateSystem, EXPORT_EPSG } from "@/lib/coordinateUtils";
import { useState, ReactNode } from "react";

interface SidebarProps {
  photos: PhotoPoint[];
  kmlLayers: KmlLayer[];
  sensor: SensorConfig;
  showFootprints: boolean;
  footprintStyle: FootprintStyle;
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google" | "wms";
  wmsUrl: string;
  wmsLayers: string[];
  wmsSelectedLayer: string | null;
  wmsLoading: boolean;
  onWmsUrlChange: (url: string) => void;
  onWmsLoadLayers: () => void;
  onWmsLayerChange: (layer: string) => void;
  overlapStats: OverlapStats;
  selectedPhotoCount: number;
  selectedOverlapStats: OverlapStats | null;
  measureMode: MeasureMode;
  measurement: MeasurementSummary | null;
  onImportPhotos: (files: FileList) => void;
  onImportKml: (file: File) => void;
  onImportVector: (file: File) => void;
  onToggleFootprints: (value: boolean) => void;
  onFootprintStyleChange: (style: FootprintStyle) => void;
  onToggleOverlap: (value: boolean) => void;
  onBaseLayerChange: (value: "osm" | "google" | "wms") => void;
  onToggleKmlLayer: (id: string) => void;
  onRemoveKmlLayer: (id: string) => void;
  onChangeKmlColor: (id: string, color: string) => void;
  onChangeKmlWeight: (id: string, weight: number) => void;
  onZoomToKml: (id: string) => void;
  onSensorChange: (sensor: SensorConfig) => void;
  onClearPhotos: () => void;
  onZoomToPhotos: () => void;
  onSearchResult: (lat: number, lng: number, label: string) => void;
  onMeasureModeChange: (mode: MeasureMode) => void;
  onClearMeasurement: () => void;
  onCheckCoverage: (kmlId: string) => void;
  onClearCoverage: (kmlId: string) => void;
  coverageResults: Record<string, CoverageResult>;
}

const exportKml = (layer: KmlLayer) => {
  const features = layer.geojson.features.map((f) => {
    const coords = (f.geometry as any).coordinates;
    const name = f.properties?.name || "";
    if (f.geometry.type === "Point") {
      return `<Placemark><name>${name}</name><Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`;
    }
    if (f.geometry.type === "LineString") {
      const c = coords.map((p: number[]) => `${p[0]},${p[1]},0`).join(" ");
      return `<Placemark><name>${name}</name><LineString><coordinates>${c}</coordinates></LineString></Placemark>`;
    }
    if (f.geometry.type === "Polygon") {
      const c = coords[0].map((p: number[]) => `${p[0]},${p[1]},0`).join(" ");
      return `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${c}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
    }
    return "";
  }).join("\n");

  const kmlStr = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${layer.name}</name>\n${features}\n</Document></kml>`;
  const blob = new Blob([kmlStr], { type: "application/vnd.google-earth.kml+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${layer.name}.kml`;
  a.click();
};

// Collapsible section: header acts as button; content hidden until expanded.
const Section = ({ icon, title, description, defaultOpen = false, children }: {
  icon: ReactNode; title: string; description?: string; defaultOpen?: boolean; children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-3 hover:bg-muted/50 rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-sm">
                {icon} {title}
              </CardTitle>
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        {!open && description && (
          <p className="px-4 pb-3 text-xs text-muted-foreground">{description}</p>
        )}
        <CollapsibleContent>
          <CardContent className="space-y-2 px-4 pb-4">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

const Sidebar = ({
  photos, kmlLayers, sensor, showFootprints, footprintStyle, showOverlapHeatmap, baseLayer,
  wmsUrl, wmsLayers, wmsSelectedLayer, wmsLoading,
  onWmsUrlChange, onWmsLoadLayers, onWmsLayerChange,
  overlapStats, selectedPhotoCount, selectedOverlapStats, measureMode, measurement,
  onImportPhotos, onImportKml, onImportVector,
  onToggleFootprints, onFootprintStyleChange, onToggleOverlap, onBaseLayerChange,
  onToggleKmlLayer, onRemoveKmlLayer, onChangeKmlColor, onChangeKmlWeight, onZoomToKml,
  onSensorChange, onClearPhotos, onZoomToPhotos, onSearchResult,
  onMeasureModeChange, onClearMeasurement, onCheckCoverage, onClearCoverage, coverageResults,
}: SidebarProps) => {
  const avgSpeed = photos.filter((p) => p.speed !== undefined).length > 0
    ? photos.filter((p) => p.speed !== undefined).reduce((s, p) => s + (p.speed ?? 0), 0) / photos.filter((p) => p.speed !== undefined).length
    : undefined;
  const avgAltitude = photos.filter((p) => p.altitude !== undefined).length > 0
    ? photos.filter((p) => p.altitude !== undefined).reduce((s, p) => s + (p.altitude ?? 0), 0) / photos.filter((p) => p.altitude !== undefined).length
    : undefined;
  const avgGsd = photos.filter((p) => p.gsd !== undefined).length > 0
    ? photos.filter((p) => p.gsd !== undefined).reduce((s, p) => s + (p.gsd ?? 0), 0) / photos.filter((p) => p.gsd !== undefined).length
    : undefined;
  const exifSensorCount = photos.filter((p) => p.sensorInfo?.source !== "fallback").length;


  return (
    <div className="h-full w-80 space-y-3 overflow-y-auto border-r bg-card p-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Analiza Nalotu</h1>
      </div>

      <SearchBar onResult={onSearchResult} />

      <Separator />

      <Section icon={<Upload className="h-4 w-4" />} title="Importuj zdjęcia" description="Kliknij, aby wybrać zdjęcia lub folder z lotu.">
        <label className="block">
          <input type="file" multiple accept="image/jpeg,image/jpg,image/tiff" className="hidden"
            onChange={(e) => e.target.files && onImportPhotos(e.target.files)} />
          <Button variant="default" className="w-full" asChild>
            <span><Upload className="mr-2 h-4 w-4" /> Wybierz zdjęcia</span>
          </Button>
        </label>
        <label className="block">
          <input
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/tiff"
            className="hidden"
            {...({ webkitdirectory: "", directory: "" } as any)}
            onChange={(e) => e.target.files && onImportPhotos(e.target.files)}
          />
          <Button variant="outline" className="w-full" asChild>
            <span><FolderOpen className="mr-2 h-4 w-4" /> Importuj folder</span>
          </Button>
        </label>
        {photos.length > 0 && (
          <div className="flex items-center justify-between gap-1">
            <Badge variant="secondary">{photos.length} zdjęć</Badge>
            <div className="flex gap-0.5">
              <Button variant="ghost" size="sm" onClick={onZoomToPhotos} title="Pokaż na mapie">
                <Crosshair className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onClearPhotos}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section icon={<Ruler className="h-4 w-4" />} title="Pomiary na mapie" description="Mierz dystans lub powierzchnię klikając na mapie.">
        <div className="grid grid-cols-3 gap-2">
          <Button variant={measureMode === "none" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("none")}>Off</Button>
          <Button variant={measureMode === "distance" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("distance")}>Dystans</Button>
          <Button variant={measureMode === "area" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("area")}>Pow.</Button>
        </div>
        <p className="text-xs text-muted-foreground">Snapping do środków/narożników zdjęć oraz wierzchołków warstw rysowania. Kliknij na narysowany poligon, aby od razu policzyć jego powierzchnię.</p>
        {measurement && measurement.pointCount > 0 && (
          <div className="space-y-1 rounded-md border bg-background p-3 text-xs text-foreground">
            <div className="flex justify-between"><span>Punkty:</span><span className="font-mono">{measurement.pointCount}</span></div>
            <div className="flex justify-between"><span>Długość:</span><span className="font-mono">{measurement.distanceMeters.toFixed(2)} m</span></div>
            <div className="flex justify-between"><span>Powierzchnia:</span><span className="font-mono">{measurement.areaSquareMeters.toFixed(2)} m²</span></div>
            <div className="flex justify-between"><span>Powierzchnia:</span><span className="font-mono">{(measurement.areaSquareMeters / 10000).toFixed(4)} ha</span></div>
          </div>
        )}
        <Button variant="ghost" size="sm" className="w-full" onClick={onClearMeasurement}>Wyczyść pomiar</Button>
      </Section>

      <Section icon={<Layers className="h-4 w-4" />} title="Warstwy wektorowe" description="Importuj KML / DXF / SHP / TXT i zarządzaj warstwami.">
        <label className="block">
          <input type="file" accept=".kml,.kmz" multiple className="hidden"
            onChange={(e) => { const files = e.target.files; if (files) Array.from(files).forEach((f) => onImportKml(f)); e.target.value = ""; }} />
          <Button variant="outline" className="w-full" asChild>
            <span><Upload className="mr-2 h-4 w-4" /> Importuj KML</span>
          </Button>
        </label>
        <label className="block">
          <input type="file" accept=".dxf,.shp,.zip,.txt,.csv" multiple className="hidden"
            onChange={(e) => { const files = e.target.files; if (files) Array.from(files).forEach((f) => onImportVector(f)); e.target.value = ""; }} />
          <Button variant="outline" className="w-full" asChild>
            <span><FileText className="mr-2 h-4 w-4" /> Importuj DXF / SHP / TXT</span>
          </Button>
        </label>
        {kmlLayers.map((layer) => (
          <div key={layer.id} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center justify-between gap-1 text-sm">
              <span className="flex-1 cursor-pointer truncate text-foreground hover:underline"
                onClick={() => onZoomToKml(layer.id)} title="Kliknij aby przybliżyć">
                {layer.name}
              </span>
              <div className="flex items-center gap-0.5">
                <input type="color" value={layer.color} onChange={(e) => onChangeKmlColor(layer.id, e.target.value)} className="h-6 w-6 cursor-pointer rounded border-0 p-0" title="Kolor" />
                <Button variant="ghost" size="sm" onClick={() => onZoomToKml(layer.id)} title="Przybliż"><ZoomIn className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" onClick={() => onToggleKmlLayer(layer.id)}>
                  {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => exportKml(layer)} title="KML"><Download className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" onClick={() => exportDxf(layer.geojson, layer.name)} title="DXF"><span className="text-[9px]">DXF</span></Button>
                <Button variant="ghost" size="sm" onClick={() => exportGeoJson(layer.geojson, layer.name)} title="GeoJSON"><span className="text-[9px]">GJ</span></Button>
                <Button variant="ghost" size="sm" onClick={() => onRemoveKmlLayer(layer.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Grubość:</span>
              <Slider value={[layer.weight]} onValueChange={([v]) => onChangeKmlWeight(layer.id, v)} min={1} max={8} step={1} className="flex-1" />
              <span className="font-mono w-4 text-right">{layer.weight}</span>
            </div>
            {photos.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => onCheckCoverage(layer.id)}>
                    <ShieldCheck className="mr-1 h-3 w-3" /> Sprawdź pokrycie
                  </Button>
                  {coverageResults[layer.id] && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Usuń luki z mapy"
                      onClick={() => onClearCoverage(layer.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {coverageResults[layer.id] && (() => {
                  const r = coverageResults[layer.id];
                  const color = r.coveragePercent >= 95 ? "text-green-600" : r.coveragePercent >= 80 ? "text-yellow-600" : "text-red-600";
                  return (
                    <div className="rounded border p-2 text-xs space-y-0.5">
                      <div className="flex justify-between"><span className="text-muted-foreground">Pokrycie obszaru:</span><span className={`font-mono font-bold ${color}`}>{r.coveragePercent.toFixed(1)}%</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>Komórki pokryte:</span><span className="font-mono">{r.coveredCells}/{r.totalCells}</span></div>
                      {r.gaps.length > 0 && <p className="text-red-500 text-xs mt-1">⚠ Wykryto {r.gaps.length} luk w pokryciu (czerwone na mapie)</p>}
                      {r.gaps.length === 0 && <p className="text-green-600 text-xs mt-1">✓ Cały obszar pokryty zdjęciami</p>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section icon={<PenTool className="h-4 w-4" />} title="Rysowanie" description="Twórz warstwy punktowe, liniowe i powierzchniowe z atrybutami.">
        <div className="grid grid-cols-3 gap-1">
          <Button variant="outline" size="sm" onClick={() => onAddDrawLayer("point")} title="Nowa warstwa punktowa">
            <Plus className="h-3 w-3 mr-1" /><CircleDot className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAddDrawLayer("line")} title="Nowa warstwa liniowa">
            <Plus className="h-3 w-3 mr-1" /><Minus className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAddDrawLayer("polygon")} title="Nowa warstwa powierzchniowa">
            <Plus className="h-3 w-3 mr-1" /><Square className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {activeDrawLayerId
            ? "Klikaj na mapie. Linie/poligony: dblklik, klik na 1. wierzchołek lub przycisk Zakończ. ESC = wyjście."
            : "Wybierz warstwę aby aktywować rysowanie."}
        </p>
        <div className="flex items-center gap-2 rounded border p-2">
          <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Eksport EPSG:</Label>
          <select
            className="flex-1 h-7 text-xs rounded border bg-background px-1"
            value={exportEpsg}
            onChange={(e) => setExportEpsg(e.target.value as CoordinateSystem)}
          >
            {EXPORT_EPSG.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {activeDrawLayerId && drawMode !== "point" && drawingInProgressCount > 0 && (
          <Button size="sm" className="w-full" onClick={onFinishDrawing} disabled={drawingInProgressCount < (drawMode === "line" ? 2 : 3)}>
            Zakończ ({drawingInProgressCount} pkt)
          </Button>
        )}
        {drawingLayers.length === 0 && (
          <p className="text-xs italic text-muted-foreground">Brak warstw. Kliknij + powyżej.</p>
        )}
        {drawingLayers.map((dl) => {
          const isActive = activeDrawLayerId === dl.id;
          const isEditing = editingLayerId === dl.id;
          return (
            <div key={dl.id} className={`space-y-1 rounded-md border p-2 ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}>
              <div className="flex items-center gap-1">
                {typeIcon(dl.type)}
                {isEditing ? (
                  <Input
                    autoFocus
                    defaultValue={dl.name}
                    className="h-6 text-xs flex-1"
                    onBlur={(e) => { onRenameDrawLayer(dl.id, e.target.value || dl.name); setEditingLayerId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingLayerId(null); }}
                  />
                ) : (
                  <span
                    className="flex-1 cursor-pointer truncate text-xs font-medium text-foreground"
                    onClick={() => onSetActiveDrawLayer(isActive ? null : dl.id)}
                    title="Kliknij aby aktywować rysowanie"
                  >
                    {dl.name} <span className="text-muted-foreground">({dl.features.length})</span>
                  </span>
                )}
                <input type="color" value={dl.color} onChange={(e) => onChangeDrawLayerColor(dl.id, e.target.value)} className="h-5 w-5 cursor-pointer rounded border-0 p-0" title="Kolor" />
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingLayerId(dl.id)} title="Zmień nazwę"><Edit2 className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onToggleDrawLayer(dl.id)}>
                  {dl.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemoveDrawLayer(dl.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              <p className="text-[10px] text-muted-foreground pl-4">{typeLabel(dl.type)}</p>
              {dl.features.length > 0 && (
                <div className="border-t pt-1">
                  <button
                    onClick={() => setExpandedFeatureLists((p) => ({ ...p, [dl.id]: !p[dl.id] }))}
                    className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground px-1 py-0.5"
                  >
                    <span>Obiekty ({dl.features.length})</span>
                    {expandedFeatureLists[dl.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  {expandedFeatureLists[dl.id] && (
                    <div className="max-h-32 overflow-y-auto space-y-0.5 mt-1">
                      {dl.features.map((f, i) => (
                        <button
                          key={f.id}
                          onClick={() => onSelectFeature(dl.id, f.id)}
                          className="flex w-full items-center justify-between rounded px-1 py-0.5 text-[10px] hover:bg-muted text-left"
                        >
                          <span className="truncate text-foreground">{f.attrs.name || `${i + 1}`}</span>
                          <span className="text-muted-foreground font-mono">{f.coordinates.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {dl.features.length > 0 && (() => {
                const sel = selectedFeature?.layerId === dl.id ? selectedFeature.featureId : undefined;
                const label = sel ? "obiekt" : "warstwa";
                return (
                  <div className="space-y-1 pt-1">
                    <p className="text-[10px] text-muted-foreground">Eksport ({label}{sel ? "" : ` ${dl.features.length} obj.`}):</p>
                    <div className="grid grid-cols-2 gap-1">
                      <Button variant="outline" size="sm" className="text-[10px] h-6" onClick={() => onExportDrawLayer(dl.id, "kml", exportEpsg, sel)}>KML</Button>
                      <Button variant="outline" size="sm" className="text-[10px] h-6" onClick={() => onExportDrawLayer(dl.id, "dxf", exportEpsg, sel)}>DXF</Button>
                      <Button variant="outline" size="sm" className="text-[10px] h-6" onClick={() => onExportDrawLayer(dl.id, "geojson", exportEpsg, sel)}>GeoJSON</Button>
                      <Button variant="outline" size="sm" className="text-[10px] h-6" onClick={() => onExportDrawLayer(dl.id, "txt", exportEpsg, sel)}>TXT</Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </Section>

      <Section icon={<Map className="h-4 w-4" />} title="Podkład mapy" description="Wybierz mapę bazową i styl zasięgów.">
        <div className="grid grid-cols-3 gap-1">
          <Button variant={baseLayer === "osm" ? "default" : "outline"} size="sm" onClick={() => onBaseLayerChange("osm")}>OSM</Button>
          <Button variant={baseLayer === "google" ? "default" : "outline"} size="sm" onClick={() => onBaseLayerChange("google")}>Google</Button>
          <Button variant={baseLayer === "wms" ? "default" : "outline"} size="sm" onClick={() => onBaseLayerChange("wms")}>WMS</Button>
        </div>
        {baseLayer === "wms" && (
          <div className="space-y-1 rounded border p-2">
            <Label className="text-[10px] text-muted-foreground">Adres WMS (GetCapabilities) – edytowalny</Label>
            <Input className="h-7 text-xs font-mono" value={wmsUrl}
              onChange={(e) => onWmsUrlChange(e.target.value)} placeholder="https://.../wms" />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs"
                onClick={onWmsLoadLayers} disabled={!wmsUrl || wmsLoading}>
                {wmsLoading ? "Pobieranie..." : "Pobierz warstwy"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => onWmsUrlChange("https://sh.dataspace.copernicus.eu/ogc/wms/2a3dca8e-5210-4752-ba0f-cd3300dee17d")}>
                Domyślny
              </Button>
            </div>
            {wmsLayers.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Warstwa ({wmsLayers.length})</Label>
                <select
                  className="w-full h-7 text-xs rounded border bg-background px-2"
                  value={wmsSelectedLayer ?? ""}
                  onChange={(e) => onWmsLayerChange(e.target.value)}
                >
                  <option value="" disabled>— wybierz —</option>
                  {wmsLayers.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">UWAGA: serwer WMS musi udostępniać CORS.</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-foreground">Zasięgi zdjęć</Label>
          <Switch checked={showFootprints} onCheckedChange={onToggleFootprints} />
        </div>
        {showFootprints && (
          <div className="space-y-2 rounded border p-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Kolor:</span>
              <input type="color" value={footprintStyle.color} onChange={(e) => onFootprintStyleChange({ ...footprintStyle, color: e.target.value })} className="h-5 w-5 cursor-pointer rounded border-0 p-0" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Tylko obrysy</span>
              <Switch checked={footprintStyle.outlineOnly} onCheckedChange={(v) => onFootprintStyleChange({ ...footprintStyle, outlineOnly: v })} />
            </div>
            {!footprintStyle.outlineOnly && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Wypełnienie:</span>
                <Slider value={[footprintStyle.fillOpacity * 100]} onValueChange={([v]) => onFootprintStyleChange({ ...footprintStyle, fillOpacity: v / 100 })} min={0} max={50} step={5} className="flex-1" />
                <span className="font-mono w-8 text-right">{Math.round(footprintStyle.fillOpacity * 100)}%</span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-foreground">Pokrycie (heatmapa)</Label>
          <Switch checked={showOverlapHeatmap} onCheckedChange={onToggleOverlap} />
        </div>
        <p className="text-xs text-muted-foreground">Ctrl+klik dodaje zdjęcia do zaznaczenia.</p>
      </Section>

      {photos.length >= 2 && (
        <Section icon={<BarChart3 className="h-4 w-4" />} title="Statystyki nalotu" description="Pokrycie, prędkość, wysokość, GSD.">
          <div className="text-sm space-y-2">
            <div className="flex justify-between text-foreground"><span>Śr. pokrycie podłużne:</span><span className="font-mono font-bold">{overlapStats.avgForward.toFixed(1)}%</span></div>
            <div className="flex justify-between text-foreground"><span>Śr. pokrycie poprzeczne:</span><span className="font-mono font-bold">{overlapStats.avgLateral.toFixed(1)}%</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Pary:</span><span>{overlapStats.pairs.length}</span></div>
            <Separator />
            {avgSpeed !== undefined && <div className="flex justify-between text-foreground"><span>Śr. prędkość:</span><span className="font-mono">{avgSpeed.toFixed(1)} m/s</span></div>}
            {avgAltitude !== undefined && <div className="flex justify-between text-foreground"><span>Śr. wysokość GPS:</span><span className="font-mono">{avgAltitude.toFixed(1)} m</span></div>}
            {avgGsd !== undefined && <div className="flex justify-between text-foreground"><span>GSD:</span><span className="font-mono">{avgGsd.toFixed(2)} cm/px</span></div>}
            <p className="text-xs text-muted-foreground">EXIF sensora: {exifSensorCount}/{photos.length}</p>
          </div>
        </Section>
      )}

      {selectedOverlapStats && (
        <Section icon={<MoveHorizontal className="h-4 w-4" />} title="Zaznaczone zdjęcia" defaultOpen>
          <div className="text-sm space-y-2">
            <div className="flex justify-between text-foreground"><span>Zaznaczonych:</span><span className="font-mono font-bold">{selectedPhotoCount}</span></div>
            <div className="flex justify-between text-foreground"><span>Pokrycie podłużne:</span><span className="font-mono font-bold">{selectedOverlapStats.avgForward.toFixed(1)}%</span></div>
            <div className="flex justify-between text-foreground"><span>Pokrycie poprzeczne:</span><span className="font-mono font-bold">{selectedOverlapStats.avgLateral.toFixed(1)}%</span></div>
          </div>
        </Section>
      )}

    </div>
  );
};

export default Sidebar;
