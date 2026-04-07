import { useState, useCallback, useRef } from "react";
import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import L from "leaflet";
import { Camera, Menu, X } from "lucide-react";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { PhotoPoint, KmlLayer, SensorConfig, DEFAULT_SENSOR } from "@/types/photo";
import { calcFootprint, calcFootprintCorners, calcGSD, analyzeOverlap, assignHeadings } from "@/lib/photoUtils";
import { toast } from "sonner";

const Index = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoPoint[]>([]);
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [sensor, setSensor] = useState<SensorConfig>(DEFAULT_SENSOR);
  const [showFootprints, setShowFootprints] = useState(true);
  const [showOverlapHeatmap, setShowOverlapHeatmap] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"osm" | "google">("osm");
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [loadThumbnails, setLoadThumbnails] = useState(false);
  const mapViewRef = useRef<{ zoomToBounds: (bounds: L.LatLngBoundsExpression) => void } | null>(null);

  const overlapStats = analyzeOverlap(photos);

  const handleImportPhotos = useCallback(async (files: FileList) => {
    const newPhotos: PhotoPoint[] = [];
    let noGps = 0;

    for (const file of Array.from(files)) {
      try {
        const exif = await exifr.parse(file, { gps: true, tiff: true, exif: true });
        if (exif?.latitude && exif?.longitude) {
          const alt = exif.GPSAltitude ?? sensor.flightAltitude;
          const { groundWidth, groundHeight } = calcFootprint(sensor, alt);
          const corners = calcFootprintCorners(exif.latitude, exif.longitude, groundWidth, groundHeight, 0);
          const gsd = calcGSD(sensor, alt);

          let thumbnailUrl: string | undefined;
          if (loadThumbnails) {
            thumbnailUrl = URL.createObjectURL(file);
          }

          const timestamp = exif.DateTimeOriginal || exif.CreateDate;

          newPhotos.push({
            id: `${file.name}-${Date.now()}-${Math.random()}`,
            filename: file.name,
            lat: exif.latitude,
            lng: exif.longitude,
            altitude: exif.GPSAltitude,
            timestamp: timestamp ? new Date(timestamp) : undefined,
            footprintWidth: groundWidth,
            footprintHeight: groundHeight,
            footprintCorners: corners,
            gsd,
            thumbnailUrl,
          });
        } else {
          noGps++;
        }
      } catch {
        noGps++;
      }
    }

    if (newPhotos.length > 0) {
      setPhotos((prev) => {
        const all = [...prev, ...newPhotos];
        // Assign headings and recalculate rotated footprints
        const withHeadings = assignHeadings(all);
        return withHeadings.map(p => {
          const alt = p.altitude ?? sensor.flightAltitude;
          const { groundWidth, groundHeight } = calcFootprint(sensor, alt);
          // Dodajemy +90 stopni, by ułożyć wymiary klatki prostopadle do wektora lotu 
          const corners = calcFootprintCorners(p.lat, p.lng, groundWidth, groundHeight, (p.heading ?? 0) + 90);
          return { ...p, footprintCorners: corners, footprintWidth: groundWidth, footprintHeight: groundHeight };
        });
      });
      toast.success(`Zaimportowano ${newPhotos.length} zdjęć`);
    }
    if (noGps > 0) {
      toast.warning(`${noGps} zdjęć bez danych GPS — pominięto`);
    }
  }, [sensor, loadThumbnails]);

  const handleImportKml = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      const geojson = kml(xmlDoc);

      setKmlLayers((prev) => [
        ...prev,
        {
          id: `kml-${Date.now()}`,
          name: file.name.replace(/\.(kml|kmz)$/i, ""),
          visible: true,
          color: "#e11d48",
          geojson: geojson as GeoJSON.FeatureCollection,
        },
      ]);
      toast.success(`Zaimportowano warstwę: ${file.name}`);
    } catch {
      toast.error("Błąd importu pliku KML");
    }
  }, []);

  const handleToggleKmlLayer = (id: string) => {
    setKmlLayers((prev) =>
      prev.map((kl) => (kl.id === id ? { ...kl, visible: !kl.visible } : kl))
    );
  };

  const handleRemoveKmlLayer = (id: string) => {
    setKmlLayers((prev) => prev.filter((kl) => kl.id !== id));
  };

  const handleChangeKmlColor = (id: string, color: string) => {
    setKmlLayers((prev) =>
      prev.map((kl) => (kl.id === id ? { ...kl, color } : kl))
    );
  };

  const handleZoomToKml = (id: string) => {
    const layer = kmlLayers.find(kl => kl.id === id);
    if (!layer) return;
    const geoLayer = L.geoJSON(layer.geojson);
    const bounds = geoLayer.getBounds();
    if (bounds.isValid()) {
      // We need to access the map - dispatch a custom event
      window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const firstFile = files[0];
        if (firstFile.name.match(/\.(kml|kmz)$/i)) {
          handleImportKml(firstFile);
        } else {
          handleImportPhotos(files);
        }
      }
    },
    [handleImportPhotos, handleImportKml]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Pasek boczny: ukryty z boku na telefonie, domyślnie widoczny na PC */}
      <div 
        className={`absolute md:relative z-20 h-full bg-background transition-transform duration-300 w-80 shadow-2xl md:shadow-none ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar
          photos={photos}
          kmlLayers={kmlLayers}
          sensor={sensor}
          showFootprints={showFootprints}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          overlapStats={overlapStats}
          onImportPhotos={handleImportPhotos}
          onImportKml={handleImportKml}
          onToggleFootprints={setShowFootprints}
          onToggleOverlap={setShowOverlapHeatmap}
          onBaseLayerChange={setBaseLayer}
          onToggleKmlLayer={handleToggleKmlLayer}
          onRemoveKmlLayer={handleRemoveKmlLayer}
          onChangeKmlColor={handleChangeKmlColor}
          onZoomToKml={handleZoomToKml}
          onSensorChange={setSensor}
          onClearPhotos={() => setPhotos([])}
          loadThumbnails={loadThumbnails}
          onToggleThumbnails={setLoadThumbnails}
        />
      </div>

      <div className="flex-1 relative w-full">
        {/* Guzik menu na telefonach */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute top-4 left-4 z-[1000] md:hidden bg-card text-foreground p-3 rounded-lg shadow-lg border"
        >
          {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        <MapView
          photos={photos}
          kmlLayers={kmlLayers}
          showFootprints={showFootprints}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          selectedPhotoId={selectedPhotoId}
          onPhotoSelect={setSelectedPhotoId}
        />
        {photos.length === 0 && kmlLayers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card/90 backdrop-blur rounded-lg p-8 text-center shadow-lg border max-w-md mx-4">
              <Camera className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium text-foreground">Przeciągnij zdjęcia lub pliki KML</p>
              <p className="text-sm text-muted-foreground mt-2">
                lub otwórz menu, aby dodać pliki z dysku
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
