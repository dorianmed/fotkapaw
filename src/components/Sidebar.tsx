import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import SearchBar from "@/components/SearchBar";
import { DEFAULT_FOOTPRINT_STYLE, FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, OverlapStats, PhotoPoint, SensorConfig } from "@/types/photo";
import { BarChart3, Camera, Download, FileText, FolderOpen, Layers, Map, MousePointer, MoveHorizontal, Pencil, PenTool, Ruler, Trash2, Upload, Eye, EyeOff, ZoomIn, Crosshair, ShieldCheck, Square, Minus, CircleDot } from "lucide-react";
import { CoverageResult } from "@/lib/coverageUtils";
import { Slider } from "@/components/ui/slider";
import { DrawMode, DrawnFeature } from "@/types/drawing";
import { exportDxf, exportGeoJson, exportTxt } from "@/lib/vectorImportExport";

interface SidebarProps {
  photos: PhotoPoint[];
  kmlLayers: KmlLayer[];
  sensor: SensorConfig;
  showFootprints: boolean;
  footprintStyle: FootprintStyle;
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google";
  overlapStats: OverlapStats;
  selectedPhotoCount: number;
  selectedOverlapStats: OverlapStats | null;
  measureMode: MeasureMode;
  measurement: MeasurementSummary | null;
  drawMode: DrawMode;
  drawnFeatures: DrawnFeature[];
  onImportPhotos: (files: FileList) => void;
  onImportKml: (file: File) => void;
  onImportVector: (file: File) => void;
  onToggleFootprints: (value: boolean) => void;
  onFootprintStyleChange: (style: FootprintStyle) => void;
  onToggleOverlap: (value: boolean) => void;
  onBaseLayerChange: (value: "osm" | "google") => void;
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
  coverageResults: Record<string, CoverageResult>;
  onDrawModeChange: (mode: DrawMode) => void;
  onRemoveDrawnFeature: (id: string) => void;
  onClearDrawnFeatures: () => void;
  onExportDrawnFeatures: (format: "kml" | "dxf" | "geojson" | "txt") => void;
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

const Sidebar = ({
  photos,
  kmlLayers,
  sensor,
  showFootprints,
  footprintStyle,
  showOverlapHeatmap,
  baseLayer,
  overlapStats,
  selectedPhotoCount,
  selectedOverlapStats,
  measureMode,
  measurement,
  drawMode,
  drawnFeatures,
  onImportPhotos,
  onImportKml,
  onImportVector,
  onToggleFootprints,
  onFootprintStyleChange,
  onToggleOverlap,
  onBaseLayerChange,
  onToggleKmlLayer,
  onRemoveKmlLayer,
  onChangeKmlColor,
  onChangeKmlWeight,
  onZoomToKml,
  onSensorChange,
  onClearPhotos,
  onZoomToPhotos,
  onSearchResult,
  onMeasureModeChange,
  onClearMeasurement,
  onCheckCoverage,
  coverageResults,
  onDrawModeChange,
  onRemoveDrawnFeature,
  onClearDrawnFeatures,
  onExportDrawnFeatures,
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
    <div className="h-full w-80 space-y-4 overflow-y-auto border-r bg-card p-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Analiza Nalotu</h1>
      </div>

      <SearchBar onResult={onSearchResult} />

      <Separator />

      {/* Import zdjęć */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4" /> Importuj zdjęcia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          <label className="block">
            <input
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/tiff"
              className="hidden"
              onChange={(e) => e.target.files && onImportPhotos(e.target.files)}
            />
            <Button variant="default" className="w-full" asChild>
              <span><Upload className="mr-2 h-4 w-4" /> Wybierz zdjęcia</span>
            </Button>
          </label>
          <label className="block">
            <input
              type="file"
              /* @ts-ignore */
              webkitdirectory=""
              directory=""
              multiple
              accept="image/jpeg,image/jpg,image/tiff"
              className="hidden"
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
        </CardContent>
      </Card>

      {/* Pomiary */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Ruler className="h-4 w-4" /> Pomiary na mapie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <Button variant={measureMode === "none" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("none")}>Off</Button>
            <Button variant={measureMode === "distance" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("distance")}>Dystans</Button>
            <Button variant={measureMode === "area" ? "default" : "outline"} size="sm" onClick={() => onMeasureModeChange("area")}>Pow.</Button>
          </div>
          <p className="text-xs text-muted-foreground">Klikaj na mapie; snapping do środków zdjęć i narożników.</p>
          {measurement && measurement.pointCount > 0 && (
            <div className="space-y-1 rounded-md border bg-background p-3 text-xs text-foreground">
              <div className="flex justify-between"><span>Punkty:</span><span className="font-mono">{measurement.pointCount}</span></div>
              <div className="flex justify-between"><span>Długość:</span><span className="font-mono">{measurement.distanceMeters.toFixed(2)} m</span></div>
              <div className="flex justify-between"><span>Powierzchnia:</span><span className="font-mono">{measurement.areaSquareMeters.toFixed(2)} m²</span></div>
              <div className="flex justify-between"><span>Powierzchnia:</span><span className="font-mono">{(measurement.areaSquareMeters / 10000).toFixed(4)} ha</span></div>
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full" onClick={onClearMeasurement}>Wyczyść pomiar</Button>
        </CardContent>
      </Card>

      {/* Warstwy wektorowe */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> Warstwy wektorowe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          <label className="block">
            <input
              type="file"
              accept=".kml,.kmz"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) Array.from(files).forEach((f) => onImportKml(f));
                e.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" asChild>
              <span><Upload className="mr-2 h-4 w-4" /> Importuj KML</span>
            </Button>
          </label>
          <label className="block">
            <input
              type="file"
              accept=".dxf,.shp,.zip,.txt,.csv"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) Array.from(files).forEach((f) => onImportVector(f));
                e.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" asChild>
              <span><FileText className="mr-2 h-4 w-4" /> Importuj DXF / SHP / TXT</span>
            </Button>
          </label>
          <label className="block">
            <input
              type="file"
              accept=".kml,.kmz"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) Array.from(files).forEach((f) => onImportKml(f));
                e.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" asChild>
              <span><Upload className="mr-2 h-4 w-4" /> Importuj KML</span>
            </Button>
          </label>
          {kmlLayers.map((layer) => (
            <div key={layer.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center justify-between gap-1 text-sm">
                <span
                  className="flex-1 cursor-pointer truncate text-foreground hover:underline"
                  onClick={() => onZoomToKml(layer.id)}
                  title="Kliknij aby przybliżyć"
                >
                  {layer.name}
                </span>
                <div className="flex items-center gap-0.5">
                  <input type="color" value={layer.color} onChange={(e) => onChangeKmlColor(layer.id, e.target.value)} className="h-6 w-6 cursor-pointer rounded border-0 p-0" title="Kolor" />
                  <Button variant="ghost" size="sm" onClick={() => onZoomToKml(layer.id)} title="Przybliż"><ZoomIn className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => onToggleKmlLayer(layer.id)}>
                    {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => exportKml(layer)} title="Eksportuj KML"><Download className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => onRemoveKmlLayer(layer.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Grubość:</span>
                <Slider
                  value={[layer.weight]}
                  onValueChange={([v]) => onChangeKmlWeight(layer.id, v)}
                  min={1}
                  max={8}
                  step={1}
                  className="flex-1"
                />
                <span className="font-mono w-4 text-right">{layer.weight}</span>
              </div>
              {photos.length > 0 && (
                <div className="space-y-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => onCheckCoverage(layer.id)}
                  >
                    <ShieldCheck className="mr-1 h-3 w-3" /> Sprawdź pokrycie
                  </Button>
                  {coverageResults[layer.id] && (() => {
                    const r = coverageResults[layer.id];
                    const color = r.coveragePercent >= 95 ? "text-green-600" : r.coveragePercent >= 80 ? "text-yellow-600" : "text-red-600";
                    return (
                      <div className="rounded border p-2 text-xs space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pokrycie obszaru:</span>
                          <span className={`font-mono font-bold ${color}`}>{r.coveragePercent.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Komórki pokryte:</span>
                          <span className="font-mono">{r.coveredCells}/{r.totalCells}</span>
                        </div>
                        {r.gaps.length > 0 && (
                          <p className="text-red-500 text-xs mt-1">⚠ Wykryto {r.gaps.length} luk w pokryciu (czerwone na mapie)</p>
                        )}
                        {r.gaps.length === 0 && (
                          <p className="text-green-600 text-xs mt-1">✓ Cały obszar pokryty zdjęciami</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Podkład */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Map className="h-4 w-4" /> Podkład mapy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div className="flex gap-2">
            <Button variant={baseLayer === "osm" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => onBaseLayerChange("osm")}>OSM</Button>
            <Button variant={baseLayer === "google" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => onBaseLayerChange("google")}>Google Sat</Button>
          </div>
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
        </CardContent>
      </Card>

      {/* Statystyki */}
      {photos.length >= 2 && (
        <Card>
          <CardHeader className="px-4 pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4" /> Statystyki nalotu
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 text-sm">
            <div className="flex justify-between text-foreground">
              <span>Śr. pokrycie podłużne:</span>
              <span className="font-mono font-bold">{overlapStats.avgForward.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span>Śr. pokrycie poprzeczne:</span>
              <span className="font-mono font-bold">{overlapStats.avgLateral.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Pary użyte do średniej:</span>
              <span>{overlapStats.pairs.length}</span>
            </div>
            <Separator />
            {avgSpeed !== undefined && (
              <div className="flex justify-between text-foreground">
                <span>Śr. prędkość:</span>
                <span className="font-mono">{avgSpeed.toFixed(1)} m/s ({(avgSpeed * 3.6).toFixed(1)} km/h)</span>
              </div>
            )}
            {avgAltitude !== undefined && (
              <div className="flex justify-between text-foreground">
                <span>Śr. wysokość GPS:</span>
                <span className="font-mono">{avgAltitude.toFixed(1)} m</span>
              </div>
            )}
            {avgGsd !== undefined && (
              <div className="flex justify-between text-foreground">
                <span>GSD:</span>
                <span className="font-mono">{avgGsd.toFixed(2)} cm/px</span>
              </div>
            )}
            <Separator />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Zdjęcia z EXIF sensora: {exifSensorCount}/{photos.length}</p>
              <p>Pułap awaryjny AGL: {sensor.flightAltitude} m</p>
              {photos[0]?.sensorInfo && (
                <>
                  <Separator />
                  <p className="font-medium text-primary">Pierwsze zdjęcie:</p>
                  <p>Sensor: {photos[0].sensorInfo.sensorWidth.toFixed(2)} × {photos[0].sensorInfo.sensorHeight.toFixed(2)} mm</p>
                  <p>Ogniskowa: {photos[0].sensorInfo.focalLength.toFixed(2)} mm</p>
                  <p>Rozdzielczość: {photos[0].sensorInfo.resolutionX} px</p>
                  <p>Źródło: {photos[0].sensorInfo.source}</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zaznaczone */}
      {selectedOverlapStats && (
        <Card>
          <CardHeader className="px-4 pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MoveHorizontal className="h-4 w-4" /> Zaznaczone zdjęcia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 text-sm">
            <div className="flex justify-between text-foreground">
              <span>Zaznaczonych:</span>
              <span className="font-mono font-bold">{selectedPhotoCount}</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span>Pokrycie podłużne:</span>
              <span className="font-mono font-bold">{selectedOverlapStats.avgForward.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span>Pokrycie poprzeczne:</span>
              <span className="font-mono font-bold">{selectedOverlapStats.avgLateral.toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pułap */}
      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-sm">Pułap awaryjny</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4 text-sm">
          <p className="text-xs text-muted-foreground">Używany tylko gdy EXIF nie ma wysokości GPS.</p>
          <div className="flex items-center gap-2">
            <Label className="flex-1 text-xs text-foreground">Pułap lotu (m)</Label>
            <Input
              type="number"
              step="0.1"
              className="h-8 w-28 text-xs"
              value={sensor.flightAltitude}
              onChange={(e) => onSensorChange({ ...sensor, flightAltitude: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Sidebar;
