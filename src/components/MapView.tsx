import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FootprintStyle, KmlLayer, MeasureMode, MeasurementSummary, PhotoPoint } from "@/types/photo";
import { findOverlappingPhotos } from "@/lib/photoUtils";
import { calcPolygonArea, calcPolylineDistance, createPhotoSnapTargets, findNearestSnapTarget } from "@/lib/measurementUtils";
import { CoverageResult } from "@/lib/coverageUtils";

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
  baseLayer: "osm" | "google";
  selectedPhotoIds?: string[];
  onPhotoSelect?: (id: string | null, ctrlKey: boolean) => void;
  measureMode: MeasureMode;
  measurementResetSignal: number;
  onMeasurementChange?: (summary: MeasurementSummary | null) => void;
  onMapClick?: (lat: number, lng: number) => void;
  coverageGaps?: CoverageResult["gaps"];
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
  selectedPhotoIds = [],
  onPhotoSelect,
  measureMode,
  measurementResetSignal,
  onMeasurementChange,
  onMapClick,
  coverageGaps = [],
}: MapViewProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.LayerGroup[]>([]);
  const fitDoneRef = useRef(false);
  const measurementLayerRef = useRef<L.LayerGroup | null>(null);
  const measurementPointsRef = useRef<[number, number][]>([]);
  const measureModeRef = useRef<MeasureMode>(measureMode);
  const onMapClickRef = useRef(onMapClick);
  const snapTargetsRef = useRef(createPhotoSnapTargets(photos));

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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: false }).setView([52.0, 19.0], 6);
    L.control.zoom({ position: "topright" }).addTo(map);
    mapRef.current = map;
    measurementLayerRef.current = L.layerGroup().addTo(map);

    const handleZoom = (event: Event) => {
      const bounds = (event as CustomEvent).detail.bounds;
      map.fitBounds(bounds, { padding: [50, 50] });
    };

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(event.latlng.lat, event.latlng.lng);
      if (measureModeRef.current === "none") return;
      addMeasurementPoint(event.latlng.lat, event.latlng.lng);
    };

    window.addEventListener("zoom-to-bounds", handleZoom);
    map.on("click", handleMapClick);

    return () => {
      window.removeEventListener("zoom-to-bounds", handleZoom);
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    measureModeRef.current = measureMode;
    onMapClickRef.current = onMapClick;
    snapTargetsRef.current = createPhotoSnapTargets(photos);
  }, [measureMode, onMapClick, photos]);

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
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 19,
      }).addTo(map);
    }
  }, [baseLayer]);

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
      if (photo.altitude) popupContent += `<br/>Wys.: ${photo.altitude.toFixed(1)}m`;
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

      // Only show footprints when toggle is ON
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

    kmlLayers.forEach((layer) => {
      if (!layer.visible) return;
      const geoLayer = L.geoJSON(layer.geojson, {
        style: { color: layer.color, weight: layer.weight, opacity: 0.8 },
        onEachFeature: (feature, featureLayer) => {
          if (feature.properties?.name) featureLayer.bindPopup(feature.properties.name);
        },
      });
      (geoLayer as any)._isKml = true;
      geoLayer.addTo(map);
    });
  }, [kmlLayers]);

  return <div ref={containerRef} className="h-full w-full" />;
};

export default MapView;
