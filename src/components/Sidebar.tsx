import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import SearchBar from "@/components/SearchBar";
import { KmlLayer, MeasureMode, MeasurementSummary, OverlapStats, PhotoPoint, SensorConfig } from "@/types/photo";
import { BarChart3, Camera, Layers, Map, MoveHorizontal, Ruler, Trash2, Upload, Eye, EyeOff, ZoomIn } from "lucide-react";

interface SidebarProps {
  photos: PhotoPoint[];
  kmlLayers: KmlLayer[];
  sensor: SensorConfig;
  showFootprints: boolean;
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google";
  overlapStats: OverlapStats;
  selectedPhotoCount: number;
  selectedOverlapStats: OverlapStats | null;
  measureMode: MeasureMode;
  measurement: MeasurementSummary | null;
  onImportPhotos: (files: FileList) => void;
  onImportKml: (file: File) => void;
  onToggleFootprints: (value: boolean) => void;
  onToggleOverlap: (value: boolean) => void;
  onBaseLayerChange: (value: "osm" | "google") => void;
  onToggleKmlLayer: (id: string) => void;
  onRemoveKmlLayer: (id: string) => void;
  onChangeKmlColor: (id: string, color: string) => void;
  onZoomToKml: (id: string) => void;
  onSensorChange: (sensor: SensorConfig) => void;
  onClearPhotos: () => void;
  onSearchResult: (lat: number, lng: number, label: string) => void;
  onMeasureModeChange: (mode: MeasureMode) => void;
  onClearMeasurement: () => void;
}

const Sidebar = ({
  photos,
  kmlLayers,
  sensor,
  showFootprints,
  showOverlapHeatmap,
  baseLayer,
  overlapStats,
  selectedPhotoCount,
  selectedOverlapStats,
  measureMode,
  measurement,
  onImportPhotos,
  onImportKml,
  onToggleFootprints,
  onToggleOverlap,
  onBaseLayerChange,
  onToggleKmlLayer,
  onRemoveKmlLayer,
  onChangeKmlColor,
  onZoomToKml,
  onSensorChange,
  onClearPhotos,
  onSearchResult,
  onMeasureModeChange,
  onClearMeasurement,
}: SidebarProps) => {
  const avgSpeed = photos.filter((photo) => photo.speed !== undefined).length > 0
    ? photos.filter((photo) => photo.speed !== undefined).reduce((sum, photo) => sum + (photo.speed ?? 0), 0) / photos.filter((photo) => photo.speed !== undefined).length
    : undefined;

  const avgAltitude = photos.filter((photo) => photo.altitude !== undefined).length > 0
    ? photos.filter((photo) => photo.altitude !== undefined).reduce((sum, photo) => sum + (photo.altitude ?? 0), 0) / photos.filter((photo) => photo.altitude !== undefined).length
    : undefined;

  const avgGsd = photos.filter((photo) => photo.gsd !== undefined).length > 0
    ? photos.filter((photo) => photo.gsd !== undefined).reduce((sum, photo) => sum + (photo.gsd ?? 0), 0) / photos.filter((photo) => photo.gsd !== undefined).length
    : undefined;

  const exifSensorCount = photos.filter((photo) => photo.sensorInfo?.source !== "fallback").length;

  return (
    <div className="h-full w-80 space-y-4 overflow-y-auto border-r bg-card p-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Analiza Nalotu</h1>
      </div>

      <SearchBar onResult={onSearchResult} />

      <Separator />

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
              onChange={(event) => event.target.files && onImportPhotos(event.target.files)}
            />
            <Button variant="default" className="w-full" asChild>
              <span><Upload className="mr-2 h-4 w-4" /> Wybierz zdjęcia</span>
            </Button>
          </label>
          {photos.length > 0 && (
            <div className="flex items-center justify-between">
              <Badge variant="secondary">{photos.length} zdjęć</Badge>
              <Button variant="ghost" size="sm" onClick={onClearPhotos}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
          <p className="text-xs text-muted-foreground">Klikaj na mapie; snapping działa do środków zdjęć i narożników footprintów.</p>
          {measurement && measurement.pointCount > 0 && (
            <div className="space-y-1 rounded-md border bg-background p-3 text-xs text-foreground">
              <div className="flex justify-between">
                <span>Punkty:</span>
                <span className="font-mono">{measurement.pointCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Długość:</span>
                <span className="font-mono">{measurement.distanceMeters.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between">
                <span>Powierzchnia:</span>
                <span className="font-mono">{measurement.areaSquareMeters.toFixed(2)} m²</span>
              </div>
              <div className="flex justify-between">
                <span>Powierzchnia:</span>
                <span className="font-mono">{(measurement.areaSquareMeters / 10000).toFixed(4)} ha</span>
              </div>
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full" onClick={onClearMeasurement}>Wyczyść pomiar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> Warstwy KML
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          <label className="block">
            <input
              type="file"
              accept=".kml,.kmz"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportKml(file);
                event.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" asChild>
              <span><Upload className="mr-2 h-4 w-4" /> Importuj KML</span>
            </Button>
          </label>
          {kmlLayers.map((layer) => (
            <div key={layer.id} className="flex items-center justify-between gap-1 text-sm">
              <span
                className="flex-1 cursor-pointer truncate text-foreground hover:underline"
                onClick={() => onZoomToKml(layer.id)}
                title="Kliknij aby przybliżyć"
              >
                {layer.name}
              </span>
              <div className="flex items-center gap-0.5">
                <input
                  type="color"
                  value={layer.color}
                  onChange={(event) => onChangeKmlColor(layer.id, event.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border-0 p-0"
                  title="Zmień kolor"
                />
                <Button variant="ghost" size="sm" onClick={() => onZoomToKml(layer.id)} title="Przybliż">
                  <ZoomIn className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onToggleKmlLayer(layer.id)}>
                  {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onRemoveKmlLayer(layer.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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
          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground">Pokrycie (heatmapa)</Label>
            <Switch checked={showOverlapHeatmap} onCheckedChange={onToggleOverlap} />
          </div>
          <p className="text-xs text-muted-foreground">Ctrl+klik dodaje zdjęcia do zaznaczenia; w panelu niżej liczona jest średnia tylko z wybranych zdjęć.</p>
        </CardContent>
      </Card>

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
            <p className="text-xs text-muted-foreground">Podłużne = 1 - przesunięcie środków w osi lotu / krótszy bok rzutu. Poprzeczne analogicznie dla osi poprzecznej i dłuższego boku.</p>
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
              <p>Zdjęcia z danymi sensora z EXIF/estymacji: {exifSensorCount}/{photos.length}</p>
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
            <div className="flex justify-between text-muted-foreground">
              <span>Pary w zaznaczeniu:</span>
              <span>{selectedOverlapStats.pairs.length}</span>
            </div>
          </CardContent>
        </Card>
      )}

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
              onChange={(event) => onSensorChange({ ...sensor, flightAltitude: parseFloat(event.target.value) || 0 })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Sidebar;