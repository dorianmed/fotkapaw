import { useState, useCallback, useRef } from "react";
import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import L from "leaflet";
import { Camera, Menu, X } from "lucide-react";
import MapView from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { PhotoPoint, KmlLayer, SensorConfig, DEFAULT_SENSOR } from "@/types/photo";
import { calcFootprint, calcFootprintCorners, calcGSD, analyzeOverlap, assignHeadings, estimateSensorDimensions } from "@/lib/photoUtils";
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

  const overlapStats = analyzeOverlap(photos);

  const handleImportPhotos = useCallback(async (files: FileList) => {
    const newPhotos: PhotoPoint[] = [];
    let noGps = 0;

    for (const file of Array.from(files)) {
      try {
        const exif = await exifr.parse(file, { gps: true, tiff: true, exif: true, xmp: true });
        if (!exif?.latitude || !exif?.longitude) {
          noGps++;
          continue;
        }

        const est = estimateSensorDimensions(exif, sensor);
        const currentSensor = { ...sensor, sensorWidth: est.width, sensorHeight: est.height, focalLength: est.focal, resolutionX: est.resX };
        const alt = exif.GPSAltitude ?? sensor.flightAltitude;
        const { groundWidth, groundHeight } = calcFootprint(currentSensor, alt);
        
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
          gsd: calcGSD(currentSensor, alt),
          thumbnailUrl: loadThumbnails ? URL.createObjectURL(file) : undefined,
        });
      } catch (e) {
        noGps++;
      }
    }

    if (newPhotos.length > 0) {
      setPhotos((prev) => {
        const all = [...prev, ...newPhotos];
        const withHeadings = assignHeadings(all);
        return withHeadings.map(p => ({
          ...p,
          footprintCorners: calcFootprintCorners(p.lat, p.lng, p.footprintWidth, p.footprintHeight, p.heading ?? 0)
        }));
      });
      toast.success(`Zaimportowano ${newPhotos.length} zdjęć`);
    }
    if (noGps > 0) toast.warning(`${noGps} zdjęć bez danych GPS — pominięto`);
  }, [sensor, loadThumbnails]);

  const handleImportKml = useCallback(async (file: File) => {
    try {
      const geojson = kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
      setKmlLayers(prev => [...prev, { id: `kml-${Date.now()}`, name: file.name.replace(/\.[^/.]+$/, ""), visible: true, color: "#e11d48", geojson: geojson as any }]);
      toast.success(`Dodano KML: ${file.name}`);
    } catch { toast.error("Błąd KML"); }
  }, []);

  return (
    <div 
      className="flex h-screen w-screen overflow-hidden bg-background relative" 
      onDrop={(e) => { 
        e.preventDefault(); 
        const f = e.dataTransfer.files; 
        if(f.length) {
          if (f[0].name.match(/\.(kml|kmz)$/i)) handleImportKml(f[0]);
          else handleImportPhotos(f);
        }
      }} 
      onDragOver={(e) => e.preventDefault()}
    >
      <div className={`absolute md:relative z-20 h-full bg-background transition-transform duration-300 w-80 shadow-2xl md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
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
          onToggleKmlLayer={(id) => setKmlLayers(ls => ls.map(l => l.id === id ? {...l, visible: !l.visible} : l))} 
          onRemoveKmlLayer={(id) => setKmlLayers(ls => ls.filter(l => l.id !== id))} 
          onChangeKmlColor={(id, color) => setKmlLayers(ls => ls.map(l => l.id === id ? {...l, color} : l))} 
          onZoomToKml={(id) => { 
            const l = kmlLayers.find(x => x.id === id); 
            if(l) {
              const bounds = L.geoJSON(l.geojson).getBounds();
              if (bounds.isValid()) window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
            }
          }} 
          onSensorChange={setSensor} 
          onClearPhotos={() => setPhotos([])} 
          loadThumbnails={loadThumbnails} 
          onToggleThumbnails={setLoadThumbnails} 
        />
      </div>
      <div className="flex-1 relative w-full">
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="absolute top-4 left-4 z-[1000] md:hidden bg-card text-foreground p-3 rounded-lg shadow-lg border">
          {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <MapView photos={photos} kmlLayers={kmlLayers} showFootprints={showFootprints} showOverlapHeatmap={showOverlapHeatmap} baseLayer={baseLayer} selectedPhotoId={selectedPhotoId} onPhotoSelect={setSelectedPhotoId} />
        {!photos.length && !kmlLayers.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card/90 backdrop-blur rounded-lg p-8 text-center shadow-lg border max-w-md mx-4">
              <Camera className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Przeciągnij zdjęcia lub pliki KML</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
