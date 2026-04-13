import { useCallback, useMemo, useState } from "react";
import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import L from "leaflet";
import { Camera, Menu, X } from "lucide-react";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { DEFAULT_FOOTPRINT_STYLE, FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, PhotoPoint, SensorConfig } from "@/types/photo";
import { analyzeOverlap, assignHeadings, calcFootprint, calcFootprintCorners, calcGSD, estimateSensorDimensions } from "@/lib/photoUtils";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CoordinateSystem, COORDINATE_SYSTEMS, formatCoordinates } from "@/lib/coordinateUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { analyzeCoverage, CoverageResult } from "@/lib/coverageUtils";
import { DrawMode, DrawnFeature } from "@/types/drawing";
import { importDxf, importShp, importTxt, exportDxf, exportGeoJson, exportTxt as exportTxtFile } from "@/lib/vectorImportExport";

const Index = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoPoint[]>([]);
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [sensor, setSensor] = useState<SensorConfig>({ resolutionX: 4000, resolutionY: 3000, sensorWidth: 13.2, sensorHeight: 8.8, focalLength: 8.8, flightAltitude: 100 });
  const [showFootprints, setShowFootprints] = useState(true);
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(DEFAULT_FOOTPRINT_STYLE);
  const [showOverlapHeatmap, setShowOverlapHeatmap] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"osm" | "google">("osm");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurement, setMeasurement] = useState<MeasurementSummary | null>(null);
  const [measurementResetSignal, setMeasurementResetSignal] = useState(0);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [coordSystem, setCoordSystem] = useState<CoordinateSystem>("wgs84");
  const [aglAltitude, setAglAltitude] = useState<number | null>(null);
  const [showAglPrompt, setShowAglPrompt] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const [coverageResults, setCoverageResults] = useState<Record<string, CoverageResult>>({});
  const [coverageGaps, setCoverageGaps] = useState<CoverageResult["gaps"]>([]);
  const overlapStats = useMemo(() => analyzeOverlap(photos), [photos]);
  const selectedPhotos = useMemo(() => photos.filter((photo) => selectedPhotoIds.includes(photo.id)), [photos, selectedPhotoIds]);
  const selectedOverlapStats = useMemo(
    () => (selectedPhotos.length >= 2 ? analyzeOverlap(selectedPhotos) : null),
    [selectedPhotos]
  );

  const startImport = useCallback((files: FileList) => {
    setPendingFiles(files);
    setShowAglPrompt(true);
  }, []);

  const processImport = useCallback(async (files: FileList, userAgl: number) => {
    const newPhotos: PhotoPoint[] = [];
    let noGps = 0;
    const total = files.length;

    setImportProgress({ current: 0, total });

    for (let i = 0; i < total; i++) {
      const file = files[i];
      try {
        const exif = await exifr.parse(file, { gps: true, tiff: true, exif: true });
        if (!exif?.latitude || !exif?.longitude) {
          noGps++;
          setImportProgress({ current: i + 1, total });
          continue;
        }

        const estimated = estimateSensorDimensions(exif);
        const altitudeAGL = userAgl;

        const currentSensor: SensorConfig = {
          resolutionX: estimated.resX,
          resolutionY: estimated.resY,
          sensorWidth: estimated.width,
          sensorHeight: estimated.height,
          focalLength: estimated.focal,
          flightAltitude: altitudeAGL,
        };

        const { groundWidth, groundHeight } = calcFootprint(currentSensor, altitudeAGL);
        const longSide = Math.max(groundWidth, groundHeight);
        const shortSide = Math.min(groundWidth, groundHeight);

        newPhotos.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          filename: file.name,
          lat: exif.latitude,
          lng: exif.longitude,
          altitude: exif.GPSAltitude,
          timestamp: exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal) : undefined,
          footprintWidth: longSide,
          footprintHeight: shortSide,
          footprintCorners: [],
          gsd: calcGSD(currentSensor, altitudeAGL),
          sensorInfo: {
            sensorWidth: estimated.width,
            sensorHeight: estimated.height,
            focalLength: estimated.focal,
            resolutionX: estimated.resX,
            source: estimated.source,
          },
          thumbnailUrl: URL.createObjectURL(file),
        });
      } catch {
        noGps++;
      }
      setImportProgress({ current: i + 1, total });
    }

    if (newPhotos.length > 0) {
      setPhotos((prev) => {
        const allPhotos = [...prev, ...newPhotos];
        const withHeadings = assignHeadings(allPhotos);
        return withHeadings.map((photo) => ({
          ...photo,
          footprintCorners: calcFootprintCorners(photo.lat, photo.lng, photo.footprintWidth, photo.footprintHeight, photo.heading ?? 0),
        }));
      });
      toast.success(`Zaimportowano ${newPhotos.length} zdjęć`);
    }

    if (noGps > 0) {
      toast.warning(`${noGps} zdjęć bez danych GPS — pominięto`);
    }

    setImportProgress(null);
  }, []);

  const handleAglConfirm = useCallback(() => {
    if (pendingFiles && aglAltitude !== null && aglAltitude > 0) {
      setShowAglPrompt(false);
      processImport(pendingFiles, aglAltitude);
      setPendingFiles(null);
    }
  }, [pendingFiles, aglAltitude, processImport]);

  const handleImportKml = useCallback(async (file: File) => {
    try {
      const geojson = kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
      setKmlLayers((prev) => [
        ...prev,
        { id: `kml-${Date.now()}`, name: file.name.replace(/\.[^/.]+$/, ""), visible: true, color: "#e11d48", weight: 2, geojson: geojson as any },
      ]);
      toast.success(`Dodano KML: ${file.name}`);
    } catch {
      toast.error("Błąd KML");
    }
  }, []);

  const handlePhotoSelect = useCallback((id: string | null, ctrlKey: boolean) => {
    if (!id) {
      setSelectedPhotoIds([]);
      return;
    }
    if (ctrlKey) {
      setSelectedPhotoIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
      return;
    }
    setSelectedPhotoIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
  }, []);

  const handleSearchResult = useCallback((lat: number, lng: number) => {
    window.dispatchEvent(new CustomEvent("zoom-to-bounds", {
      detail: { bounds: L.latLngBounds([[lat - 0.01, lng - 0.01], [lat + 0.01, lng + 0.01]]) },
    }));
  }, []);

  const handleZoomToPhotos = useCallback(() => {
    if (photos.length === 0) return;
    const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng] as [number, number]));
    window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
  }, [photos]);

  const handleMeasureModeChange = useCallback((mode: MeasureMode) => {
    setMeasureMode(mode);
    setMeasurement(null);
    setMeasurementResetSignal((value) => value + 1);
  }, []);

  const handleClearMeasurement = useCallback(() => {
    setMeasurement(null);
    setMeasurementResetSignal((value) => value + 1);
  }, []);

  const handleCheckCoverage = useCallback((kmlId: string) => {
    const layer = kmlLayers.find((l) => l.id === kmlId);
    if (!layer) return;
    if (photos.length === 0) {
      toast.warning("Brak zdjęć do analizy pokrycia");
      return;
    }
    const result = analyzeCoverage(layer, photos);
    setCoverageResults((prev) => ({ ...prev, [kmlId]: result }));
    setCoverageGaps(result.gaps);
    if (result.coveragePercent >= 95) {
      toast.success(`Pokrycie: ${result.coveragePercent.toFixed(1)}% — obszar w pełni pokryty`);
    } else {
      toast.warning(`Pokrycie: ${result.coveragePercent.toFixed(1)}% — wykryto luki`);
    }
  }, [kmlLayers, photos]);

  return (
    <div
      className="relative flex h-screen w-screen overflow-hidden bg-background"
      onDrop={(event) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        if (!files.length) return;
        if (files[0].name.match(/\.(kml|kmz)$/i)) {
          handleImportKml(files[0]);
        } else {
          startImport(files);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-[1100] bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className={`fixed z-[1200] h-full w-80 bg-background shadow-2xl transition-transform duration-300 md:relative md:z-auto md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <Sidebar
          photos={photos}
          kmlLayers={kmlLayers}
          sensor={sensor}
          showFootprints={showFootprints}
          footprintStyle={footprintStyle}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          overlapStats={overlapStats}
          selectedPhotoCount={selectedPhotoIds.length}
          selectedOverlapStats={selectedOverlapStats}
          measureMode={measureMode}
          measurement={measurement}
          onImportPhotos={startImport}
          onImportKml={handleImportKml}
          onToggleFootprints={setShowFootprints}
          onFootprintStyleChange={setFootprintStyle}
          onToggleOverlap={setShowOverlapHeatmap}
          onBaseLayerChange={setBaseLayer}
          onToggleKmlLayer={(id) => setKmlLayers((layers) => layers.map((layer) => (layer.id === id ? { ...layer, visible: !layer.visible } : layer)))}
          onRemoveKmlLayer={(id) => setKmlLayers((layers) => layers.filter((layer) => layer.id !== id))}
          onChangeKmlColor={(id, color) => setKmlLayers((layers) => layers.map((layer) => (layer.id === id ? { ...layer, color } : layer)))}
          onChangeKmlWeight={(id, weight) => setKmlLayers((layers) => layers.map((layer) => (layer.id === id ? { ...layer, weight } : layer)))}
          onZoomToKml={(id) => {
            const layer = kmlLayers.find((item) => item.id === id);
            if (!layer) return;
            const bounds = L.geoJSON(layer.geojson).getBounds();
            if (bounds.isValid()) {
              window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
            }
          }}
          onSensorChange={setSensor}
          onClearPhotos={() => {
            setPhotos([]);
            setSelectedPhotoIds([]);
            setMeasurement(null);
            setMeasurementResetSignal((value) => value + 1);
          }}
          onZoomToPhotos={handleZoomToPhotos}
          onSearchResult={handleSearchResult}
          onMeasureModeChange={handleMeasureModeChange}
          onClearMeasurement={handleClearMeasurement}
          onCheckCoverage={handleCheckCoverage}
          coverageResults={coverageResults}
        />
      </div>

      <div className="relative flex-1 w-full">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute left-4 top-4 z-[1300] rounded-lg border bg-card p-3 text-foreground shadow-lg md:hidden"
        >
          {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        {importProgress && (
          <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 w-72 rounded-lg border bg-card p-3 shadow-lg">
            <p className="text-xs text-muted-foreground mb-2">
              Przetwarzanie zdjęć: {importProgress.current}/{importProgress.total}
            </p>
            <Progress value={(importProgress.current / importProgress.total) * 100} className="h-2" />
          </div>
        )}

        <MapView
          photos={photos}
          kmlLayers={kmlLayers}
          showFootprints={showFootprints}
          footprintStyle={footprintStyle}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          selectedPhotoIds={selectedPhotoIds}
          onPhotoSelect={handlePhotoSelect}
          measureMode={measureMode}
          measurementResetSignal={measurementResetSignal}
          onMeasurementChange={setMeasurement}
          onMapClick={(lat, lng) => setClickedCoords({ lat, lng })}
          coverageGaps={coverageGaps}
        />

        {/* AGL prompt dialog */}
        {showAglPrompt && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/50">
            <div className="rounded-lg border bg-card p-6 shadow-xl w-80 space-y-4">
              <h3 className="text-sm font-bold text-foreground">Podaj wysokość lotu AGL</h3>
              <p className="text-xs text-muted-foreground">
                Wysokość nad terenem (Above Ground Level) w metrach. Jest potrzebna do poprawnego obliczenia zasięgów i GSD.
              </p>
              <Input
                type="number"
                step="0.1"
                min="1"
                placeholder="np. 100"
                value={aglAltitude ?? ""}
                onChange={(e) => setAglAltitude(parseFloat(e.target.value) || null)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAglConfirm()}
              />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleAglConfirm} disabled={!aglAltitude || aglAltitude <= 0}>
                  Importuj
                </Button>
                <Button variant="outline" onClick={() => { setShowAglPrompt(false); setPendingFiles(null); }}>
                  Anuluj
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Coordinate display */}
        {clickedCoords && (() => {
          const coords = formatCoordinates(clickedCoords.lat, clickedCoords.lng, coordSystem);
          return (
            <div
              className="absolute bottom-4 left-4 z-[1000] rounded-lg border bg-card/95 px-3 py-2 shadow-lg backdrop-blur text-xs text-foreground"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-1">
                <Select value={coordSystem} onValueChange={(v) => setCoordSystem(v as CoordinateSystem)}>
                  <SelectTrigger className="h-6 w-[130px] text-xs border-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[2000]">
                    {COORDINATE_SYSTEMS.map((cs) => (
                      <SelectItem key={cs.value} value={cs.value} className="text-xs">{cs.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button onClick={() => setClickedCoords(null)} className="text-muted-foreground hover:text-foreground ml-1">✕</button>
              </div>
              <div className="font-mono leading-relaxed">
                <div>{coords.line1}</div>
                <div>{coords.line2}</div>
              </div>
            </div>
          );
        })()}

        {!photos.length && !kmlLayers.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="mx-4 max-w-md rounded-lg border bg-card/90 p-8 text-center shadow-lg backdrop-blur">
              <Camera className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">Przeciągnij zdjęcia lub pliki KML</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
