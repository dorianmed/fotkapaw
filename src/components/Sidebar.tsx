import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PhotoPoint, KmlLayer, SensorConfig } from "@/types/photo";
import { Camera, Map, Layers, BarChart3, Upload, Eye, EyeOff, Trash2, ZoomIn } from "lucide-react";
import SearchBar from "@/components/SearchBar";

interface SidebarProps {
  photos: PhotoPoint[];
  kmlLayers: KmlLayer[];
  sensor: SensorConfig;
  showFootprints: boolean;
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google";
  overlapStats: { avgForward: number; avgLateral: number; pairs: any[] };
  onImportPhotos: (files: FileList) => void;
  onImportKml: (file: File) => void;
  onToggleFootprints: (v: boolean) => void;
  onToggleOverlap: (v: boolean) => void;
  onBaseLayerChange: (v: "osm" | "google") => void;
  onToggleKmlLayer: (id: string) => void;
  onRemoveKmlLayer: (id: string) => void;
  onChangeKmlColor: (id: string, color: string) => void;
  onZoomToKml: (id: string) => void;
  onSensorChange: (s: SensorConfig) => void;
  onClearPhotos: () => void;
  onSearchResult: (lat: number, lng: number, label: string) => void;
}

const Sidebar = ({
  photos, kmlLayers, sensor, showFootprints, showOverlapHeatmap,
  baseLayer, overlapStats,
  onImportPhotos, onImportKml,
  onToggleFootprints, onToggleOverlap, onBaseLayerChange,
  onToggleKmlLayer, onRemoveKmlLayer, onChangeKmlColor, onZoomToKml,
  onSensorChange, onClearPhotos, onSearchResult,
}: SidebarProps) => {
  const [showSensorSettings, setShowSensorSettings] = useState(false);

  const avgSpeed = photos.filter(p => p.speed !== undefined).length > 0
    ? photos.filter(p => p.speed !== undefined).reduce((s, p) => s + (p.speed ?? 0), 0) / photos.filter(p => p.speed !== undefined).length
    : undefined;

  const avgAltitude = photos.filter(p => p.altitude !== undefined).length > 0
    ? photos.filter(p => p.altitude !== undefined).reduce((s, p) => s + (p.altitude ?? 0), 0) / photos.filter(p => p.altitude !== undefined).length
    : undefined;

  const avgGsd = photos.filter(p => p.gsd !== undefined).length > 0
    ? photos.filter(p => p.gsd !== undefined).reduce((s, p) => s + (p.gsd ?? 0), 0) / photos.filter(p => p.gsd !== undefined).length
    : undefined;

  return (
    <div className="w-80 h-full overflow-y-auto border-r bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Analiza Nalotu</h1>
      </div>

      <SearchBar onResult={onSearchResult} />

      <Separator />

      {/* Import photos */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" /> Importuj zdjęcia
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <label className="block">
            <input
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/tiff"
              className="hidden"
              onChange={(e) => e.target.files && onImportPhotos(e.target.files)}
            />
            <Button variant="default" className="w-full" asChild>
              <span><Upload className="h-4 w-4 mr-2" /> Wybierz zdjęcia</span>
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

      {/* Import KML */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" /> Warstwy KML
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <label className="block">
            <input
              type="file"
              accept=".kml,.kmz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportKml(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" className="w-full" asChild>
              <span><Upload className="h-4 w-4 mr-2" /> Importuj KML</span>
            </Button>
          </label>
          {kmlLayers.map((kl) => (
            <div key={kl.id} className="flex items-center justify-between text-sm gap-1">
              <span
                className="truncate flex-1 text-foreground cursor-pointer hover:underline"
                onClick={() => onZoomToKml(kl.id)}
                title="Kliknij aby przybliżyć"
              >
                {kl.name}
              </span>
              <div className="flex items-center gap-0.5">
                <input
                  type="color"
                  value={kl.color}
                  onChange={(e) => onChangeKmlColor(kl.id, e.target.value)}
                  className="w-6 h-6 border-0 p-0 cursor-pointer rounded"
                  title="Zmień kolor"
                />
                <Button variant="ghost" size="sm" onClick={() => onZoomToKml(kl.id)} title="Przybliż">
                  <ZoomIn className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onToggleKmlLayer(kl.id)}>
                  {kl.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onRemoveKmlLayer(kl.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Map settings */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Map className="h-4 w-4" /> Podkład mapy
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="flex gap-2">
            <Button
              variant={baseLayer === "osm" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => onBaseLayerChange("osm")}
            >
              OSM
            </Button>
            <Button
              variant={baseLayer === "google" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => onBaseLayerChange("google")}
            >
              Google Sat
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground">Zasięgi zdjęć</Label>
            <Switch checked={showFootprints} onCheckedChange={onToggleFootprints} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground">Pokrycie (heatmapa)</Label>
            <Switch checked={showOverlapHeatmap} onCheckedChange={onToggleOverlap} />
          </div>
          <p className="text-xs text-muted-foreground">💡 Kliknij zdjęcie na mapie aby zobaczyć pokrycie. Ctrl+klik = multi-select</p>
        </CardContent>
      </Card>

      {/* Flight stats */}
      {photos.length >= 2 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Statystyki nalotu
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2 text-sm">
            <div className="flex justify-between text-foreground">
              <span>Śr. pokrycie podłużne:</span>
              <span className="font-mono font-bold">{overlapStats.avgForward.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-foreground">
              <span>Śr. pokrycie poprzeczne:</span>
              <span className="font-mono font-bold">{overlapStats.avgLateral.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Pary nakładające się:</span>
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
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Sensor (domyślny): {sensor.sensorWidth}×{sensor.sensorHeight} mm</p>
              <p>Ogniskowa: {sensor.focalLength} mm</p>
              <p>Pułap: {sensor.flightAltitude} m AGL</p>
              {photos[0]?.sensorInfo && (
                <>
                  <Separator />
                  <p className="text-primary font-medium">Z EXIF (1. zdjęcie):</p>
                  <p>Sensor: {photos[0].sensorInfo.sensorWidth.toFixed(2)}×{photos[0].sensorInfo.sensorHeight.toFixed(2)} mm</p>
                  <p>Ogniskowa: {photos[0].sensorInfo.focalLength.toFixed(1)} mm</p>
                  <p>Rozdzielczość: {photos[0].sensorInfo.resolutionX} px</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sensor config */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs"
        onClick={() => setShowSensorSettings(!showSensorSettings)}
      >
        {showSensorSettings ? "Ukryj" : "Pokaż"} ustawienia sensora (domyślne)
      </Button>
      {showSensorSettings && (
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">Używane gdy EXIF nie zawiera danych sensora</p>
            {[
              { label: "Sensor szer. (mm)", key: "sensorWidth" as const },
              { label: "Sensor wys. (mm)", key: "sensorHeight" as const },
              { label: "Ogniskowa (mm)", key: "focalLength" as const },
              { label: "Pułap lotu (m)", key: "flightAltitude" as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex items-center gap-2">
                <Label className="text-xs flex-1 text-foreground">{label}</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="w-24 h-7 text-xs"
                  value={sensor[key]}
                  onChange={(e) =>
                    onSensorChange({ ...sensor, [key]: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Sidebar;
