import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PhotoPoint, KmlLayer } from "@/types/photo";
import { findOverlappingPhotos } from "@/lib/photoUtils";

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
  showOverlapHeatmap: boolean;
  baseLayer: "osm" | "google";
  selectedPhotoIds?: string[];
  onPhotoSelect?: (id: string | null, ctrlKey: boolean) => void;
}

const MapView = ({ photos, kmlLayers, showFootprints, showOverlapHeatmap, baseLayer, selectedPhotoIds = [], onPhotoSelect }: MapViewProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.LayerGroup[]>([]);
  const fitDoneRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([52.0, 19.0], 6);
    mapRef.current = map;

    const handleZoom = (e: Event) => {
      const bounds = (e as CustomEvent).detail.bounds;
      map.fitBounds(bounds, { padding: [50, 50] });
    };
    window.addEventListener("zoom-to-bounds", handleZoom);

    return () => {
      window.removeEventListener("zoom-to-bounds", handleZoom);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update base layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });
    if (baseLayer === "google") {
      L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        attribution: "© Google",
        maxZoom: 20,
      }).addTo(map);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
    }
  }, [baseLayer]);

  // Update photo markers and footprints
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
    
    // Find overlapping photos for all selected
    const allOverlapping = new Map<string, { forward: number; lateral: number }>();
    for (const selId of selectedPhotoIds) {
      const selPhoto = photos.find(p => p.id === selId);
      if (!selPhoto) continue;
      const overlaps = findOverlappingPhotos(selPhoto, photos);
      for (const o of overlaps) {
        const existing = allOverlapping.get(o.photo.id);
        if (!existing || o.forward + o.lateral > existing.forward + existing.lateral) {
          allOverlapping.set(o.photo.id, { forward: o.forward, lateral: o.lateral });
        }
      }
    }

    photos.forEach((photo) => {
      const isSelected = selectedSet.has(photo.id);
      const overlapInfo = allOverlapping.get(photo.id);
      const isOverlapping = !!overlapInfo;
      
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

      let popupContent = `<b>${photo.filename}</b><br/>` +
        `Lat: ${photo.lat.toFixed(6)}<br/>` +
        `Lng: ${photo.lng.toFixed(6)}<br/>` +
        `Zasięg: ${photo.footprintWidth.toFixed(1)}m × ${photo.footprintHeight.toFixed(1)}m`;

      if (photo.altitude) popupContent += `<br/>Wys.: ${photo.altitude.toFixed(1)}m`;
      if (photo.speed !== undefined) popupContent += `<br/>Prędkość: ${photo.speed.toFixed(1)} m/s`;
      if (photo.gsd !== undefined) popupContent += `<br/>GSD: ${photo.gsd.toFixed(2)} cm/px`;
      if (photo.heading !== undefined) popupContent += `<br/>Kurs: ${photo.heading.toFixed(1)}°`;
      if (photo.sensorInfo) {
        popupContent += `<br/><span style="color:#888">Sensor: ${photo.sensorInfo.sensorWidth.toFixed(1)}×${photo.sensorInfo.sensorHeight.toFixed(1)}mm, f=${photo.sensorInfo.focalLength.toFixed(1)}mm</span>`;
      }
      if (overlapInfo) {
        if (overlapInfo.forward > 0) popupContent += `<br/><b>Pokrycie podłużne: ${overlapInfo.forward.toFixed(1)}%</b>`;
        if (overlapInfo.lateral > 0) popupContent += `<br/><b>Pokrycie poprzeczne: ${overlapInfo.lateral.toFixed(1)}%</b>`;
      }
      if (photo.thumbnailUrl) {
        popupContent += `<br/><img src="${photo.thumbnailUrl}" style="max-width:200px;max-height:150px;margin-top:4px;border-radius:4px"/>`;
      }

      const marker = L.marker([photo.lat, photo.lng], { icon: cameraIcon })
        .bindPopup(popupContent)
        .addTo(photoGroup);

      marker.on("click", (e) => {
        const ctrlKey = (e.originalEvent as MouseEvent).ctrlKey || (e.originalEvent as MouseEvent).metaKey;
        onPhotoSelect?.(photo.id, ctrlKey);
      });

      // Draw footprint
      const shouldShowFootprint = showFootprints || isSelected || isOverlapping;
      if (shouldShowFootprint && photo.footprintCorners.length === 4) {
        const color = isSelected
          ? "hsl(210, 100%, 50%)"
          : isOverlapping
          ? "hsl(120, 70%, 45%)"
          : "hsl(222.2, 47.4%, 11.2%)";
        const fillOpacity = isSelected ? 0.25 : isOverlapping ? 0.2 : 0.1;

        L.polygon(photo.footprintCorners, {
          color,
          fillColor: color,
          fillOpacity,
          weight: isSelected ? 2 : 1,
        }).addTo(photoGroup);
      }
    });

    // Overlap heatmap
    if (showOverlapHeatmap && photos.length > 1) {
      const overlapGroup = L.layerGroup().addTo(map);
      layersRef.current.push(overlapGroup);

      const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng]));
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
          photos.forEach((p) => {
            const corners = p.footprintCorners;
            if (corners.length === 4) {
              const minLat = Math.min(...corners.map((c) => c[0]));
              const maxLat = Math.max(...corners.map((c) => c[0]));
              const minLng = Math.min(...corners.map((c) => c[1]));
              const maxLng = Math.max(...corners.map((c) => c[1]));
              if (cellLat >= minLat && cellLat <= maxLat && cellLng >= minLng && cellLng <= maxLng) {
                coverage++;
              }
            }
          });

          if (coverage >= 2) {
            const color =
              coverage >= 5 ? "hsl(120, 70%, 40%)" :
              coverage >= 4 ? "hsl(90, 70%, 45%)" :
              coverage >= 3 ? "hsl(60, 70%, 50%)" :
              "hsl(30, 70%, 50%)";
            const opacity = Math.min(0.6, 0.2 + coverage * 0.08);

            L.rectangle(
              [
                [sw.lat - padding + latStep * i, sw.lng - padding + lngStep * j],
                [sw.lat - padding + latStep * (i + 1), sw.lng - padding + lngStep * (j + 1)],
              ],
              { color: "transparent", fillColor: color, fillOpacity: opacity, weight: 0 }
            ).addTo(overlapGroup);
          }
        }
      }
    }

    // Fit bounds only on first load
    if (!fitDoneRef.current) {
      const allPoints = photos.map((p) => [p.lat, p.lng] as [number, number]);
      if (allPoints.length > 0) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
        fitDoneRef.current = true;
      }
    }
  }, [photos, showFootprints, showOverlapHeatmap, selectedPhotoIds, onPhotoSelect]);

  // KML layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if ((layer as any)._isKml) map.removeLayer(layer);
    });

    kmlLayers.forEach((kl) => {
      if (!kl.visible) return;
      const geoLayer = L.geoJSON(kl.geojson, {
        style: { color: kl.color, weight: 2, opacity: 0.8 },
        onEachFeature: (feature, layer) => {
          if (feature.properties?.name) {
            layer.bindPopup(feature.properties.name);
          }
        },
      });
      (geoLayer as any)._isKml = true;
      geoLayer.addTo(map);
    });
  }, [kmlLayers]);

  return <div ref={containerRef} className="w-full h-full" />;
};

export default MapView;
