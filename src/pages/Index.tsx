import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import exifr from "exifr";
import { kml } from "@tmcw/togeojson";
import L from "leaflet";
import { Camera, Menu, X, MousePointer2, PanelRight, Trash2, GripVertical } from "lucide-react";
import MapView from "@/components/MapView";
import MapControls from "@/components/MapControls";
import Sidebar from "@/components/Sidebar";
import ToolsPanel from "@/components/ToolsPanel";
import TxtImportDialog from "@/components/TxtImportDialog";
import { DEFAULT_FOOTPRINT_STYLE, FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, PhotoPoint, SensorConfig } from "@/types/photo";
import { analyzeOverlap, assignHeadings, calcDistance, calcFootprint, calcFootprintCorners, calcGSD, estimateSensorDimensions } from "@/lib/photoUtils";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CoordinateSystem, COORDINATE_SYSTEMS, formatCoordinates, projectCoords, exportPrecision } from "@/lib/coordinateUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { analyzeCoverage, CoverageResult } from "@/lib/coverageUtils";
import { DrawingLayer } from "@/types/drawing";
import { importDxf, importShp, importTxtAdvanced, importGml, exportDxf, exportGeoJson, exportTxt as exportTxtFile, saveBlob, TxtImportOptions } from "@/lib/vectorImportExport";
import { fetchTerrainHeight, fetchTerrainHeights } from "@/lib/terrainUtils";
import { Job, loadJobs, saveJobs, createJob, exportJobToFile, exportAllJobsToFile, parseJobsFile } from "@/lib/jobsStore";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const LAYER_COLORS = { point: "#ef4444", line: "#3b82f6", polygon: "#22c55e" } as const;

