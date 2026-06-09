import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, PhotoPoint } from "@/types/photo";
import { findOverlappingPhotos } from "@/lib/photoUtils";
import { calcPolygonArea, calcPolylineDistance, createPhotoSnapTargets, findNearestSnapTarget } from "@/lib/measurementUtils";
import { CoverageResult } from "@/lib/coverageUtils";
import { DrawingLayer, DrawMode } from "@/types/drawing";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface MapViewProps {
  photos: PhotoPoint[];
  kmlLayers: KmlLayer[];
  showFootprints: boolean;
  footprintStyle: FootprintStyle;
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google" | "wms";
  wmsUrl?: string;
  wmsLayer?: string | null;
  selectedPhotoIds?: string[];
  onPhotoSelect?: (id: string | null, ctrlKey: boolean) => void;
  measureMode: MeasureMode;
  measurementResetSignal: number;
  onMeasurementChange?: (summary: MeasurementSummary | null) => void;
  onMapClick?: (lat: number, lng: number, system?: "wgs84" | "puwg1992" | "puwg2000") => void;
  onMapDblClick?: () => void;
  onMapMove?: (lat: number, lng: number, zoom: number) => void;
  coverageGaps?: CoverageResult["gaps"];
  drawingLayers?: DrawingLayer[];
  drawingPoints?: [number, number][];
  drawMode?: DrawMode;
  selectedFeatureId?: string | null;
  onFeatureClick?: (layerId: string, featureId: string) => void;
  onWmsPixelInfo?: (layerName: string, info: string) => void;
  selectMode?: boolean;
  selectedFeatureRefs?: string[];
  onToggleSelectFeature?: (layerId: string, featureId: string) => void;
  onFenceSelect?: (refs: { layerId: string; featureId: string }[]) => void;
  onClearSelection?: () => void;
}

const getThemeColor = (token: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value ? `hsl(${value})` : fallback;
};

