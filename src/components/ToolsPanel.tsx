import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawingLayer, DrawMode } from "@/types/drawing";
import { CoordinateSystem, EXPORT_EPSG } from "@/lib/coordinateUtils";
import {
  PenTool, Satellite, Download, Plus, CircleDot, Minus, Square, Eye, EyeOff,
  Trash2, Edit2, MapPin, Crosshair, Check,
} from "lucide-react";
import { toast } from "sonner";

type GeomType = "point" | "line" | "polygon";

const CRS_OPTIONS: { value: CoordinateSystem; label: string }[] = [
  { value: "puwg1992", label: "PUWG 1992" },
  { value: "puwg2000", label: "PUWG 2000" },
  { value: "wgs84", label: "WGS 84" },
];

interface ToolsPanelProps {
  drawingLayers: DrawingLayer[];
  activeDrawLayerId: string | null;
  drawMode: DrawMode;
  drawingInProgressCount: number;
  selectedFeature: { layerId: string; featureId: string } | null;
  selectedFeatures: { layerId: string; featureId: string }[];
  onCreateLayer: (opts: { name: string; type: GeomType; crs: CoordinateSystem }) => string;
  onSetActiveDrawLayer: (id: string | null) => void;
  onToggleDrawLayer: (id: string) => void;
  onRemoveDrawLayer: (id: string) => void;
  onRenameDrawLayer: (id: string, name: string) => void;
  onChangeDrawLayerColor: (id: string, color: string) => void;
  onSelectFeature: (layerId: string, featureId: string) => void;
  onFinishDrawing: () => void;
  onAddFeatureToLayer: (layerId: string, coordinates: [number, number][], namePrefix: string, heights?: (number | null)[]) => void;
  onExportLayers: (layerIds: string[], format: "kml" | "dxf" | "geojson" | "txt", epsg: CoordinateSystem, scope: "all" | "selected") => void;
}

const typeIcon = (t: string) => t === "point" ? <CircleDot className="h-3 w-3" /> : t === "line" ? <Minus className="h-3 w-3" /> : <Square className="h-3 w-3" />;
const typeLabel = (t: string) => t === "point" ? "Punktowa" : t === "line" ? "Liniowa" : "Powierzchniowa";

const getPosition = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("Brak GPS w przeglądarce")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

