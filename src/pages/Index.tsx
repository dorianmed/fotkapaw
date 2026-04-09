import { useCallback, useMemo, useState } from "react";
import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import L from "leaflet";
import { Camera, Menu, X } from "lucide-react";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { DEFAULT_SENSOR, KmlLayer, MeasureMode, MeasurementSummary, PhotoPoint, SensorConfig } from "@/types/photo";
import { analyzeOverlap, assignHeadings, calcFootprint, calcFootprintCorners, calcGSD, estimateSensorDimensions } from "@/lib/photoUtils";
import { toast } from "sonner";

const Index = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoPoint[]>([]);
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [sensor, setSensor] = useState<SensorConfig>(DEFAULT_SENSOR);
  const [showFootprints, setShowFootprints] = useState(true);
  const [showOverlapHeatmap, setShowOverlapHeatmap] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"osm" | "google">("osm");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurement, setMeasurement] = useState<MeasurementSummary | null>(null);
  const [measurementResetSignal, setMeasurementResetSignal] = useState(0);

  const overlapStats = useMemo(() => analyzeOverlap(photos), [photos]);
  const selectedPhotos = useMemo(() => photos.filter((photo) => selectedPhotoIds.includes(photo.id)), [photos, selectedPhotoIds]);
  const selectedOverlapStats = useMemo(
    () => (selectedPhotos.length >= 2 ? analyzeOverlap(selectedPhotos) : null),
    [selectedPhotos]
  );

  const handleImportPhotos = useCallback(async (files: FileList) => {
    const newPhotos: PhotoPoint[] = [];
    let noGps = 0;
    const fallbackSensor: SensorConfig = { ...DEFAULT_SENSOR, flightAltitude: sensor.flightAltitude };

    for (const file of Array.from(files)) {
      try {
        const exif = await exifr.parse(file, { gps: true, tiff: true, exif: true });
        if (!exif?.latitude || !exif?.longitude) {
          noGps++;
          continue;
        }

        const estimated = estimateSensorDimensions(exif, fallbackSensor);
        const currentSensor: SensorConfig = {
          ...fallbackSensor,
          sensorWidth: estimated.width,
          sensorHeight: estimated.height,
          focalLength: estimated.focal,
          resolutionX: estimated.resX,
          resolutionY: estimated.resY,
        };

        const altitude = exif.GPSAltitude ?? sensor.flightAltitude;
        const { groundWidth, groundHeight } = calcFootprint(currentSensor, altitude);
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
          gsd: calcGSD(currentSensor, altitude),
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
  }, [sensor.flightAltitude]);

  const handleImportKml = useCallback(async (file: File) => {
    try {
      const geojson = kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
      setKmlLayers((prev) => [
        ...prev,
        { id: `kml-${Date.now()}`, name: file.name.replace(/\.[^/.]+$/, ""), visible: true, color: "#e11d48", geojson: geojson as any },
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

  const handleMeasureModeChange = useCallback((mode: MeasureMode) => {
    setMeasureMode(mode);
    setMeasurement(null);
    setMeasurementResetSignal((value) => value + 1);
  }, []);

  const handleClearMeasurement = useCallback(() => {
    setMeasurement(null);
    setMeasurementResetSignal((value) => value + 1);
  }, []);

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
          handleImportPhotos(files);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className={`absolute z-20 h-full w-80 bg-background shadow-2xl transition-transform duration-300 md:relative md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <Sidebar
          photos={photos}
          kmlLayers={kmlLayers}
          sensor={sensor}
          showFootprints={showFootprints}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          overlapStats={overlapStats}
          selectedPhotoCount={selectedPhotoIds.length}
          selectedOverlapStats={selectedOverlapStats}
          measureMode={measureMode}
          measurement={measurement}
          onImportPhotos={handleImportPhotos}
          onImportKml={handleImportKml}
          onToggleFootprints={setShowFootprints}
          onToggleOverlap={setShowOverlapHeatmap}
          onBaseLayerChange={setBaseLayer}
          onToggleKmlLayer={(id) => setKmlLayers((layers) => layers.map((layer) => (layer.id === id ? { ...layer, visible: !layer.visible } : layer)))}
          onRemoveKmlLayer={(id) => setKmlLayers((layers) => layers.filter((layer) => layer.id !== id))}
          onChangeKmlColor={(id, color) => setKmlLayers((layers) => layers.map((layer) => (layer.id === id ? { ...layer, color } : layer)))}
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
          onSearchResult={handleSearchResult}
          onMeasureModeChange={handleMeasureModeChange}
          onClearMeasurement={handleClearMeasurement}
        />
      </div>

      <div className="relative flex-1 w-full">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute left-4 top-4 z-[1000] rounded-lg border bg-card p-3 text-foreground shadow-lg md:hidden"
        >
          {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        <MapView
          photos={photos}
          kmlLayers={kmlLayers}
          showFootprints={showFootprints}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          selectedPhotoIds={selectedPhotoIds}
          onPhotoSelect={handlePhotoSelect}
          measureMode={measureMode}
          measurementResetSignal={measurementResetSignal}
          onMeasurementChange={setMeasurement}
        />

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