const MapView = ({
  photos,
  kmlLayers,
  showFootprints,
  footprintStyle,
  showOverlapHeatmap,
  baseLayer,
  wmsUrl,
  wmsLayer,
  selectedPhotoIds = [],
  onPhotoSelect,
  measureMode,
  measurementResetSignal,
  onMeasurementChange,
  onMapClick,
  onMapDblClick,
  onMapMove,
  coverageGaps = [],
  drawingLayers = [],
  drawingPoints = [],
  drawMode = "none",
  selectedFeatureId = null,
  onFeatureClick,
  onWmsPixelInfo,
  selectMode = false,
  selectedFeatureRefs = [],
  onToggleSelectFeature,
  onFenceSelect,
  onClearSelection,
}: MapViewProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.LayerGroup[]>([]);
  const fitDoneRef = useRef(false);
  const measurementLayerRef = useRef<L.LayerGroup | null>(null);
  const measurementPointsRef = useRef<[number, number][]>([]);
  const measureModeRef = useRef<MeasureMode>(measureMode);
  const onMapClickRef = useRef(onMapClick);
  const onMapDblClickRef = useRef(onMapDblClick);
  const onMapMoveRef = useRef(onMapMove);
  const snapTargetsRef = useRef(createPhotoSnapTargets(photos));
  const drawingLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef(baseLayer);
  const wmsUrlRef = useRef(wmsUrl);
  const wmsLayerNameRef = useRef(wmsLayer);
  const onWmsPixelInfoRef = useRef(onWmsPixelInfo);
  const selectModeRef = useRef(selectMode);
  const onToggleSelectFeatureRef = useRef(onToggleSelectFeature);
  const onFenceSelectRef = useRef(onFenceSelect);
  const onClearSelectionRef = useRef(onClearSelection);
  const drawingLayersRef = useRef(drawingLayers);
  const kmlLayersRef = useRef(kmlLayers);

  // Zbiera wszystkie pary [lat,lng] z dowolnej geometrii GeoJSON.
  const geomLatLngs = (geom: any): [number, number][] => {
    const out: [number, number][] = [];
    const walk = (c: any) => {
      if (Array.isArray(c) && typeof c[0] === "number") out.push([c[1], c[0]]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    if (geom?.coordinates) walk(geom.coordinates);
    return out;
  };

  const redrawMeasurement = () => {
    const layer = measurementLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const points = measurementPointsRef.current.map(([lat, lng]) => ({ lat, lng }));
    if (points.length === 0) {
      onMeasurementChange?.(null);
      return;
    }

    const primary = getThemeColor("--primary", "hsl(222.2 47.4% 11.2%)");
    const ring = getThemeColor("--ring", "hsl(217.2 91.2% 59.8%)");

    points.forEach((point, index) => {
      L.circleMarker([point.lat, point.lng], {
        radius: 5, color: primary, fillColor: ring, fillOpacity: 1, weight: 2,
      })
        .bindTooltip(`${index + 1}`, { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(layer);
    });

    const measurement: MeasurementSummary = {
      distanceMeters: calcPolylineDistance(points),
      areaSquareMeters: measureModeRef.current === "area" ? calcPolygonArea(points) : 0,
      pointCount: points.length,
    };

    if (points.length >= 2) {
      L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), {
        color: primary, weight: 3,
        dashArray: measureModeRef.current === "area" ? "6 4" : undefined,
      }).addTo(layer);
    }

    if (measureModeRef.current === "area" && points.length >= 3) {
      L.polygon(points.map((p) => [p.lat, p.lng] as [number, number]), {
        color: primary, fillColor: ring, fillOpacity: 0.18, weight: 2,
      }).addTo(layer);
    }

    onMeasurementChange?.(measurement);
  };

  const resetMeasurement = () => {
    measurementPointsRef.current = [];
    redrawMeasurement();
  };

  const addMeasurementPoint = (lat: number, lng: number) => {
    if (measureModeRef.current === "none") return false;
    const snapped = findNearestSnapTarget({ lat, lng }, snapTargetsRef.current, 16);
    const nextPoint: [number, number] = snapped ? [snapped.lat, snapped.lng] : [lat, lng];
    const prev = measurementPointsRef.current[measurementPointsRef.current.length - 1];
    if (prev && prev[0] === nextPoint[0] && prev[1] === nextPoint[1]) return true;

    if (measureModeRef.current === "distance" && measurementPointsRef.current.length >= 2) {
      measurementPointsRef.current = [];
    }

    measurementPointsRef.current = [...measurementPointsRef.current, nextPoint];
    redrawMeasurement();
    return true;
  };

  const fetchWmsInfo = async (event: L.LeafletMouseEvent) => {
    const map = mapRef.current;
    const url = wmsUrlRef.current;
    const layerName = wmsLayerNameRef.current;
    if (!map || !url || !layerName) return;
    const size = map.getSize();
    const bounds = map.getBounds();
    const point = map.latLngToContainerPoint(event.latlng);
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetFeatureInfo",
      LAYERS: layerName,
      QUERY_LAYERS: layerName,
      BBOX: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
      WIDTH: String(size.x),
      HEIGHT: String(size.y),
      SRS: "EPSG:4326",
      X: String(Math.round(point.x)),
      Y: String(Math.round(point.y)),
      INFO_FORMAT: "application/json",
      FEATURE_COUNT: "1",
    });
    try {
      const reqUrl = url + (url.includes("?") ? "&" : "?") + params.toString();
      const res = await fetch(reqUrl);
      const text = await res.text();
      let value = "";
      try {
        const json = JSON.parse(text);
        const props = json.features?.[0]?.properties;
        if (props && Object.keys(props).length) {
          value = Object.entries(props).map(([k, v]) => `${k}=${typeof v === "number" ? (v as number).toFixed(3) : v}`).join(", ");
        }
      } catch {
        value = text.replace(/<[^>]+>/g, " ").trim().slice(0, 200);
      }
      onWmsPixelInfoRef.current?.(layerName, value || "brak danych");
    } catch {
      onWmsPixelInfoRef.current?.(layerName, "błąd (CORS?)");
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: false, doubleClickZoom: false }).setView([52.0, 19.0], 6);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.scale({ position: "bottomright", metric: true, imperial: false, maxWidth: 160 }).addTo(map);
    mapRef.current = map;
    measurementLayerRef.current = L.layerGroup().addTo(map);
    drawingLayerRef.current = L.layerGroup().addTo(map);

    const handleZoom = (event: Event) => {
      const bounds = (event as CustomEvent).detail.bounds;
      map.fitBounds(bounds, { padding: [50, 50] });
    };

    // Ustawienie widoku na lokalizację pracy (JOB).
    const handleSetView = (event: Event) => {
      const d = (event as CustomEvent).detail as { lat: number; lng: number; zoom?: number };
      if (typeof d?.lat === "number" && typeof d?.lng === "number") {
        map.setView([d.lat, d.lng], d.zoom ?? map.getZoom());
      }
    };

    const handleMove = () => {
      const c = map.getCenter();
      onMapMoveRef.current?.(c.lat, c.lng, map.getZoom());
    };

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      // W trybie zaznaczania klik obsługuje logika fence (mousedown/up).
      if (selectModeRef.current) return;
      onMapClickRef.current?.(event.latlng.lat, event.latlng.lng);
      if (measureModeRef.current !== "none") {
        addMeasurementPoint(event.latlng.lat, event.latlng.lng);
        return;
      }
      // WMS GetFeatureInfo
      if (baseLayerRef.current === "wms" && wmsUrlRef.current && wmsLayerNameRef.current) {
        fetchWmsInfo(event);
      }
    };

    const handleMapDblClick = (event: L.LeafletMouseEvent) => {
      onMapDblClickRef.current?.();
      L.DomEvent.stop(event);
    };

    // ── Zaznaczanie ogrodzeniem (fence) ──
    let fenceStart: L.LatLng | null = null;
    let fenceRect: L.Rectangle | null = null;
    let fenceMoved = false;

    const handleMouseDown = (event: L.LeafletMouseEvent) => {
      if (!selectModeRef.current) return;
      fenceStart = event.latlng;
      fenceMoved = false;
      map.dragging.disable();
    };

    const handleMouseMove = (event: L.LeafletMouseEvent) => {
      if (!fenceStart) return;
      fenceMoved = true;
      const bounds = L.latLngBounds(fenceStart, event.latlng);
      if (fenceRect) fenceRect.setBounds(bounds);
      else fenceRect = L.rectangle(bounds, { color: "#3b82f6", weight: 1, dashArray: "4 4", fillOpacity: 0.1 }).addTo(map);
    };

    const handleMouseUp = () => {
      if (!selectModeRef.current) return;
      map.dragging.enable();
      if (fenceStart) {
        if (fenceMoved && fenceRect) {
          const bounds = fenceRect.getBounds();
          const refs: { layerId: string; featureId: string }[] = [];
          for (const dl of drawingLayersRef.current) {
            if (!dl.visible) continue;
            for (const f of dl.features) {
              if (f.coordinates.some(([lat, lng]) => bounds.contains([lat, lng]))) {
                refs.push({ layerId: dl.id, featureId: f.id });
              }
            }
          }
          // Warstwy wektorowe (import TXT/DXF/SHP/KML)
          for (const kl of kmlLayersRef.current) {
            if (!kl.visible) continue;
            kl.geojson.features.forEach((f, idx) => {
              if (geomLatLngs(f.geometry).some(([lat, lng]) => bounds.contains([lat, lng]))) {
                refs.push({ layerId: kl.id, featureId: String(idx) });
              }
            });
          }
          onFenceSelectRef.current?.(refs);
        } else {
          onClearSelectionRef.current?.();
        }
      }
      fenceStart = null;
      if (fenceRect) { map.removeLayer(fenceRect); fenceRect = null; }
      fenceMoved = false;
    };

    window.addEventListener("zoom-to-bounds", handleZoom);
    map.on("click", handleMapClick);
    map.on("dblclick", handleMapDblClick);
    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("zoom-to-bounds", handleZoom);
      map.off("click", handleMapClick);
      map.off("dblclick", handleMapDblClick);
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    measureModeRef.current = measureMode;
    onMapClickRef.current = onMapClick;
    onMapDblClickRef.current = onMapDblClick;
    baseLayerRef.current = baseLayer;
    wmsUrlRef.current = wmsUrl;
    wmsLayerNameRef.current = wmsLayer;
    onWmsPixelInfoRef.current = onWmsPixelInfo;
    selectModeRef.current = selectMode;
    onToggleSelectFeatureRef.current = onToggleSelectFeature;
    onFenceSelectRef.current = onFenceSelect;
    onClearSelectionRef.current = onClearSelection;
    drawingLayersRef.current = drawingLayers;
    kmlLayersRef.current = kmlLayers;
    // Build snap targets: photo centers/corners + drawing layer vertices
    const photoTargets = createPhotoSnapTargets(photos);
    const drawTargets = drawingLayers.flatMap((dl) =>
      dl.visible
        ? dl.features.flatMap((f) =>
            f.coordinates.map(([lat, lng], i) => ({
              id: `${dl.id}-${f.id}-${i}`,
              lat,
              lng,
              label: `${dl.name} v${i + 1}`,
              kind: "corner" as const,
              photoId: "",
            }))
          )
        : []
    );
    snapTargetsRef.current = [...photoTargets, ...drawTargets];
  }, [measureMode, onMapClick, onMapDblClick, photos, baseLayer, wmsUrl, wmsLayer, onWmsPixelInfo, drawingLayers, kmlLayers, selectMode, onToggleSelectFeature, onFenceSelect, onClearSelection]);

  useEffect(() => {
    resetMeasurement();
  }, [measureMode, measurementResetSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });

    if (baseLayer === "google") {
      L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        attribution: "© Google", maxZoom: 20,
      }).addTo(map);
    } else if (baseLayer === "wms" && wmsUrl && wmsLayer) {
      L.tileLayer.wms(wmsUrl, {
        layers: wmsLayer,
        format: "image/png",
        transparent: false,
        attribution: "WMS",
        maxZoom: 19,
      } as any).addTo(map);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 19,
      }).addTo(map);
    }
  }, [baseLayer, wmsUrl, wmsLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.forEach((lg) => map.removeLayer(lg));
    layersRef.current = [];

    if (photos.length === 0) {
      fitDoneRef.current = false;
      return;
    }

    const photoGroup = L.layerGroup().addTo(map);
    layersRef.current.push(photoGroup);

    const selectedSet = new Set(selectedPhotoIds);
    const allOverlapping = new Map<string, { forward: number; lateral: number }>();

    // Sąsiadów na zielono pokazuj TYLKO przy porównaniu (>=2 zaznaczone).
    // Pojedynczy klik podświetla tylko klikniete zdjęcie.
    if (selectedPhotoIds.length >= 2) {
      for (const selectedId of selectedPhotoIds) {
        const selectedPhoto = photos.find((p) => p.id === selectedId);
        if (!selectedPhoto) continue;
        const overlaps = findOverlappingPhotos(selectedPhoto, photos);
        for (const overlap of overlaps) {
          const existing = allOverlapping.get(overlap.photo.id);
          if (!existing || overlap.forward + overlap.lateral > existing.forward + existing.lateral) {
            allOverlapping.set(overlap.photo.id, { forward: overlap.forward, lateral: overlap.lateral });
          }
        }
      }
    }

    photos.forEach((photo) => {
      const isSelected = selectedSet.has(photo.id);
      const overlapInfo = allOverlapping.get(photo.id);
      const isOverlapping = Boolean(overlapInfo);
      const bgColor = isSelected
        ? "hsl(210, 100%, 50%)"
        : isOverlapping
          ? "hsl(120, 70%, 45%)"
          : "hsl(222.2, 47.4%, 11.2%)";
      const size = isSelected ? 16 : 12;

      const cameraIcon = L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;background:${bgColor};border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:pointer"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        className: "",
      });

      let popupContent = `<b>${photo.filename}</b><br/>Lat: ${photo.lat.toFixed(6)}<br/>Lng: ${photo.lng.toFixed(6)}<br/>Zasięg: ${photo.footprintWidth.toFixed(1)}m × ${photo.footprintHeight.toFixed(1)}m`;
      if (photo.altitude !== undefined) popupContent += `<br/>Wys. GPS (MSL): ${photo.altitude.toFixed(1)} m`;
      if (photo.terrainHeight !== undefined && photo.terrainHeight !== null) popupContent += `<br/>Teren DEM: ${photo.terrainHeight.toFixed(1)} m`;
      if (photo.altitudeAGL !== undefined) popupContent += `<br/><b>Wys. lotu (AGL): ${photo.altitudeAGL.toFixed(1)} m</b>`;
      if (photo.speed !== undefined) popupContent += `<br/>Prędkość: ${photo.speed.toFixed(1)} m/s`;
      if (photo.gsd !== undefined) popupContent += `<br/>GSD: ${photo.gsd.toFixed(2)} cm/px`;
      if (photo.heading !== undefined) popupContent += `<br/>Kurs: ${photo.heading.toFixed(1)}°`;
      if (photo.sensorInfo) {
        popupContent += `<br/><span style="color:#888">Sensor: ${photo.sensorInfo.sensorWidth.toFixed(1)}×${photo.sensorInfo.sensorHeight.toFixed(1)}mm, f=${photo.sensorInfo.focalLength.toFixed(1)}mm (${photo.sensorInfo.source ?? "fallback"})</span>`;
      }
      if (overlapInfo) {
        if (overlapInfo.forward > 0) popupContent += `<br/><b>Pokrycie podłużne: ${overlapInfo.forward.toFixed(1)}%</b>`;
        if (overlapInfo.lateral > 0) popupContent += `<br/><b>Pokrycie poprzeczne: ${overlapInfo.lateral.toFixed(1)}%</b>`;
      }
      if (photo.thumbnailUrl) {
        popupContent += `<br/><img src="${photo.thumbnailUrl}" style="max-width:200px;max-height:150px;margin-top:4px;border-radius:4px"/>`;
      }

      const marker = L.marker([photo.lat, photo.lng], { icon: cameraIcon })
        .bindPopup(popupContent, { autoPan: false })
        .bindTooltip(photo.filename, { direction: "top", offset: [0, -size / 2 - 4], className: "leaflet-tooltip-photo" })
        .addTo(photoGroup);

      marker.off("click");
      marker.on("click", (event) => {
        const mouseEvent = event.originalEvent as MouseEvent;
        onMapClickRef.current?.(photo.lat, photo.lng);
        if (measureModeRef.current !== "none") {
          addMeasurementPoint(photo.lat, photo.lng);
          L.DomEvent.stop(event);
          return;
        }
        const ctrlKey = Boolean(mouseEvent.ctrlKey || mouseEvent.metaKey);
        L.DomEvent.stop(event);
        onPhotoSelect?.(photo.id, ctrlKey);
        if (ctrlKey) {
          marker.closePopup();
          map.closePopup();
        } else {
          marker.openPopup();
        }
      });

      if (showFootprints && photo.footprintCorners.length === 4) {
        const color = isSelected
          ? "hsl(210, 100%, 50%)"
          : isOverlapping
            ? "hsl(120, 70%, 45%)"
            : footprintStyle.color;
        const fillOpacity = isSelected ? 0.25 : isOverlapping ? 0.2 : (footprintStyle.outlineOnly ? 0 : footprintStyle.fillOpacity);

        const footprint = L.polygon(photo.footprintCorners, {
          color,
          fillColor: color,
          fillOpacity,
          weight: isSelected ? 2 : 1,
        }).addTo(photoGroup);

        footprint.on("click", (event) => {
          if (measureModeRef.current === "none") return;
          addMeasurementPoint(event.latlng.lat, event.latlng.lng);
          L.DomEvent.stop(event);
        });
      }
    });

    if (showOverlapHeatmap && photos.length > 1) {
      const overlapGroup = L.layerGroup().addTo(map);
      layersRef.current.push(overlapGroup);

      const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng] as [number, number]));
      const padding = 0.002;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const gridSize = 30;
      const latStep = (ne.lat - sw.lat + padding * 2) / gridSize;
      const lngStep = (ne.lng - sw.lng + padding * 2) / gridSize;

      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const cellLat = sw.lat - padding + latStep * (i + 0.5);
          const cellLng = sw.lng - padding + lngStep * (j + 0.5);
          let coverage = 0;

          photos.forEach((photo) => {
            const corners = photo.footprintCorners;
            if (corners.length !== 4) return;
            const minLat = Math.min(...corners.map((c) => c[0]));
            const maxLat = Math.max(...corners.map((c) => c[0]));
            const minLng = Math.min(...corners.map((c) => c[1]));
            const maxLng = Math.max(...corners.map((c) => c[1]));
            if (cellLat >= minLat && cellLat <= maxLat && cellLng >= minLng && cellLng <= maxLng) coverage++;
          });

          if (coverage >= 2) {
            const color = coverage >= 5 ? "hsl(120, 70%, 40%)" : coverage >= 4 ? "hsl(90, 70%, 45%)" : coverage >= 3 ? "hsl(60, 70%, 50%)" : "hsl(30, 70%, 50%)";
            const opacity = Math.min(0.6, 0.2 + coverage * 0.08);
            L.rectangle(
              [[sw.lat - padding + latStep * i, sw.lng - padding + lngStep * j], [sw.lat - padding + latStep * (i + 1), sw.lng - padding + lngStep * (j + 1)]],
              { color: "transparent", fillColor: color, fillOpacity: opacity, weight: 0 }
            ).addTo(overlapGroup);
          }
        }
      }
    }

    if (!fitDoneRef.current) {
      const allPoints = photos.map((p) => [p.lat, p.lng] as [number, number]);
      if (allPoints.length > 0) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
        fitDoneRef.current = true;
      }
    }
  }, [photos, showFootprints, footprintStyle, showOverlapHeatmap, selectedPhotoIds, onPhotoSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if ((layer as any)._isKml) map.removeLayer(layer);
    });

    const selectedRefSet = new Set(selectedFeatureRefs);

    kmlLayers.forEach((layer) => {
      if (!layer.visible) return;
      // Renderujemy każdy obiekt osobno, by móc go zaznaczać i podświetlać.
      layer.geojson.features.forEach((feature, idx) => {
        const ref = `${layer.id}:${idx}`;
        const isSel = selectedRefSet.has(ref);
        const color = isSel ? "#f59e0b" : layer.color;
        const weight = isSel ? layer.weight + 2 : layer.weight;
        const geoLayer = L.geoJSON(feature as any, {
          style: { color, weight, opacity: 0.9, fillOpacity: isSel ? 0.4 : 0.2 },
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              radius: isSel ? 7 : 5,
              color,
              fillColor: color,
              fillOpacity: 0.85,
              weight: isSel ? 3 : 2,
            }),
        });
        (geoLayer as any)._isKml = true;

        const fname = (feature.properties as any)?.name;
        geoLayer.on("click", (e: L.LeafletMouseEvent) => {
          if (measureModeRef.current !== "none") return;
          L.DomEvent.stop(e);
          if (selectModeRef.current) {
            onToggleSelectFeatureRef.current?.(layer.id, String(idx));
            return;
          }
          // Pokaż współrzędne w panelu na dole. Dla punktu użyj jego zaimportowanej pozycji i układu.
          const g = feature.geometry as any;
          if (g?.type === "Point") onMapClickRef.current?.(g.coordinates[1], g.coordinates[0], (layer as any).crs);
          else onMapClickRef.current?.(e.latlng.lat, e.latlng.lng, (layer as any).crs);
        });
        if (fname && !selectModeRef.current) geoLayer.bindTooltip(String(fname), { direction: "top" });

        geoLayer.addTo(map);
      });
    });
  }, [kmlLayers, selectedFeatureRefs, onToggleSelectFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if ((layer as any)._isCoverageGap) map.removeLayer(layer);
    });

    if (coverageGaps.length === 0) return;

    const gapGroup = L.layerGroup();
    (gapGroup as any)._isCoverageGap = true;

    coverageGaps.forEach((gap) => {
      L.rectangle(
        [
          [gap.lat - gap.latSize / 2, gap.lng - gap.lngSize / 2],
          [gap.lat + gap.latSize / 2, gap.lng + gap.lngSize / 2],
        ],
        { color: "red", fillColor: "red", fillOpacity: 0.35, weight: 0.5 }
      ).addTo(gapGroup);
    });

    gapGroup.addTo(map);
  }, [coverageGaps]);

  // Drawing layers
  useEffect(() => {
    const layer = drawingLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const selectedRefSet = new Set(selectedFeatureRefs);
    drawingLayers.forEach((dl) => {
      if (!dl.visible) return;
      dl.features.forEach((f) => {
        const isMultiSelected = selectedRefSet.has(`${dl.id}:${f.id}`);
        const isSelected = selectedFeatureId === f.id || isMultiSelected;
        const drawColor = isMultiSelected ? "#f59e0b" : dl.color;
        const weight = isSelected ? 4 : 2;
        const tooltip = f.attrs.name || dl.name;
        const handleClick = (e: L.LeafletMouseEvent) => {
          if (measureModeRef.current !== "none") return;
          L.DomEvent.stop(e);
          if (selectModeRef.current) {
            onToggleSelectFeatureRef.current?.(dl.id, f.id);
            return;
          }
          onFeatureClick?.(dl.id, f.id);
        };

        if (dl.type === "point" && f.coordinates.length > 0) {
          const [lat, lng] = f.coordinates[0];
          const m = L.circleMarker([lat, lng], {
            radius: isSelected ? 8 : 6,
            color: drawColor,
            fillColor: drawColor,
            fillOpacity: 0.85,
            weight,
          })
            .bindTooltip(tooltip, { direction: "top", offset: [0, -8] })
            .addTo(layer);
          m.on("click", handleClick);
        } else if (dl.type === "line" && f.coordinates.length >= 2) {
          const m = L.polyline(f.coordinates, { color: drawColor, weight: weight + 1 })
            .bindTooltip(tooltip, { direction: "top" })
            .addTo(layer);
          m.on("click", handleClick);
        } else if (dl.type === "polygon" && f.coordinates.length >= 3) {
          const m = L.polygon(f.coordinates, {
            color: drawColor,
            fillColor: drawColor,
            fillOpacity: isMultiSelected ? 0.35 : 0.2,
            weight,
          })
            .bindTooltip(tooltip, { direction: "center" })
            .addTo(layer);
          m.on("click", (e) => {
            if (measureModeRef.current !== "none") {
              const pts = f.coordinates.map(([lat, lng]) => ({ lat, lng }));
              const area = calcPolygonArea(pts);
              const perim = calcPolylineDistance([...pts, pts[0]]);
              onMeasurementChange?.({ distanceMeters: perim, areaSquareMeters: area, pointCount: pts.length });
              L.DomEvent.stop(e);
              return;
            }
            handleClick(e);
          });
        }
      });
    });

    // In-progress drawing
    if (drawingPoints.length > 0) {
      const color = drawMode === "line" ? "#3b82f6" : "#22c55e";
      drawingPoints.forEach(([lat, lng]) => {
        L.circleMarker([lat, lng], { radius: 4, color, fillColor: color, fillOpacity: 1, weight: 2 }).addTo(layer);
      });
      if (drawMode === "polygon" && drawingPoints.length >= 3) {
        // Podgląd poligonu jako figura zamknięta.
        L.polygon(drawingPoints, { color, fillColor: color, fillOpacity: 0.15, weight: 2, dashArray: "6 4" }).addTo(layer);
      } else if (drawingPoints.length >= 2) {
        L.polyline(drawingPoints, { color, weight: 2, dashArray: "6 4" }).addTo(layer);
      }
    }
  }, [drawingLayers, drawingPoints, drawMode, selectedFeatureId, onFeatureClick, selectedFeatureRefs]);

  return <div ref={containerRef} className="h-full w-full" />;
};

export default MapView;
