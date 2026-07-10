import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawingLayer, DrawMode, DrawingFolder } from "@/types/drawing";
import { CoordinateSystem, EXPORT_EPSG, formatCoordinates } from "@/lib/coordinateUtils";
import JobsPanel from "@/components/JobsPanel";
import { Job } from "@/lib/jobsStore";
import {
  PenTool, Satellite, Download, Plus, CircleDot, Minus, Square, Eye, EyeOff,
  Trash2, Edit2, MapPin, Crosshair, Check, FolderPlus, Folder, ChevronRight, ChevronDown,
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
  onSetDrawLayerType: (id: string, type: GeomType) => void;
  onUpdateDrawLayer: (id: string, patch: Partial<DrawingLayer>) => void;
  onSelectFeature: (layerId: string, featureId: string) => void;
  onFinishDrawing: () => void;
  onAddFeatureToLayer: (layerId: string, coordinates: [number, number][], namePrefix: string, heights?: (number | null)[]) => void;
  onExportLayers: (layerIds: string[], format: "kml" | "dxf" | "geojson" | "txt", epsg: CoordinateSystem, scope: "all" | "selected") => void;
  // Foldery grupujące warstwy
  folders: DrawingFolder[];
  onAddFolder: () => void;
  onRemoveFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onToggleFolderCollapse: (id: string) => void;
  onMoveLayerToFolder: (layerId: string, folderId: string | null) => void;
  onReorderFolder: (dragId: string, targetId: string) => void;
  // JOBS
  defaultCrs: CoordinateSystem;
  jobs: Job[];
  activeJobId: string | null;
  onCreateJob: (name: string, crs: CoordinateSystem) => void;
  onSelectJob: (id: string) => void;
  onSaveActiveJob: () => void;
  onDeleteJob: (id: string) => void;
  onExportJob: (id: string) => void;
  onExportAllJobs: () => void;
  onImportJobs: (file: File) => void;
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
  onRenameDrawLayer, onChangeDrawLayerColor, onSetDrawLayerType, onUpdateDrawLayer,
  onSelectFeature, onFinishDrawing,
  onAddFeatureToLayer, onExportLayers,
  defaultCrs,
  jobs, activeJobId, onCreateJob, onSelectJob, onSaveActiveJob, onDeleteJob,
  onExportJob, onExportAllJobs, onImportJobs,
}: ToolsPanelProps) => {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  // ── Drawing: nowa warstwa (tworzona od razu – rysowanie po kliknięciu na mapie) ──
  const [showAddLayer, setShowAddLayer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<GeomType>("point");
  const [newCrs, setNewCrs] = useState<CoordinateSystem>(defaultCrs);
  const [draftId, setDraftId] = useState<string | null>(null);

  // Otwórz formularz i od razu utwórz aktywną warstwę roboczą.
  const openAddLayer = () => {
    if (showAddLayer) { setShowAddLayer(false); return; }
    const name = newName.trim() || typeLabel(newType);
    const id = onCreateLayer({ name, type: newType, crs: newCrs });
    setDraftId(id);
    setShowAddLayer(true);
  };

  // Zmiany w formularzu aktualizują aktywną warstwę na żywo.
  const changeDraftName = (v: string) => {
    setNewName(v);
    if (draftId) onUpdateDrawLayer(draftId, { name: v.trim() || typeLabel(newType) });
  };
  const changeDraftType = (t: GeomType) => {
    setNewType(t);
    if (draftId) onSetDrawLayerType(draftId, t);
  };
  const changeDraftCrs = (c: CoordinateSystem) => {
    setNewCrs(c);
    if (draftId) onUpdateDrawLayer(draftId, { crs: c });
  };
  const finishAddLayer = () => {
    setNewName("");
    setDraftId(null);
    setShowAddLayer(false);
  };

  // ── GPS ──
  const [gpsTarget, setGpsTarget] = useState<string>("new"); // "new" | layerId
  const [gpsName, setGpsName] = useState("");
  const [gpsType, setGpsType] = useState<GeomType>("point");
  const [gpsCrs, setGpsCrs] = useState<CoordinateSystem>(defaultCrs);
  const [gpsVertices, setGpsVertices] = useState<[number, number][]>([]);
  const [gpsHeights, setGpsHeights] = useState<(number | null)[]>([]);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsLast, setGpsLast] = useState<{ lat: number; lng: number; acc: number; alt: number | null } | null>(null);
  // Etykieta punktu: numer kolejny lub własna nazwa
  const [gpsLabelMode, setGpsLabelMode] = useState<"number" | "name">("number");
  const [gpsLabel, setGpsLabel] = useState("");

  // Gdy zmieni się domyślny układ pracy (JOB) – ustaw go jako domyślny dla nowych warstw/GPS.
  useEffect(() => { setNewCrs(defaultCrs); setGpsCrs(defaultCrs); }, [defaultCrs]);

  const targetLayer = gpsTarget !== "new" ? drawingLayers.find((l) => l.id === gpsTarget) ?? null : null;
  const effType: GeomType = targetLayer ? targetLayer.type : gpsType;

  const pointNamePrefix = () => gpsLabelMode === "name" ? (gpsLabel.trim() || "Punkt") : "Pkt";

  const ensureGpsLayer = (): string => {
    if (targetLayer) return targetLayer.id;
    const name = gpsName.trim() || `GPS ${typeLabel(gpsType)}`;
    const id = onCreateLayer({ name, type: gpsType, crs: gpsCrs });
    setGpsTarget(id);
    return id;
  };

  const readGps = async (): Promise<{ coord: [number, number]; alt: number | null } | null> => {
    setGpsBusy(true);
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
      const alt = typeof pos.coords.altitude === "number" ? pos.coords.altitude : null;
      setGpsLast({ lat, lng, acc, alt });
      // Wycentruj mapę na pomierzonym punkcie. Na telefonie przesuń go w 3/4 wysokości
      // ekranu (od dołu), by nie zasłaniało go dolne menu narzędzi.
      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      window.dispatchEvent(new CustomEvent("set-map-view", { detail: { lat, lng, zoom: 19, fracTop: isMobile ? 0.25 : undefined } }));
      return { coord: [lat, lng], alt };
    } catch (e) {
      toast.error(`Błąd GPS: ${(e as Error).message}`);
      return null;
    } finally {
      setGpsBusy(false);
    }
  };

  const measurePoint = async () => {
    const r = await readGps();
    if (!r) return;
    const id = ensureGpsLayer();
    onAddFeatureToLayer(id, [r.coord], pointNamePrefix(), [r.alt]);
    toast.success("Dodano punkt z GPS");
  };

  const addVertex = async () => {
    const r = await readGps();
    if (!r) return;
    setGpsVertices((prev) => [...prev, r.coord]);
    setGpsHeights((prev) => [...prev, r.alt]);
  };

  const finishGpsFeature = () => {
    const min = effType === "line" ? 2 : 3;
    if (gpsVertices.length < min) { toast.warning(`Potrzeba min. ${min} punktów`); return; }
    const id = ensureGpsLayer();
    onAddFeatureToLayer(id, gpsVertices, effType === "line" ? "Linia GPS" : "Poligon GPS", gpsHeights);
    setGpsVertices([]);
    setGpsHeights([]);
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

  // Warstwy zawierające zaznaczone obiekty (narzędzie strzałki/fence).
  const layersFromSelectedFeatures = useMemo(
    () => Array.from(new Set(selectedFeatures.map((s) => s.layerId))),
    [selectedFeatures]
  );

  const doExport = (format: "kml" | "dxf" | "geojson" | "txt") => {
    // W trybie "Zaznaczone": jeśli nie zaznaczono warstw checkboxami,
    // użyj warstw wynikających z zaznaczonych obiektów.
    let ids = selectedExportIds;
    if (exportScope === "selected") {
      if (selectedFeatures.length === 0) { toast.warning("Najpierw zaznacz obiekty narzędziem strzałki/ogrodzenia"); return; }
      if (ids.length === 0) ids = layersFromSelectedFeatures;
      else ids = ids.filter((id) => layersFromSelectedFeatures.includes(id));
      if (ids.length === 0) { toast.warning("Zaznaczone obiekty nie należą do wybranych warstw"); return; }
    } else if (ids.length === 0) {
      toast.warning("Zaznacz warstwy do eksportu");
      return;
    }
    onExportLayers(ids, format, exportEpsg, exportScope);
  };

  return (
    <div className="max-h-[65vh] w-full overflow-y-auto border-l bg-card p-2 md:h-full md:max-h-none md:w-72">
      {/* Uchwyt szuflady (tylko mobile) */}
      <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted md:hidden" />

      {/* ───────── JOB — prace (element nadrzędny) ───────── */}
      <div className="mb-2">
        <JobsPanel
          jobs={jobs}
          activeJobId={activeJobId}
          onCreateJob={onCreateJob}
          onSelectJob={onSelectJob}
          onSaveActiveJob={onSaveActiveJob}
          onDeleteJob={onDeleteJob}
          onExportJob={onExportJob}
          onExportAllJobs={onExportAllJobs}
          onImportJobs={onImportJobs}
        />
      </div>

      <Tabs defaultValue="draw" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="draw" className="text-xs"><PenTool className="mr-1 h-3 w-3" /> Rysowanie</TabsTrigger>
          <TabsTrigger value="gps" className="text-xs"><Satellite className="mr-1 h-3 w-3" /> GPS</TabsTrigger>
          <TabsTrigger value="export" className="text-xs"><Download className="mr-1 h-3 w-3" /> Eksport</TabsTrigger>
        </TabsList>


        {/* ───────── Rysowanie ───────── */}
        <TabsContent value="draw" className="space-y-2 pt-3">
          <Button size="sm" className="w-full" onClick={openAddLayer}>
            <Plus className="mr-1 h-3 w-3" /> Dodaj obiekt
          </Button>

          {showAddLayer && (
            <div className="space-y-2 rounded-md border p-2">
              <Input className="h-8 text-xs" placeholder="Nazwa obiektu (np. drzewo)" value={newName}
                onChange={(e) => changeDraftName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && finishAddLayer()} autoFocus />
              <div className="grid grid-cols-3 gap-1">
                {(["point", "line", "polygon"] as GeomType[]).map((t) => (
                  <Button key={t} variant={newType === t ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => changeDraftType(t)}>
                    {typeIcon(t)}<span className="ml-1">{typeLabel(t)}</span>
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Układ:</Label>
                <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                  value={newCrs} onChange={(e) => changeDraftCrs(e.target.value as CoordinateSystem)}>
                  {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Klikaj na mapie, aby rysować. Warstwa jest już aktywna.
              </p>
              <Button size="sm" className="w-full" onClick={finishAddLayer}><Check className="mr-1 h-3 w-3" /> Gotowe</Button>
            </div>
          )}

          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground">
              {activeDrawLayerId
                ? "Klikaj na mapie. Linie/poligony: dwuklik lub Zakończ. ESC = wyjście."
                : "Kliknij nazwę obiektu, aby aktywować rysowanie."}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Kliknij drugi raz w celu zakończenia warstwy.
            </p>
          </div>

          {activeDrawLayerId && drawMode !== "point" && drawingInProgressCount > 0 && (
            <Button size="sm" className="w-full" onClick={onFinishDrawing} disabled={drawingInProgressCount < (drawMode === "line" ? 2 : 3)}>
              Zakończ ({drawingInProgressCount} pkt)
            </Button>
          )}

          {drawingLayers.length === 0 && <p className="text-xs italic text-muted-foreground">Brak obiektów.</p>}

          {/* Każdy obiekt = jedna linia z liczbą rekordów po prawej. */}
          {drawingLayers.map((dl) => {
            const isActive = activeDrawLayerId === dl.id;
            const isEditing = editingLayerId === dl.id;
            return (
              <div key={dl.id} className={`flex items-center gap-1 rounded-md border px-2 py-1 ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}>
                {typeIcon(dl.type)}
                {isEditing ? (
                  <Input autoFocus defaultValue={dl.name} className="h-6 text-xs flex-1"
                    onBlur={(e) => { onRenameDrawLayer(dl.id, e.target.value || dl.name); setEditingLayerId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingLayerId(null); }} />
                ) : (
                  <span className="flex-1 cursor-pointer truncate text-xs font-medium text-foreground"
                    onClick={() => onSetActiveDrawLayer(isActive ? null : dl.id)}
                    title={`${typeLabel(dl.type)} · ${(dl.crs ?? "wgs84").toUpperCase()} — kliknij aby rysować`}>
                    {dl.name}
                  </span>
                )}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{dl.features.length}</span>
                <input type="color" value={dl.color} onChange={(e) => onChangeDrawLayerColor(dl.id, e.target.value)} className="h-5 w-5 cursor-pointer rounded border-0 p-0" title="Kolor" />
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingLayerId(dl.id)} title="Zmień nazwę"><Edit2 className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onToggleDrawLayer(dl.id)}>
                  {dl.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemoveDrawLayer(dl.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            );
          })}
        </TabsContent>

        {/* ───────── Pomiar GPS ───────── */}
        <TabsContent value="gps" className="space-y-2 pt-2">
          <div className="space-y-2 rounded-md border p-2">
            <Label className="text-xs font-semibold flex items-center gap-1"><Satellite className="h-3 w-3" /> Pomiar GPS urządzenia</Label>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Warstwa:</Label>
              <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                value={gpsTarget} onChange={(e) => { setGpsTarget(e.target.value); setGpsVertices([]); setGpsHeights([]); }}>
                <option value="new">+ Nowa warstwa</option>
                {drawingLayers.map((l) => <option key={l.id} value={l.id}>{l.name} ({typeLabel(l.type)})</option>)}
              </select>
            </div>

            {gpsTarget === "new" ? (
              <>
                <Input className="h-8 text-xs" placeholder="Nazwa nowej warstwy" value={gpsName} onChange={(e) => setGpsName(e.target.value)} />
                <div className="grid grid-cols-3 gap-1">
                  {(["point", "line", "polygon"] as GeomType[]).map((t) => (
                    <Button key={t} variant={gpsType === t ? "default" : "outline"} size="sm" className="text-[10px]" onClick={() => { setGpsType(t); setGpsVertices([]); setGpsHeights([]); }}>
                      {typeIcon(t)}<span className="ml-1">{typeLabel(t)}</span>
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">Typ z warstwy: <b>{typeLabel(effType)}</b> · {(targetLayer?.crs ?? "wgs84").toUpperCase()}</p>
            )}

            {/* Układ współrzędnych – zawsze dostępny (PL: 1992 / 2000) */}
            {gpsTarget === "new" && (
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Układ:</Label>
                <select className="flex-1 h-7 text-xs rounded border bg-background px-1"
                  value={gpsCrs} onChange={(e) => setGpsCrs(e.target.value as CoordinateSystem)}>
                  {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}

            {/* Punkt: kompaktowy wybór etykiety + pomiar w jednej linii */}
            {effType === "point" ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Button variant={gpsLabelMode === "number" ? "default" : "outline"} size="sm" className="h-7 px-2 text-[10px]" onClick={() => setGpsLabelMode("number")}>Nr</Button>
                  <Button variant={gpsLabelMode === "name" ? "default" : "outline"} size="sm" className="h-7 px-2 text-[10px]" onClick={() => setGpsLabelMode("name")}>Nazwa</Button>
                  {gpsLabelMode === "name" && (
                    <Input className="h-7 text-xs flex-1 min-w-0" placeholder="Nazwa" value={gpsLabel} onChange={(e) => setGpsLabel(e.target.value)} />
                  )}
                  <Button size="sm" className="h-7 flex-1 bg-blue-600 text-white hover:bg-blue-700 text-[11px]" disabled={gpsBusy} onClick={measurePoint}>
                    <Crosshair className="mr-1 h-3 w-3" /> {gpsBusy ? "Pomiar…" : "Pomierz punkt"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Button size="sm" variant="outline" className="w-full" disabled={gpsBusy} onClick={addVertex}>
                  <MapPin className="mr-1 h-3 w-3" /> {gpsBusy ? "Pomiar…" : `Dodaj punkt (${gpsVertices.length})`}
                </Button>
                <Button size="sm" className="w-full" disabled={gpsVertices.length < (effType === "line" ? 2 : 3)} onClick={finishGpsFeature}>
                  <Check className="mr-1 h-3 w-3" /> Zakończ obiekt
                </Button>
                {gpsVertices.length > 0 && (
                  <Button size="sm" variant="ghost" className="w-full text-[10px]" onClick={() => { setGpsVertices([]); setGpsHeights([]); }}>Wyczyść punkty</Button>
                )}
              </div>
            )}

            {gpsLast && (() => {
              const effCrs: CoordinateSystem = (targetLayer?.crs as CoordinateSystem) ?? gpsCrs;
              const c = formatCoordinates(gpsLast.lat, gpsLast.lng, effCrs);
              return (
                <div className="rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground">
                  <div className="font-semibold text-foreground">{c.label}</div>
                  <div>{c.line1}</div>
                  <div>{c.line2}</div>
                  <div>± {gpsLast.acc.toFixed(1)} m{gpsLast.alt !== null ? ` · H ${gpsLast.alt.toFixed(1)} m` : ""}</div>
                </div>
              );
            })()}
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