const ToolsPanel = ({
  drawingLayers, activeDrawLayerId, drawMode, drawingInProgressCount,
  selectedFeature, selectedFeatures,
  onCreateLayer, onSetActiveDrawLayer, onToggleDrawLayer, onRemoveDrawLayer,
  onRenameDrawLayer, onChangeDrawLayerColor, onSelectFeature, onFinishDrawing,
  onAddFeatureToLayer, onExportLayers,
}: ToolsPanelProps) => {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  // ── Drawing: nowa warstwa ──
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<GeomType>("point");
  const [newCrs, setNewCrs] = useState<CoordinateSystem>("puwg1992");

  const addLayer = () => {
    const name = newName.trim() || typeLabel(newType);
    onCreateLayer({ name, type: newType, crs: newCrs });
    setNewName("");
  };

  // ── GPS ──
  const [gpsTarget, setGpsTarget] = useState<string>("new"); // "new" | layerId
  const [gpsName, setGpsName] = useState("");
  const [gpsType, setGpsType] = useState<GeomType>("point");
  const [gpsCrs, setGpsCrs] = useState<CoordinateSystem>("puwg1992");
  const [gpsVertices, setGpsVertices] = useState<[number, number][]>([]);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsLast, setGpsLast] = useState<{ lat: number; lng: number; acc: number } | null>(null);

  const targetLayer = gpsTarget !== "new" ? drawingLayers.find((l) => l.id === gpsTarget) ?? null : null;
  const effType: GeomType = targetLayer ? targetLayer.type : gpsType;

  const ensureGpsLayer = (): string => {
    if (targetLayer) return targetLayer.id;
    const name = gpsName.trim() || `GPS ${typeLabel(gpsType)}`;
    const id = onCreateLayer({ name, type: gpsType, crs: gpsCrs });
    setGpsTarget(id);
    return id;
  };

  const readGps = async (): Promise<[number, number] | null> => {
    setGpsBusy(true);
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
      setGpsLast({ lat, lng, acc });
      return [lat, lng];
    } catch (e) {
      toast.error(`Błąd GPS: ${(e as Error).message}`);
      return null;
    } finally {
      setGpsBusy(false);
    }
  };

  const measurePoint = async () => {
    const coord = await readGps();
    if (!coord) return;
    const id = ensureGpsLayer();
    onAddFeatureToLayer(id, [coord], "Punkt GPS");
    toast.success("Dodano punkt z GPS");
  };

  const addVertex = async () => {
    const coord = await readGps();
    if (!coord) return;
    setGpsVertices((prev) => [...prev, coord]);
  };

  const finishGpsFeature = () => {
    const min = effType === "line" ? 2 : 3;
    if (gpsVertices.length < min) { toast.warning(`Potrzeba min. ${min} punktów`); return; }
    const id = ensureGpsLayer();
    onAddFeatureToLayer(id, gpsVertices, effType === "line" ? "Linia GPS" : "Poligon GPS");
    setGpsVertices([]);
    toast.success("Dodano obiekt z GPS");
  };

  // ── Export ──
  const [exportSel, setExportSel] = useState<Record<string, boolean>>({});
  const [exportEpsg, setExportEpsg] = useState<CoordinateSystem>("wgs84");
  const [exportScope, setExportScope] = useState<"all" | "selected">("all");

  const selectedExportIds = useMemo(
    () => drawingLayers.filter((l) => exportSel[l.id]).map((l) => l.id),
    [drawingLayers, exportSel]
  );

  const doExport = (format: "kml" | "dxf" | "geojson" | "txt") => {
    if (selectedExportIds.length === 0) { toast.warning("Zaznacz warstwy do eksportu"); return; }
    onExportLayers(selectedExportIds, format, exportEpsg, exportScope);
  };

  return (
    <div className="h-full w-80 overflow-y-auto border-l bg-card p-3">
      <Tabs defaultValue="draw" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="draw" className="text-xs"><PenTool className="mr-1 h-3 w-3" /> Rysowanie</TabsTrigger>
          <TabsTrigger value="gps" className="text-xs"><Satellite className="mr-1 h-3 w-3" /> GPS</TabsTrigger>
          <TabsTrigger value="export" className="text-xs"><Download className="mr-1 h-3 w-3" /> Eksport</TabsTrigger>
        </TabsList>

        {/* ───────── Rysowanie ───────── */}
        <TabsContent value="draw" className="space-y-3 pt-3">
          <div className="space-y-2 rounded-md border p-2">
            <Label className="text-xs font-semibold">Nowa warstwa</Label>
            <Input className="h-8 text-xs" placeholder="Nazwa (np. drzewo)" value={newName}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLayer()} />
            <div className="grid grid-cols-3 gap-1">
              {(["point", "line", "polygon"] as GeomType[]).map((t) => (
                <Button key={t} variant={newType === t ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => setNewType(t)}>
                  {typeIcon(t)}<span className="ml-1">{typeLabel(t)}</span>
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Układ:</Label>
              <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                value={newCrs} onChange={(e) => setNewCrs(e.target.value as CoordinateSystem)}>
                {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <Button size="sm" className="w-full" onClick={addLayer}><Plus className="mr-1 h-3 w-3" /> Dodaj warstwę</Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            {activeDrawLayerId
              ? "Klikaj na mapie. Linie/poligony: dblklik lub Zakończ. ESC = wyjście."
              : "Aktywuj warstwę aby rysować (kliknij jej nazwę)."}
          </p>

          {activeDrawLayerId && drawMode !== "point" && drawingInProgressCount > 0 && (
            <Button size="sm" className="w-full" onClick={onFinishDrawing} disabled={drawingInProgressCount < (drawMode === "line" ? 2 : 3)}>
              Zakończ ({drawingInProgressCount} pkt)
            </Button>
          )}

          {drawingLayers.length === 0 && <p className="text-xs italic text-muted-foreground">Brak warstw.</p>}

          {drawingLayers.map((dl) => {
            const isActive = activeDrawLayerId === dl.id;
            const isEditing = editingLayerId === dl.id;
            return (
              <div key={dl.id} className={`space-y-1 rounded-md border p-2 ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}>
                <div className="flex items-center gap-1">
                  {typeIcon(dl.type)}
                  {isEditing ? (
                    <Input autoFocus defaultValue={dl.name} className="h-6 text-xs flex-1"
                      onBlur={(e) => { onRenameDrawLayer(dl.id, e.target.value || dl.name); setEditingLayerId(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingLayerId(null); }} />
                  ) : (
                    <span className="flex-1 cursor-pointer truncate text-xs font-medium text-foreground"
                      onClick={() => onSetActiveDrawLayer(isActive ? null : dl.id)} title="Kliknij aby aktywować rysowanie">
                      {dl.name} <span className="text-muted-foreground">({dl.features.length})</span>
                    </span>
                  )}
                  <input type="color" value={dl.color} onChange={(e) => onChangeDrawLayerColor(dl.id, e.target.value)} className="h-5 w-5 cursor-pointer rounded border-0 p-0" title="Kolor" />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingLayerId(dl.id)} title="Zmień nazwę"><Edit2 className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onToggleDrawLayer(dl.id)}>
                    {dl.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemoveDrawLayer(dl.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <p className="text-[10px] text-muted-foreground pl-4">{typeLabel(dl.type)} · {(dl.crs ?? "wgs84").toUpperCase()}</p>
                {dl.features.length > 0 && (
                  <div className="max-h-28 overflow-y-auto space-y-0.5 border-t pt-1">
                    {dl.features.map((f, i) => {
                      const sel = selectedFeature?.layerId === dl.id && selectedFeature.featureId === f.id;
                      return (
                        <button key={f.id} onClick={() => onSelectFeature(dl.id, f.id)}
                          className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-[10px] text-left hover:bg-muted ${sel ? "bg-muted" : ""}`}>
                          <span className="truncate text-foreground">{f.attrs.name || `${i + 1}`}</span>
                          <span className="text-muted-foreground font-mono">{f.coordinates.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* ───────── Pomiar GPS ───────── */}
        <TabsContent value="gps" className="space-y-3 pt-3">
          <div className="space-y-2 rounded-md border p-2">
            <Label className="text-xs font-semibold flex items-center gap-1"><Satellite className="h-3 w-3" /> Pomiar GPS urządzenia</Label>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Warstwa:</Label>
              <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                value={gpsTarget} onChange={(e) => { setGpsTarget(e.target.value); setGpsVertices([]); }}>
                <option value="new">+ Nowa warstwa</option>
                {drawingLayers.map((l) => <option key={l.id} value={l.id}>{l.name} ({typeLabel(l.type)})</option>)}
              </select>
            </div>

            {gpsTarget === "new" ? (
              <>
                <Input className="h-8 text-xs" placeholder="Nazwa nowej warstwy" value={gpsName} onChange={(e) => setGpsName(e.target.value)} />
                <div className="grid grid-cols-3 gap-1">
                  {(["point", "line", "polygon"] as GeomType[]).map((t) => (
                    <Button key={t} variant={gpsType === t ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => { setGpsType(t); setGpsVertices([]); }}>
                      {typeIcon(t)}<span className="ml-1">{typeLabel(t)}</span>
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Układ:</Label>
                  <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                    value={gpsCrs} onChange={(e) => setGpsCrs(e.target.value as CoordinateSystem)}>
                    {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">Typ z warstwy: <b>{typeLabel(effType)}</b></p>
            )}

            {effType === "point" ? (
              <Button size="sm" className="w-full" disabled={gpsBusy} onClick={measurePoint}>
                <Crosshair className="mr-1 h-3 w-3" /> {gpsBusy ? "Pomiar…" : "Pomierz punkt"}
              </Button>
            ) : (
              <div className="space-y-1">
                <Button size="sm" variant="outline" className="w-full" disabled={gpsBusy} onClick={addVertex}>
                  <MapPin className="mr-1 h-3 w-3" /> {gpsBusy ? "Pomiar…" : `Dodaj punkt (${gpsVertices.length})`}
                </Button>
                <Button size="sm" className="w-full" disabled={gpsVertices.length < (effType === "line" ? 2 : 3)} onClick={finishGpsFeature}>
                  <Check className="mr-1 h-3 w-3" /> Zakończ obiekt
                </Button>
                {gpsVertices.length > 0 && (
                  <Button size="sm" variant="ghost" className="w-full text-[10px]" onClick={() => setGpsVertices([])}>Wyczyść punkty</Button>
                )}
              </div>
            )}

            {gpsLast && (
              <div className="rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground">
                <div>φ {gpsLast.lat.toFixed(7)}</div>
                <div>λ {gpsLast.lng.toFixed(7)}</div>
                <div>± {gpsLast.acc.toFixed(1)} m</div>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">Pozwól przeglądarce na dostęp do lokalizacji. Najlepiej na telefonie z GPS.</p>
        </TabsContent>

        {/* ───────── Eksport ───────── */}
        <TabsContent value="export" className="space-y-3 pt-3">
          <Label className="text-xs font-semibold">Warstwy do eksportu</Label>
          {drawingLayers.length === 0 && <p className="text-xs italic text-muted-foreground">Brak warstw.</p>}
          {drawingLayers.map((dl) => (
            <label key={dl.id} className="flex items-center gap-2 rounded border p-2 text-xs cursor-pointer">
              <Checkbox checked={!!exportSel[dl.id]} onCheckedChange={(v) => setExportSel((p) => ({ ...p, [dl.id]: !!v }))} />
              {typeIcon(dl.type)}
              <span className="flex-1 truncate text-foreground">{dl.name}</span>
              <span className="text-muted-foreground">{dl.features.length}</span>
            </label>
          ))}

          <div className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Układ:</Label>
              <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                value={exportEpsg} onChange={(e) => setExportEpsg(e.target.value as CoordinateSystem)}>
                {EXPORT_EPSG.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button variant={exportScope === "all" ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => setExportScope("all")}>Cała warstwa</Button>
              <Button variant={exportScope === "selected" ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => setExportScope("selected")}>
                Zaznaczone ({selectedFeatures.length})
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => doExport("kml")}>KML</Button>
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => doExport("dxf")}>DXF</Button>
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => doExport("geojson")}>GeoJSON</Button>
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => doExport("txt")}>TXT</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">KML zawsze w WGS84 (wymóg OGC). „Zaznaczone” używa obiektów wybranych narzędziem strzałki na mapie.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ToolsPanel;