// Czy odcinki AB i CD się przecinają (do kontroli topologii poligonów/linii).
const segmentsIntersect = (
  a: [number, number], b: [number, number], c: [number, number], d: [number, number]
): boolean => {
  const ccw = (p: [number, number], q: [number, number], r: [number, number]) =>
    (r[0] - p[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (r[1] - p[1]);
  const d1 = ccw(c, d, a), d2 = ccw(c, d, b), d3 = ccw(a, b, c), d4 = ccw(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};
const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

const Index = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoPoint[]>([]);
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [sensor, setSensor] = useState<SensorConfig>({ resolutionX: 4000, resolutionY: 3000, sensorWidth: 13.2, sensorHeight: 8.8, focalLength: 8.8, flightAltitude: 100 });
  const [showFootprints, setShowFootprints] = useState(true);
  const [footprintStyle, setFootprintStyle] = useState<FootprintStyle>(DEFAULT_FOOTPRINT_STYLE);
  const [showOverlapHeatmap, setShowOverlapHeatmap] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"osm" | "google" | "wms">("osm");
  const [wmsUrl, setWmsUrl] = useState<string>("https://sh.dataspace.copernicus.eu/ogc/wms/2a3dca8e-5210-4752-ba0f-cd3300dee17d");
  const [wmsLayers, setWmsLayers] = useState<string[]>([]);
  const [wmsSelectedLayer, setWmsSelectedLayer] = useState<string | null>(null);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurement, setMeasurement] = useState<MeasurementSummary | null>(null);
  const [measurementResetSignal, setMeasurementResetSignal] = useState(0);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [clickedPhotoAltitude, setClickedPhotoAltitude] = useState<number | null>(null);
  const [clickedTerrainHeight, setClickedTerrainHeight] = useState<{ loading: boolean; value: number | null } | null>(null);
  const [coordSystem, setCoordSystem] = useState<CoordinateSystem>("wgs84");
  const [aglAltitude, setAglAltitude] = useState<number | null>(null);
  const [useDemForAgl, setUseDemForAgl] = useState(false);
  const [showAglPrompt, setShowAglPrompt] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const [coverageResults, setCoverageResults] = useState<Record<string, CoverageResult>>({});
  const [coverageGaps, setCoverageGaps] = useState<CoverageResult["gaps"]>([]);
  const [wmsPixelInfo, setWmsPixelInfo] = useState<{ layer: string; info: string } | null>(null);
  const terrainClickRequestRef = useRef(0);
  // Pozycja (przeciągalnego) okienka współrzędnych – gdy null, domyślnie lewy dolny róg.
  const [coordPos, setCoordPos] = useState<{ x: number; y: number } | null>(null);
  const coordDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const startCoordDrag = useCallback((e: React.PointerEvent) => {
    const panel = (e.currentTarget as HTMLElement).closest("[data-coord-panel]") as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    coordDragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const move = (ev: PointerEvent) => {
      if (!coordDragRef.current) return;
      setCoordPos({ x: ev.clientX - coordDragRef.current.dx, y: ev.clientY - coordDragRef.current.dy });
    };
    const up = () => {
      coordDragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);


  // Drawing layer model
  const [drawingLayers, setDrawingLayers] = useState<DrawingLayer[]>([]);
  const [activeDrawLayerId, setActiveDrawLayerId] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [selectedFeature, setSelectedFeature] = useState<{ layerId: string; featureId: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<{ layerId: string; featureId: string }[]>([]);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [txtImport, setTxtImport] = useState<{ name: string; text: string } | null>(null);

  // ── JOBS (prace) ──
  const [jobs, setJobs] = useState<Job[]>(() => loadJobs());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const mapViewRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const activeJob = useMemo(() => jobs.find((j) => j.id === activeJobId) ?? null, [jobs, activeJobId]);
  const defaultCrs: CoordinateSystem = activeJob?.crs ?? "puwg1992";
  useEffect(() => { saveJobs(jobs); }, [jobs]);

  // Auto-zapis: każda zmiana warstw/punktów trafia od razu do aktywnej pracy (JOB).
  useEffect(() => {
    if (!activeJobId) return;
    setJobs((prev) => prev.map((j) => (j.id !== activeJobId ? j : {
      ...j, updatedAt: Date.now(), center: mapViewRef.current ?? j.center,
      data: { drawingLayers, kmlLayers },
    })));
  }, [drawingLayers, kmlLayers, activeJobId]);






  const selectedFeatureRefs = useMemo(() => selectedFeatures.map((s) => `${s.layerId}:${s.featureId}`), [selectedFeatures]);
  const handleToggleSelectFeature = useCallback((layerId: string, featureId: string) => {
    setSelectedFeatures((prev) =>
      prev.some((s) => s.layerId === layerId && s.featureId === featureId)
        ? prev.filter((s) => !(s.layerId === layerId && s.featureId === featureId))
        : [...prev, { layerId, featureId }]
    );
  }, []);
  const handleFenceSelect = useCallback((refs: { layerId: string; featureId: string }[]) => setSelectedFeatures(refs), []);
  const handleClearSelection = useCallback(() => setSelectedFeatures([]), []);

  // Usuwa wszystkie obiekty zaznaczone narzędziem strzałki/ogrodzenia
  // (zarówno warstwy rysowania, jak i wektorowe KML/TXT/DXF).
  const handleDeleteSelectedFeatures = useCallback(() => {
    if (selectedFeatures.length === 0) return;
    const drawIds = new Map<string, Set<string>>();
    const kmlIdx = new Map<string, Set<number>>();
    for (const s of selectedFeatures) {
      const n = Number(s.featureId);
      if (Number.isInteger(n) && String(n) === s.featureId) {
        if (!kmlIdx.has(s.layerId)) kmlIdx.set(s.layerId, new Set());
        kmlIdx.get(s.layerId)!.add(n);
      } else {
        if (!drawIds.has(s.layerId)) drawIds.set(s.layerId, new Set());
        drawIds.get(s.layerId)!.add(s.featureId);
      }
    }
    const count = selectedFeatures.length;
    setDrawingLayers((prev) => prev.map((l) => {
      const ids = drawIds.get(l.id);
      return ids ? { ...l, features: l.features.filter((f) => !ids.has(f.id)) } : l;
    }));
    setKmlLayers((prev) => prev.map((l) => {
      const idxs = kmlIdx.get(l.id);
      if (!idxs) return l;
      return { ...l, geojson: { ...l.geojson, features: l.geojson.features.filter((_, i) => !idxs.has(i)) } };
    }));
    setSelectedFeatures([]);
    setSelectedFeature(null);
    toast.success(`Usunięto ${count} obiekt(ów)`);
  }, [selectedFeatures]);


  const activeDrawLayer = useMemo(() => drawingLayers.find((l) => l.id === activeDrawLayerId) ?? null, [drawingLayers, activeDrawLayerId]);
  const drawMode = activeDrawLayer?.type ?? "none";

  const overlapStats = useMemo(() => analyzeOverlap(photos), [photos]);
  const selectedPhotos = useMemo(() => photos.filter((photo) => selectedPhotoIds.includes(photo.id)), [photos, selectedPhotoIds]);
  const selectedOverlapStats = useMemo(
    () => (selectedPhotos.length >= 2 ? analyzeOverlap(selectedPhotos) : null),
    [selectedPhotos]
  );

  const filterMultispectral = useCallback((files: FileList): { kept: File[]; total: number; isMS: boolean } => {
    const all = Array.from(files);
    let isMS = false;
    // Drop DJI multispectral band TIFs (keep only _D.JPG)
    const step1 = all.filter((f) => {
      if (/_MS_(G|R|RE|NIR|B)\.tiff?$/i.test(f.name)) { isMS = true; return false; }
      return true;
    });
    // For IMG_XXXX_N.* (N=1..10) keep only _1
    const kept: File[] = [];
    for (const f of step1) {
      const m = f.name.match(/^(IMG_\d+)_(\d+)\.(jpe?g|tif|tiff)$/i);
      if (m) {
        isMS = true;
        if (parseInt(m[2], 10) !== 1) continue;
      }
      kept.push(f);
    }
    return { kept, total: all.length, isMS };
  }, []);

  const startImport = useCallback((files: FileList) => {
    const { kept, total, isMS } = filterMultispectral(files);
    let finalKept = kept;
    // Fallback: gdy filtr odrzuci wszystko (folder bez _D.JPG / bez _1.tif),
    // wczytaj wszystkie pliki obrazów, żeby nie blokować importu.
    if (finalKept.length === 0) {
      const all = Array.from(files).filter((f) => /\.(jpe?g|tiff?|png)$/i.test(f.name));
      if (all.length === 0) { toast.warning("Brak plików obrazów w wybranym folderze"); return; }
      toast.info(`Filtr MS nic nie zwrócił – wczytuję wszystkie ${all.length} plików`);
      finalKept = all;
    } else if (isMS) {
      toast.info(`Zdjęcia multispektralne: wczytuję ${finalKept.length} z ${total} plików`);
    }
    const dt = new DataTransfer();
    finalKept.forEach((f) => dt.items.add(f));
    setPendingFiles(dt.files);
    setShowAglPrompt(true);
  }, [filterMultispectral]);

  const processImport = useCallback(async (files: FileList, opts: { manualAgl: number; useDem: boolean }) => {
    const total = files.length;
    setImportProgress({ current: 0, total });

    try {
      // 1) parse EXIF równolegle w paczkach (znacznie szybciej dla tysięcy zdjęć)
      type Parsed = { file: File; exif: any };
      const parsed: Parsed[] = [];
      let noGps = 0;
      let done = 0;
      const CONCURRENCY = 32;
      const fileArr = Array.from(files);
      for (let i = 0; i < fileArr.length; i += CONCURRENCY) {
        const batch = fileArr.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (file) => {
            try {
              const exif = await exifr.parse(file, { gps: true, tiff: true, exif: true });
              if (exif && typeof exif.latitude === "number" && typeof exif.longitude === "number") {
                return { file, exif } as Parsed;
              }
            } catch { /* brak/uszkodzony EXIF */ }
            return null;
          })
        );
        for (const r of results) {
          if (r) parsed.push(r);
          else noGps++;
        }
        done += batch.length;
        setImportProgress({ current: done, total });
      }

      if (parsed.length === 0) {
        toast.error(`Żadne z ${total} zdjęć nie ma współrzędnych GPS — nie zaimportowano.`);
        return;
      }

      // 2) opcjonalnie pobierz wysokości DEM i policz AGL per zdjęcie
      let terrainHeights: (number | null)[] | null = null;
      if (opts.useDem) {
        const haveAlt = parsed.filter((p) => typeof p.exif.GPSAltitude === "number").length;
        if (haveAlt === 0) {
          toast.warning("Brak GPSAltitude w EXIF — używam ręcznego AGL");
        } else {
          toast.info(`Pobieram wysokości terenu (Copernicus DEM) dla ${parsed.length} punktów…`);
          try {
            terrainHeights = await fetchTerrainHeights(
              parsed.map((p) => ({ lat: p.exif.latitude, lng: p.exif.longitude })),
              (d, tot) => setImportProgress({ current: d, total: tot }),
            );
          } catch {
            toast.error("Nie udało się pobrać DEM — używam ręcznego AGL");
            terrainHeights = null;
          }
        }
      }

      // 3) zbuduj zdjęcia (każde w try/catch, by jedno błędne nie zatrzymało importu)
      const newPhotos: PhotoPoint[] = [];
      let aglSum = 0, aglN = 0;
      for (let i = 0; i < parsed.length; i++) {
        try {
          const { file, exif } = parsed[i];
          let altitudeAGL = opts.manualAgl;
          if (terrainHeights) {
            const droneMsl = exif.GPSAltitude;
            const terr = terrainHeights[i];
            if (typeof droneMsl === "number" && typeof terr === "number") {
              const computed = droneMsl - terr;
              if (computed > 1) altitudeAGL = computed;
            }
          }
          aglSum += altitudeAGL; aglN++;

          const terrainHeight = terrainHeights?.[i] ?? null;
          const estimated = estimateSensorDimensions(exif, file.name);
          const currentSensor: SensorConfig = {
            resolutionX: estimated.resX, resolutionY: estimated.resY,
            sensorWidth: estimated.width, sensorHeight: estimated.height,
            focalLength: estimated.focal, flightAltitude: altitudeAGL,
          };
          const { groundWidth, groundHeight } = calcFootprint(currentSensor, altitudeAGL);
          const longSide = Math.max(groundWidth, groundHeight);
          const shortSide = Math.min(groundWidth, groundHeight);

          newPhotos.push({
            id: `${file.name}-${Date.now()}-${Math.random()}`,
            filename: file.name, lat: exif.latitude, lng: exif.longitude,
            altitude: exif.GPSAltitude,
            altitudeAGL,
            terrainHeight,
            timestamp: exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal) : undefined,
            footprintWidth: longSide, footprintHeight: shortSide, footprintCorners: [],
            gsd: calcGSD(currentSensor, altitudeAGL),
            sensorInfo: { sensorWidth: estimated.width, sensorHeight: estimated.height, focalLength: estimated.focal, resolutionX: estimated.resX, source: estimated.source },
            thumbnailUrl: URL.createObjectURL(file),
          });
        } catch { /* pomiń pojedyncze błędne zdjęcie */ }
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
        const avgAgl = aglN ? (aglSum / aglN) : 0;
        toast.success(
          terrainHeights
            ? `Zaimportowano ${newPhotos.length} zdjęć. Średni AGL z DEM: ${avgAgl.toFixed(1)} m`
            : `Zaimportowano ${newPhotos.length} zdjęć (AGL ${opts.manualAgl} m)`
        );
        // automatyczne dopasowanie widoku do nowych zdjęć
        const bounds = L.latLngBounds(newPhotos.map((p) => [p.lat, p.lng] as [number, number]));
        if (bounds.isValid()) window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
      }
      if (noGps > 0) toast.warning(`${noGps} zdjęć bez danych GPS — pominięto`);
    } finally {
      setImportProgress(null);
    }
  }, []);

  const handleAglConfirm = useCallback(() => {
    if (!pendingFiles) return;
    const manual = aglAltitude ?? 0;
    if (!useDemForAgl && manual <= 0) return;
    setShowAglPrompt(false);
    processImport(pendingFiles, { manualAgl: manual > 0 ? manual : 100, useDem: useDemForAgl });
    setPendingFiles(null);
  }, [pendingFiles, aglAltitude, useDemForAgl, processImport]);

  const handleImportKml = useCallback(async (file: File) => {
    try {
      const geojson = kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
      setKmlLayers((prev) => [...prev, { id: `kml-${Date.now()}`, name: file.name.replace(/\.[^/.]+$/, ""), visible: true, color: "#e11d48", weight: 2, geojson: geojson as any }]);
      toast.success(`Dodano KML: ${file.name}`);
    } catch { toast.error("Błąd KML"); }
  }, []);

  const handlePhotoSelect = useCallback((id: string | null, ctrlKey: boolean) => {
    if (!id) { setSelectedPhotoIds([]); return; }
    if (ctrlKey) { setSelectedPhotoIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id])); return; }
    setSelectedPhotoIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
  }, []);

  const handleSearchResult = useCallback((lat: number, lng: number) => {
    window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds: L.latLngBounds([[lat - 0.01, lng - 0.01], [lat + 0.01, lng + 0.01]]) } }));
  }, []);

  // Wynik wyszukiwarki działek (ULDK GUGiK) — dodaj jako warstwę wektorową i przybliż.
  const handleParcelFound = useCallback((result: { geojson: any; label: string }) => {
    const layer: KmlLayer = {
      id: `parcel-${Date.now()}`,
      name: `Działka ${result.label}`,
      visible: true,
      color: "#f59e0b",
      weight: 2,
      geojson: result.geojson,
    };
    setKmlLayers((prev) => [...prev, layer]);
    try {
      const bounds = L.geoJSON(result.geojson).getBounds();
      if (bounds.isValid()) window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
    } catch { /* ignore */ }
  }, []);

  const handleZoomToPhotos = useCallback(() => {
    if (photos.length === 0) return;
    const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng] as [number, number]));
    window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
  }, [photos]);

  const handleMeasureModeChange = useCallback((mode: MeasureMode) => {
    setMeasureMode(mode); setMeasurement(null); setMeasurementResetSignal((v) => v + 1);
    // Schowaj lewy panel podczas pomiarów, by nie zasłaniał mapy.
    if (mode !== "none") setLeftCollapsed(true);
  }, []);

  const handleClearMeasurement = useCallback(() => { setMeasurement(null); setMeasurementResetSignal((v) => v + 1); }, []);

  const handleCheckCoverage = useCallback((kmlId: string) => {
    const layer = kmlLayers.find((l) => l.id === kmlId);
    if (!layer) return;
    if (photos.length === 0) { toast.warning("Brak zdjęć do analizy pokrycia"); return; }
    const result = analyzeCoverage(layer, photos);
    setCoverageResults((prev) => ({ ...prev, [kmlId]: result }));
    setCoverageGaps(result.gaps);
    if (result.coveragePercent >= 95) toast.success(`Pokrycie: ${result.coveragePercent.toFixed(1)}%`);
    else toast.warning(`Pokrycie: ${result.coveragePercent.toFixed(1)}% — wykryto luki`);
  }, [kmlLayers, photos]);

  const handleClearCoverage = useCallback((kmlId: string) => {
    setCoverageResults((prev) => { const next = { ...prev }; delete next[kmlId]; return next; });
    setCoverageGaps([]);
  }, []);

  const handleImportVector = useCallback(async (file: File) => {
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "txt" || ext === "csv") {
        // Otwórz okno z opcjami importu TXT (układ, separator, kolumny, linia startowa)
        const text = await file.text();
        setTxtImport({ name: file.name.replace(/\.[^/.]+$/, ""), text });
        return;
      }
      if (ext === "gml") {
        const layers = await importGml(file);
        if (layers.length === 0) { toast.warning("Brak obiektów w pliku GML"); return; }
        const ts = Date.now();
        const total = layers.reduce((s, l) => s + l.geojson.features.length, 0);
        setKmlLayers((prev) => [
          ...prev,
          ...layers.map((l, i) => ({
            id: `gml-${ts}-${i}`, name: l.name, visible: true, color: l.color, weight: 2, crs: l.crs, geojson: l.geojson,
          })),
        ]);
        // dopasuj widok do zaimportowanych danych
        const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: layers.flatMap((l) => l.geojson.features) };
        const bounds = L.geoJSON(fc).getBounds();
        if (bounds.isValid()) window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
        toast.success(`Zaimportowano ${total} obiektów GML w ${layers.length} warstwach`);
        return;
      }
      let geojson: GeoJSON.FeatureCollection;
      if (ext === "dxf") geojson = await importDxf(file);
      else if (ext === "shp" || ext === "zip") geojson = await importShp(file);
      else { toast.error(`Nieobsługiwany format: .${ext}`); return; }
      if (geojson.features.length === 0) { toast.warning("Brak obiektów w pliku"); return; }
      setKmlLayers((prev) => [...prev, { id: `vec-${Date.now()}`, name: file.name.replace(/\.[^/.]+$/, ""), visible: true, color: "#6366f1", weight: 2, geojson }]);
      toast.success(`Zaimportowano ${geojson.features.length} obiektów`);
    } catch (err) { toast.error(`Błąd importu: ${(err as Error).message}`); }
  }, []);

  const handleConfirmTxtImport = useCallback((opts: TxtImportOptions) => {
    if (!txtImport) return;
    try {
      const geojson = importTxtAdvanced(txtImport.text, opts);
      if (geojson.features.length === 0) { toast.warning("Brak punktów — sprawdź separator / kolumny / linię startową"); return; }
      setKmlLayers((prev) => [...prev, { id: `vec-${Date.now()}`, name: txtImport.name, visible: true, color: "#6366f1", weight: 2, crs: opts.crs, geojson }]);
      toast.success(`Zaimportowano ${geojson.features.length} punktów (${opts.crs.toUpperCase()})`);
      setTxtImport(null);
    } catch (err) { toast.error(`Błąd importu TXT: ${(err as Error).message}`); }
  }, [txtImport]);

  // ---- Drawing layer handlers ----
  const handleCreateLayer = useCallback((opts: { name: string; type: "point" | "line" | "polygon"; crs: CoordinateSystem }): string => {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newLayer: DrawingLayer = { id, name: opts.name, type: opts.type, visible: true, color: LAYER_COLORS[opts.type], crs: opts.crs, features: [] };
    setDrawingLayers((prev) => [...prev, newLayer]);
    setActiveDrawLayerId(id);
    setDrawingPoints([]);
    return id;
  }, []);

  const handleAddFeatureToLayer = useCallback((layerId: string, coordinates: [number, number][], namePrefix: string, heights?: (number | null)[]) => {
    setDrawingLayers((prev) => prev.map((l) => l.id !== layerId ? l : {
      ...l, features: [...l.features, {
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        coordinates,
        heights,
        attrs: { name: `${namePrefix} ${l.features.length + 1}`, description: "" },
      }],
    }));
  }, []);

  const handleSetActiveDrawLayer = useCallback((id: string | null) => { setActiveDrawLayerId(id); setDrawingPoints([]); }, []);
  const handleToggleDrawLayer = useCallback((id: string) => setDrawingLayers((prev) => prev.map((l) => l.id === id ? { ...l, visible: !l.visible } : l)), []);
  const handleRemoveDrawLayer = useCallback((id: string) => {
    setDrawingLayers((prev) => prev.filter((l) => l.id !== id));
    if (activeDrawLayerId === id) setActiveDrawLayerId(null);
    if (selectedFeature?.layerId === id) setSelectedFeature(null);
    setSelectedFeatures((prev) => prev.filter((s) => s.layerId !== id));
  }, [activeDrawLayerId, selectedFeature]);
  const handleRenameDrawLayer = useCallback((id: string, name: string) => setDrawingLayers((prev) => prev.map((l) => l.id === id ? { ...l, name } : l)), []);
  const handleChangeDrawLayerColor = useCallback((id: string, color: string) => setDrawingLayers((prev) => prev.map((l) => l.id === id ? { ...l, color } : l)), []);

  // Aktualizacja typu warstwy (z automatycznym kolorem) – używane w formularzu „Dodaj obiekt”.
  const handleSetDrawLayerType = useCallback((id: string, type: "point" | "line" | "polygon") => {
    setDrawingLayers((prev) => prev.map((l) => l.id === id ? { ...l, type, color: LAYER_COLORS[type], features: [] } : l));
    setDrawingPoints([]);
  }, []);
  const handleUpdateDrawLayer = useCallback((id: string, patch: Partial<DrawingLayer>) => {
    setDrawingLayers((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  }, []);

  // Przesunięcie wierzchołka istniejącego obiektu (edycja przez przeciąganie).
  const handleMoveFeatureVertex = useCallback((layerId: string, featureId: string, index: number, lat: number, lng: number) => {
    setDrawingLayers((prev) => prev.map((l) => l.id !== layerId ? l : {
      ...l, features: l.features.map((f) => f.id !== featureId ? f : {
        ...f, coordinates: f.coordinates.map((c, i) => i === index ? [lat, lng] as [number, number] : c),
      }),
    }));
  }, []);

  const finalizeDrawingNow = useCallback(() => {
    const layer = activeDrawLayer;
    if (!layer) return;
    setDrawingPoints((points) => {
      const cleaned: [number, number][] = [];
      for (const p of points) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) cleaned.push(p);
      }
      const minPts = layer.type === "line" ? 2 : 3;
      if (cleaned.length < minPts) return [];
      // Topologia poligonu: krawędź zamykająca nie może przecinać pozostałych.
      if (layer.type === "polygon" && cleaned.length >= 4) {
        const first = cleaned[0], last = cleaned[cleaned.length - 1];
        for (let i = 1; i < cleaned.length - 2; i++) {
          if (segmentsIntersect(last, first, cleaned[i], cleaned[i + 1])) {
            toast.warning("Poligon samoprzecinający się — popraw wierzchołki");
            return points;
          }
        }
      }
      const baseName = layer.type === "line" ? "Linia" : "Poligon";
      setDrawingLayers((prev) => prev.map((l) => l.id !== layer.id ? l : {
        ...l, features: [...l.features, {
          id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          coordinates: cleaned,
          attrs: { name: `${baseName} ${l.features.length + 1}`, description: "" },
        }],
      }));
      return [];
    });
  }, [activeDrawLayer]);

  const handleMapClickForDrawing = useCallback((lat: number, lng: number) => {
    if (!activeDrawLayer) return;
    if (activeDrawLayer.type === "point") {
      setDrawingLayers((prev) => prev.map((l) => l.id !== activeDrawLayer.id ? l : {
        ...l, features: [...l.features, { id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, coordinates: [[lat, lng]], attrs: { name: `Punkt ${l.features.length + 1}`, description: "" } }],
      }));
    } else {
      setDrawingPoints((prev) => {
        const newPt: [number, number] = [lat, lng];
        // Domknięcie poligonu przez klik w pierwszy wierzchołek.
        if (activeDrawLayer.type === "polygon" && prev.length >= 3) {
          const [flat, flng] = prev[0];
          const dLat = (flat - lat) * 111000;
          const dLng = (flng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
          if (Math.sqrt(dLat * dLat + dLng * dLng) < 8) {
            setTimeout(() => finalizeDrawingNow(), 0);
            return prev;
          }
        }
        // Topologia: bez powielonych wierzchołków.
        if (prev.some((q) => samePoint(q, newPt))) {
          toast.warning("Ten wierzchołek już istnieje");
          return prev;
        }
        // Topologia: nowa krawędź nie może przecinać wcześniejszych (brak samoprzecięć).
        if (prev.length >= 2) {
          const last = prev[prev.length - 1];
          for (let i = 0; i < prev.length - 2; i++) {
            if (segmentsIntersect(last, newPt, prev[i], prev[i + 1])) {
              toast.warning("Krawędź nie może przecinać obiektu");
              return prev;
            }
          }
        }
        return [...prev, newPt];
      });
    }
  }, [activeDrawLayer, finalizeDrawingNow]);

  const handleMapDblClickForDrawing = useCallback(() => {
    if (!activeDrawLayer || activeDrawLayer.type === "point") return;
    finalizeDrawingNow();
  }, [activeDrawLayer, finalizeDrawingNow]);

  const handleMapClickInfo = useCallback((lat: number, lng: number, system?: CoordinateSystem) => {
    setClickedCoords({ lat, lng });
    // Gdy kliknięto zaimportowany obiekt – pokaż współrzędne w jego układzie.
    if (system) setCoordSystem(system);
    const photoAtPoint = photos.find((photo) => calcDistance(lat, lng, photo.lat, photo.lng) <= 1);
    setClickedPhotoAltitude(photoAtPoint?.altitude ?? null);
    setClickedTerrainHeight({ loading: true, value: null });
    setWmsPixelInfo(null);
    if (!selectMode) handleMapClickForDrawing(lat, lng);

    const requestId = ++terrainClickRequestRef.current;
    fetchTerrainHeight(lat, lng)
      .then((value) => {
        if (terrainClickRequestRef.current === requestId) setClickedTerrainHeight({ loading: false, value });
      })
      .catch(() => {
        if (terrainClickRequestRef.current === requestId) setClickedTerrainHeight({ loading: false, value: null });
      });
  }, [handleMapClickForDrawing, photos, selectMode]);

  // ESC: finalize in-progress drawing and deactivate layer (exit drawing mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawingPoints.length > 0) finalizeDrawingNow();
      if (activeDrawLayerId) setActiveDrawLayerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeDrawLayerId, drawingPoints.length, finalizeDrawingNow]);

  const handleLoadWmsLayers = useCallback(async () => {
    if (!wmsUrl) return;
    setWmsLoading(true);
    try {
      const u = wmsUrl + (wmsUrl.includes("?") ? "&" : "?") + "SERVICE=WMS&REQUEST=GetCapabilities";
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const names = Array.from(doc.getElementsByTagName("Layer"))
        .map((n) => n.getElementsByTagName("Name")[0]?.textContent ?? "")
        .filter(Boolean);
      const unique = Array.from(new Set(names));
      if (unique.length === 0) { toast.warning("Brak warstw w GetCapabilities"); return; }
      setWmsLayers(unique);
      setWmsSelectedLayer((prev) => prev && unique.includes(prev) ? prev : unique[0]);
      toast.success(`Pobrano ${unique.length} warstw WMS`);
    } catch (err) {
      toast.error(`Błąd WMS: ${(err as Error).message} (CORS?)`);
    } finally {
      setWmsLoading(false);
    }
  }, [wmsUrl]);

  const handleSelectFeature = useCallback((layerId: string, featureId: string) => setSelectedFeature({ layerId, featureId }), []);
  const handleUpdateFeatureAttrs = useCallback((layerId: string, featureId: string, attrs: { name: string; description: string }) => {
    setDrawingLayers((prev) => prev.map((l) => l.id !== layerId ? l : {
      ...l, features: l.features.map((f) => f.id === featureId ? { ...f, attrs } : f),
    }));
  }, []);
  const handleDeleteFeature = useCallback((layerId: string, featureId: string) => {
    setDrawingLayers((prev) => prev.map((l) => l.id !== layerId ? l : { ...l, features: l.features.filter((f) => f.id !== featureId) }));
    setSelectedFeature(null);
  }, []);

  const layerToGeoJson = useCallback((layer: DrawingLayer, epsg: CoordinateSystem = "wgs84", onlyFeatureIds?: string[]): GeoJSON.FeatureCollection => {
    const project = (lat: number, lng: number) => projectCoords(lat, lng, epsg);
    const feats = onlyFeatureIds ? layer.features.filter((f) => onlyFeatureIds.includes(f.id)) : layer.features;
    return {
      type: "FeatureCollection",
      features: feats.map((f) => {
        const props = { name: f.attrs.name, description: f.attrs.description };
        const withH = (xy: [number, number], i: number): number[] => {
          const h = f.heights?.[i];
          return typeof h === "number" ? [xy[0], xy[1], h] : [xy[0], xy[1]];
        };
        if (layer.type === "point") {
          return { type: "Feature" as const, properties: props, geometry: { type: "Point" as const, coordinates: withH(project(f.coordinates[0][0], f.coordinates[0][1]), 0) } };
        }
        if (layer.type === "line") {
          return { type: "Feature" as const, properties: props, geometry: { type: "LineString" as const, coordinates: f.coordinates.map(([lat, lng], i) => withH(project(lat, lng), i)) } };
        }
        const ring = f.coordinates.map(([lat, lng], i) => withH(project(lat, lng), i));
        ring.push(ring[0]);
        return { type: "Feature" as const, properties: props, geometry: { type: "Polygon" as const, coordinates: [ring] } };
      }),
    };
  }, []);

  const exportSingleLayer = useCallback((layer: DrawingLayer, format: "kml" | "dxf" | "geojson" | "txt", epsg: CoordinateSystem, onlyFeatureIds?: string[]) => {
    // KML musi być w WGS84 (specyfikacja OGC). Wymuś.
    const useEpsg: CoordinateSystem = format === "kml" ? "wgs84" : epsg;
    const geojson = layerToGeoJson(layer, useEpsg, onlyFeatureIds);
    if (geojson.features.length === 0) { toast.warning(`${layer.name}: brak obiektów do eksportu`); return; }
    const suffix = onlyFeatureIds ? "_zazn" : "";
    const name = layer.name.replace(/\s+/g, "_") + suffix;
    if (format === "kml") {
      const featuresKml = geojson.features.map((f) => {
        const coords = (f.geometry as any).coordinates;
        const fname = f.properties?.name || "";
        const desc = f.properties?.description ? `<description>${f.properties.description}</description>` : "";
        if (f.geometry.type === "Point") return `<Placemark><name>${fname}</name>${desc}<Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`;
        if (f.geometry.type === "LineString") { const c = coords.map((p: number[]) => `${p[0]},${p[1]},0`).join(" "); return `<Placemark><name>${fname}</name>${desc}<LineString><coordinates>${c}</coordinates></LineString></Placemark>`; }
        if (f.geometry.type === "Polygon") { const c = coords[0].map((p: number[]) => `${p[0]},${p[1]},0`).join(" "); return `<Placemark><name>${fname}</name>${desc}<Polygon><outerBoundaryIs><LinearRing><coordinates>${c}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`; }
        return "";
      }).join("\n");
      const kmlStr = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name>\n${featuresKml}\n</Document></kml>`;
      const blob = new Blob([kmlStr], { type: "application/vnd.google-earth.kml+xml" });
      saveBlob(blob, `${name}.kml`);
    } else if (format === "dxf") exportDxf(geojson, name);
    else if (format === "geojson") exportGeoJson(geojson, name);
    else {
      // dla strefy PUWG 2000 ustal reprezentatywną długość z pierwszego obiektu
      const lng0 = layer.features[0]?.coordinates[0]?.[1];
      exportTxtFile(geojson, name, { precision: exportPrecision(useEpsg), system: useEpsg, lngForPrj: lng0 });
    }
  }, [layerToGeoJson]);

  const handleExportLayers = useCallback((layerIds: string[], format: "kml" | "dxf" | "geojson" | "txt", epsg: CoordinateSystem, scope: "all" | "selected") => {
    let exported = 0;
    layerIds.forEach((id) => {
      const layer = drawingLayers.find((l) => l.id === id);
      if (!layer || layer.features.length === 0) return;
      let onlyIds: string[] | undefined;
      if (scope === "selected") {
        onlyIds = selectedFeatures.filter((s) => s.layerId === id).map((s) => s.featureId);
        if (onlyIds.length === 0) { toast.warning(`${layer.name}: brak zaznaczonych obiektów`); return; }
      }
      exportSingleLayer(layer, format, epsg, onlyIds);
      exported++;
    });
    if (exported > 0) toast.success(`Wyeksportowano ${exported} warstw(y) (${epsg.toUpperCase()})`);
  }, [drawingLayers, selectedFeatures, exportSingleLayer]);

  const selectedFeatureData = useMemo(() => {
    if (!selectedFeature) return null;
    const layer = drawingLayers.find((l) => l.id === selectedFeature.layerId);
    const feature = layer?.features.find((f) => f.id === selectedFeature.featureId);
    if (!layer || !feature) return null;
    return { layer, feature };
  }, [selectedFeature, drawingLayers]);

  // ---- JOBS handlers ----
  const handleMapMove = useCallback((lat: number, lng: number, zoom: number) => {
    mapViewRef.current = { lat, lng, zoom };
  }, []);

  const handleCreateJob = useCallback((name: string, crs: CoordinateSystem) => {
    const center = mapViewRef.current ?? undefined;
    const job = createJob(name, crs, center);
    setJobs((prev) => [...prev, job]);
    setActiveJobId(job.id);
    setCoordSystem(crs);
    toast.success(`Utworzono pracę „${job.name}” (${crs.toUpperCase()})`);
  }, []);

  const handleSelectJob = useCallback((id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    setActiveJobId(id);
    setCoordSystem(job.crs);
    setDrawingLayers(job.data.drawingLayers ?? []);
    setKmlLayers(job.data.kmlLayers ?? []);
    setActiveDrawLayerId(null);
    setSelectedFeature(null);
    setSelectedFeatures([]);
    if (job.center) {
      window.dispatchEvent(new CustomEvent("set-map-view", { detail: job.center }));
    }
    toast.success(`Wczytano pracę „${job.name}”`);
  }, [jobs]);

  const handleSaveActiveJob = useCallback(() => {
    if (!activeJobId) return;
    const center = mapViewRef.current ?? undefined;
    setJobs((prev) => prev.map((j) => j.id !== activeJobId ? j : {
      ...j, updatedAt: Date.now(), center: center ?? j.center,
      data: { drawingLayers, kmlLayers },
    }));
    toast.success("Zapisano pracę");
  }, [activeJobId, drawingLayers, kmlLayers]);

  const handleDeleteJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setActiveJobId((cur) => (cur === id ? null : cur));
    toast.success("Usunięto pracę");
  }, []);

  const handleExportJob = useCallback((id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    // Zapisz aktualny stan, jeśli to aktywna praca.
    const toExport = id === activeJobId
      ? { ...job, center: mapViewRef.current ?? job.center, data: { drawingLayers, kmlLayers } }
      : job;
    exportJobToFile(toExport);
  }, [jobs, activeJobId, drawingLayers, kmlLayers]);

  const handleExportAllJobs = useCallback(() => {
    const all = activeJobId
      ? jobs.map((j) => j.id === activeJobId ? { ...j, center: mapViewRef.current ?? j.center, data: { drawingLayers, kmlLayers } } : j)
      : jobs;
    if (all.length === 0) { toast.warning("Brak prac do eksportu"); return; }
    exportAllJobsToFile(all);
  }, [jobs, activeJobId, drawingLayers, kmlLayers]);

  const handleImportJobs = useCallback(async (file: File) => {
    try {
      const imported = parseJobsFile(await file.text());
      if (imported.length === 0) { toast.warning("Brak prac w pliku"); return; }
      setJobs((prev) => {
        const ids = new Set(prev.map((j) => j.id));
        const merged = [...prev];
        for (const j of imported) {
          if (ids.has(j.id)) j.id = `${j.id}-imp${Math.random().toString(36).slice(2, 5)}`;
          merged.push(j);
        }
        return merged;
      });
      toast.success(`Zaimportowano ${imported.length} prac(e)`);
    } catch (e) {
      toast.error(`Błąd importu prac: ${(e as Error).message}`);
    }
  }, []);



  return (
    <div
      className="relative flex h-screen w-screen overflow-hidden bg-background"
      onDrop={(event) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        if (!files.length) return;
        const name = files[0].name.toLowerCase();
        if (name.match(/\.(kml|kmz)$/)) handleImportKml(files[0]);
        else if (name.match(/\.(dxf|shp|zip|txt|csv|gml)$/)) handleImportVector(files[0]);
        else startImport(files);
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      {isSidebarOpen && (
        <div className="fixed inset-0 z-[1100] bg-black/40 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      <div className={`fixed left-2 top-2 z-[1200] h-auto max-h-[calc(100dvh-1rem)] w-80 overflow-hidden rounded-xl border bg-background shadow-2xl transition-transform duration-300 md:absolute md:left-2 md:top-2 md:z-[1150] md:max-h-[calc(100vh-1rem)] md:shadow-xl ${isSidebarOpen ? "translate-x-0" : "-translate-x-[120%] md:translate-x-0"} ${leftCollapsed ? "md:-translate-x-[120%]" : "md:translate-x-0"}`}>
        <Sidebar
          onCollapse={() => setLeftCollapsed(true)}
          photos={photos}
          kmlLayers={kmlLayers}
          sensor={sensor}
          showFootprints={showFootprints}
          footprintStyle={footprintStyle}
          showOverlapHeatmap={showOverlapHeatmap}
          baseLayer={baseLayer}
          wmsUrl={wmsUrl}
          wmsLayers={wmsLayers}
          wmsSelectedLayer={wmsSelectedLayer}
          wmsLoading={wmsLoading}
          onWmsUrlChange={setWmsUrl}
          onWmsLoadLayers={handleLoadWmsLayers}
          onWmsLayerChange={setWmsSelectedLayer}
          overlapStats={overlapStats}
          selectedPhotoCount={selectedPhotoIds.length}
          selectedOverlapStats={selectedOverlapStats}
          measureMode={measureMode}
          measurement={measurement}
          onImportPhotos={startImport}
          onImportKml={handleImportKml}
          onImportVector={handleImportVector}
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
            if (bounds.isValid()) window.dispatchEvent(new CustomEvent("zoom-to-bounds", { detail: { bounds } }));
          }}
          onSensorChange={setSensor}
          onClearPhotos={() => { setPhotos([]); setSelectedPhotoIds([]); setMeasurement(null); setMeasurementResetSignal((v) => v + 1); }}
          onZoomToPhotos={handleZoomToPhotos}
          onSearchResult={handleSearchResult}
          onParcelFound={handleParcelFound}
          onMeasureModeChange={handleMeasureModeChange}
          onClearMeasurement={handleClearMeasurement}
          onCheckCoverage={handleCheckCoverage}
          onClearCoverage={handleClearCoverage}
          coverageResults={coverageResults}
          selectedFeatures={selectedFeatures}
        />
      </div>

      {/* Przycisk ponownego otwarcia lewego panelu (desktop), gdy jest schowany */}
      {leftCollapsed && (
        <button
          onClick={() => setLeftCollapsed(false)}
          title="Pokaż panel"
          className="absolute left-4 top-4 z-[1150] hidden rounded-lg border bg-card p-2.5 text-foreground shadow-lg md:block"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      <div className="relative flex-1 w-full">
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="absolute left-4 top-4 z-[1300] rounded-lg border bg-card p-3 text-foreground shadow-lg md:hidden">
          {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        {/* Przełącznik panelu narzędzi (mobile) */}
        <button onClick={() => setIsToolsOpen(!isToolsOpen)} className="absolute right-4 top-4 z-[1300] rounded-lg border bg-card p-3 text-foreground shadow-lg md:hidden">
          <PanelRight className="h-6 w-6" />
        </button>

        {/* Narzędzie zaznaczania (strzałka / fence) */}
        <button
          onClick={() => setSelectMode((v) => !v)}
          title={selectMode ? "Tryb zaznaczania: WŁĄCZONY (klik = obiekt, przeciągnij = ogrodzenie)" : "Zaznaczanie obiektów (strzałka / ogrodzenie)"}
          className={`absolute right-4 top-20 z-[1100] rounded-lg border p-2.5 shadow-lg transition-colors ${selectMode ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
        >
          <MousePointer2 className="h-5 w-5" />
        </button>
        {selectMode && selectedFeatures.length > 0 && (
          <div className="absolute right-16 top-20 z-[1100] flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
            <span className="font-medium text-foreground">{selectedFeatures.length} zazn.</span>
            <button onClick={handleDeleteSelectedFeatures} title="Usuń zaznaczone obiekty"
              className="flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-destructive-foreground hover:opacity-90">
              <Trash2 className="h-3 w-3" /> Usuń
            </button>
            <button onClick={handleClearSelection} title="Wyczyść zaznaczenie" className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
        )}

        {/* Sterowanie rysowaniem na mapie (widoczne zwłaszcza na telefonie) */}
        {activeDrawLayerId && (
          <div className="absolute bottom-40 right-4 z-[1300] flex flex-col items-end gap-2 md:hidden">
            {drawMode !== "point" && drawingPoints.length > 0 && (
              <Button size="sm" className="shadow-lg" onClick={finalizeDrawingNow}
                disabled={drawingPoints.length < (drawMode === "line" ? 2 : 3)}>
                Zakończ obiekt ({drawingPoints.length})
              </Button>
            )}
            <Button size="sm" variant="secondary" className="shadow-lg" onClick={() => { finalizeDrawingNow(); setActiveDrawLayerId(null); }}>
              Zakończ dodawanie
            </Button>
          </div>
        )}



        {importProgress && (
          <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 w-72 rounded-lg border bg-card p-3 shadow-lg">
            <p className="text-xs text-muted-foreground mb-2">Przetwarzanie zdjęć: {importProgress.current}/{importProgress.total}</p>
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
          wmsUrl={wmsUrl}
          wmsLayer={wmsSelectedLayer}
          selectedPhotoIds={selectedPhotoIds}
          onPhotoSelect={handlePhotoSelect}
          measureMode={measureMode}
          measurementResetSignal={measurementResetSignal}
          onMeasurementChange={setMeasurement}
          onMapClick={handleMapClickInfo}
          onMapDblClick={handleMapDblClickForDrawing}
          onMapMove={handleMapMove}
          coverageGaps={coverageGaps}
          drawingLayers={drawingLayers}
          drawingPoints={drawingPoints}
          drawMode={drawMode}
          selectedFeatureId={selectedFeature?.featureId ?? null}
          onFeatureClick={handleSelectFeature}
          onMoveFeatureVertex={handleMoveFeatureVertex}
          onWmsPixelInfo={(layer, info) => setWmsPixelInfo({ layer, info })}
          selectMode={selectMode}
          selectedFeatureRefs={selectedFeatureRefs}
          onToggleSelectFeature={handleToggleSelectFeature}
          onFenceSelect={handleFenceSelect}
          onClearSelection={handleClearSelection}
        />

        <MapControls
          measureMode={measureMode}
          measurement={measurement}
          onMeasureModeChange={handleMeasureModeChange}
          onClearMeasurement={handleClearMeasurement}
          baseLayer={baseLayer}
          onBaseLayerChange={setBaseLayer}
          wmsUrl={wmsUrl}
          wmsLayers={wmsLayers}
          wmsSelectedLayer={wmsSelectedLayer}
          wmsLoading={wmsLoading}
          onWmsUrlChange={setWmsUrl}
          onWmsLoadLayers={handleLoadWmsLayers}
          onWmsLayerChange={setWmsSelectedLayer}
        />


        {showAglPrompt && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/50">
            <div className="rounded-lg border bg-card p-6 shadow-xl w-96 space-y-4">
              <h3 className="text-sm font-bold text-foreground">Wysokość lotu AGL</h3>

              <div className="flex items-center justify-between rounded-md border p-2">
                <div className="space-y-0.5">
                  <Label htmlFor="use-dem" className="text-xs font-semibold">Wylicz AGL z DEM (Copernicus 30 m)</Label>
                  <p className="text-[10px] text-muted-foreground leading-tight">AGL = GPSAltitude − wysokość terenu z modelu.</p>
                </div>
                <Switch id="use-dem" checked={useDemForAgl} onCheckedChange={setUseDemForAgl} />
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {useDemForAgl ? "Ręczny AGL — fallback, gdy DEM/GPS niedostępne." : "Wysokość nad terenem w metrach."}
                </p>
                <Input type="number" step="0.1" min="1" placeholder="np. 100" value={aglAltitude ?? ""}
                  onChange={(e) => setAglAltitude(parseFloat(e.target.value) || null)} autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAglConfirm()} />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleAglConfirm}
                  disabled={!useDemForAgl && (!aglAltitude || aglAltitude <= 0)}>Importuj</Button>
                <Button variant="outline" onClick={() => { setShowAglPrompt(false); setPendingFiles(null); }}>Anuluj</Button>
              </div>
            </div>
          </div>
        )}

        {txtImport && (
          <TxtImportDialog
            name={txtImport.name}
            text={txtImport.text}
            onConfirm={handleConfirmTxtImport}
            onCancel={() => setTxtImport(null)}
          />
        )}



        {/* Coordinates panel (przeciągalne, zmniejszone) */}
        {clickedCoords && (() => {
          const coords = formatCoordinates(clickedCoords.lat, clickedCoords.lng, coordSystem);
          return (
            <div
              data-coord-panel
              className={`z-[1600] w-[168px] rounded-lg border bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur text-[10px] text-foreground ${coordPos ? "fixed" : "absolute bottom-24 left-4 md:bottom-4"}`}
              style={coordPos ? { left: coordPos.x, top: coordPos.y } : undefined}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1 mb-1">
                <button
                  onPointerDown={startCoordDrag}
                  title="Przeciągnij okno"
                  className="cursor-move touch-none text-muted-foreground hover:text-foreground"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                <Select value={coordSystem} onValueChange={(v) => setCoordSystem(v as CoordinateSystem)}>
                  <SelectTrigger className="h-5 flex-1 text-[10px] border-muted px-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[2000]">
                    {COORDINATE_SYSTEMS.map((cs) => (<SelectItem key={cs.value} value={cs.value} className="text-xs">{cs.label}</SelectItem>))}
                  </SelectContent>
                </Select>
                <button onClick={() => setClickedCoords(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div className="font-mono leading-snug">
                <div>{coords.line1}</div>
                <div>{coords.line2}</div>
                {clickedPhotoAltitude !== null && (
                  <div className="mt-1 pt-1 border-t text-[10px] text-primary">
                    Wys. GPS: {clickedPhotoAltitude.toFixed(1)} m
                  </div>
                )}
                {clickedTerrainHeight && (
                  <div className="mt-1 pt-1 border-t text-[10px] text-muted-foreground">
                    Teren DEM: {clickedTerrainHeight.loading ? "…" : clickedTerrainHeight.value !== null ? `${clickedTerrainHeight.value.toFixed(1)} m` : "brak"}
                  </div>
                )}
                {wmsPixelInfo && (
                  <div className="mt-1 pt-1 border-t text-[10px] text-primary break-all">
                    <span className="text-muted-foreground">{wmsPixelInfo.layer}:</span> {wmsPixelInfo.info}
                  </div>
                )}
              </div>
            </div>
          );
        })()}


        {/* Attributes panel for selected drawn feature */}
        {selectedFeatureData && (
          <div className="absolute left-2 right-2 bottom-2 z-[1400] max-h-[55vh] overflow-y-auto rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur text-xs md:left-auto md:right-4 md:top-4 md:bottom-auto md:w-72">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-foreground">Atrybuty obiektu</h3>
              <button onClick={() => setSelectedFeature(null)} title="Zamknij"
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-md text-base text-muted-foreground hover:bg-muted hover:text-foreground">✕</button>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">Warstwa: {selectedFeatureData.layer.name} · {selectedFeatureData.layer.type}</p>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5">Nazwa</label>
                <Input className="h-7 text-xs" value={selectedFeatureData.feature.attrs.name}
                  onChange={(e) => handleUpdateFeatureAttrs(selectedFeatureData.layer.id, selectedFeatureData.feature.id, { ...selectedFeatureData.feature.attrs, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5">Opis</label>
                <Textarea className="text-xs min-h-[60px]" value={selectedFeatureData.feature.attrs.description}
                  onChange={(e) => handleUpdateFeatureAttrs(selectedFeatureData.layer.id, selectedFeatureData.feature.id, { ...selectedFeatureData.feature.attrs, description: e.target.value })} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">
                  Współrzędne ({selectedFeatureData.feature.coordinates.length} pkt.) · {formatCoordinates(0, 0, coordSystem).label}
                </p>
                <div className="max-h-32 overflow-y-auto rounded border bg-background p-1 font-mono text-[10px] leading-tight">
                  {selectedFeatureData.feature.coordinates.map(([lat, lng], i) => {
                    if (coordSystem === "wgs84") {
                      return <div key={i}>{i + 1}: {lat.toFixed(7)}, {lng.toFixed(7)}</div>;
                    }
                    const [E, N] = projectCoords(lat, lng, coordSystem);
                    const p = exportPrecision(coordSystem);
                    return <div key={i}>{i + 1}: X {N.toFixed(p)}, Y {E.toFixed(p)}</div>;
                  })}
                </div>
              </div>

              <Button variant="destructive" size="sm" className="w-full text-xs h-7"
                onClick={() => handleDeleteFeature(selectedFeatureData.layer.id, selectedFeatureData.feature.id)}>
                Usuń obiekt
              </Button>
            </div>
          </div>
        )}

        {!photos.length && !kmlLayers.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="mx-4 max-w-md rounded-lg border bg-card/90 p-8 text-center shadow-lg backdrop-blur">
              <Camera className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">Przeciągnij zdjęcia lub pliki KML</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Prawy panel narzędzi (Rysowanie / GPS / Eksport) ── */}
      {isToolsOpen && (
        <div className="fixed inset-0 z-[1100] bg-black/40 md:hidden" onClick={() => setIsToolsOpen(false)} />
      )}
      <div className={`fixed left-[30%] right-0 bottom-0 z-[1200] max-h-[75dvh] overflow-y-auto rounded-tl-2xl bg-background shadow-2xl transition-transform duration-300 md:relative md:inset-auto md:left-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-72 md:translate-y-0 md:overflow-visible md:rounded-none md:shadow-none md:z-auto ${isToolsOpen ? "translate-y-0" : "translate-y-full md:translate-y-0"}`}>
        <ToolsPanel
          drawingLayers={drawingLayers}
          activeDrawLayerId={activeDrawLayerId}
          drawMode={drawMode}
          drawingInProgressCount={drawingPoints.length}
          selectedFeature={selectedFeature}
          selectedFeatures={selectedFeatures}
          onCreateLayer={handleCreateLayer}
          onSetActiveDrawLayer={handleSetActiveDrawLayer}
          onToggleDrawLayer={handleToggleDrawLayer}
          onRemoveDrawLayer={handleRemoveDrawLayer}
          onRenameDrawLayer={handleRenameDrawLayer}
          onChangeDrawLayerColor={handleChangeDrawLayerColor}
          onSelectFeature={handleSelectFeature}
          onFinishDrawing={finalizeDrawingNow}
          onAddFeatureToLayer={handleAddFeatureToLayer}
          onExportLayers={handleExportLayers}
          defaultCrs={defaultCrs}
          jobs={jobs}
          activeJobId={activeJobId}
          onCreateJob={handleCreateJob}
          onSelectJob={handleSelectJob}
          onSaveActiveJob={handleSaveActiveJob}
          onDeleteJob={handleDeleteJob}
          onExportJob={handleExportJob}
          onExportAllJobs={handleExportAllJobs}
          onImportJobs={handleImportJobs}
        />
      </div>
    </div>
  );
};

export default Index;
