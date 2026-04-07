import { useState, useCallback } from "react";
import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { PhotoPoint, KmlLayer, SensorConfig, DEFAULT_SENSOR } from "@/types/photo";
import { calcFootprint, calcFootprintCorners, analyzeOverlap } from "@/lib/photoUtils";
import { toast } from "sonner";

const Index = () => {
  const [photos, setPhotos] = useState<PhotoPoint[]>([]);
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [sensor, setSensor] = useState<SensorConfig>(DEFAULT_SENSOR);
  const [showFootprints, setShowFootprints] = useState(true);
  const [showOverlapHeatmap, setShowOverlapHeatmap] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"osm" | "google">("osm");

  const overlapStats = analyzeOverlap(photos);

  const handleImportPhotos = useCallback(async (files: FileList) => {
    const newPhotos: PhotoPoint[] = [];
    let noGps = 0;

    for (const file of Array.from(files)) {
      try {
        const exif = await exifr.parse(file, { gps: true });
        if (exif?.latitude && exif?.longitude) {
          const { groundWidth, groundHeight } = calcFootprint(sensor);
          const corners = calcFootprintCorners(exif.latitude, exif.longitude, groundWidth, groundHeight);
          newPhotos.push({
            id: `${file.name}-${Date.now()}-${Math.random()}`,
            filename: file.name,
            lat: exif.latitude,
            lng: exif.longitude,
            altitude: exif.GPSAltitude,
            footprintWidth: groundWidth,
            footprintHeight: groundHeight,
            footprintCorners: corners,
          });
        } else {
          noGps++;
        }
      } catch {
        noGps++;
      }
    }

    if (newPhotos.length > 0) {
      setPhotos((prev) => [...prev, ...newPhotos]);
      toast.success(`Zaimportowano ${newPhotos.length} zdjęć`);
    }
    if (noGps > 0) {
      toast.warning(`${noGps} zdjęć bez danych GPS — pominięto`);
    }
  }, [sensor]);

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

  // Drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        // Check if KML
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
      className="flex h-screen w-screen overflow-hidden bg-background"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
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
        onSensorChange={setSensor}
        onClearPhotos={() => setPhotos([])}
      />
      <div className="flex-1 relative">
        <MapView
          photos={photos}
          kmlLayers={kmlLayers}
          showFootprints={showFootprints}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
        />
        {photos.length === 0 && kmlLayers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card/90 backdrop-blur rounded-lg p-8 text-center shadow-lg border max-w-md">
              <Camera className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium text-foreground">Przeciągnij zdjęcia lub pliki KML</p>
              <p className="text-sm text-muted-foreground mt-2">
                lub użyj przycisków w panelu bocznym
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import { Camera } from "lucide-react";
export default Index;
