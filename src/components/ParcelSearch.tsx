import { useMemo, useState } from "react";
import { Search, MapPin, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import tercData from "@/data/terc.json";

interface Commune { code: string; name: string; }
interface County { code: string; name: string; communes: Commune[]; }
interface Voivodeship { code: string; name: string; counties: County[]; }

const TERC = tercData as Voivodeship[];

export interface ParcelResult {
  geojson: any; // GeoJSON FeatureCollection (WGS84)
  label: string;
}

interface ParcelSearchProps {
  onParcelFound: (result: ParcelResult) => void;
}

/** Zamienia WKT (POLYGON/MULTIPOLYGON, opcjonalny prefiks SRID=...;) na geometrię GeoJSON. */
function wktToGeoJson(wkt: string): any | null {
  let s = wkt.trim();
  s = s.replace(/^SRID=\d+;/i, "").trim();
  const parseRings = (txt: string): number[][][] => {
    const rings: number[][][] = [];
    const ringRe = /\(([^()]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = ringRe.exec(txt))) {
      const coords = m[1].split(",").map((pair) => {
        const [x, y] = pair.trim().split(/\s+/).map(Number);
        return [x, y]; // WGS84: lon lat
      });
      rings.push(coords);
    }
    return rings;
  };
  if (/^POLYGON/i.test(s)) {
    const body = s.replace(/^POLYGON\s*/i, "");
    return { type: "Polygon", coordinates: parseRings(body) };
  }
  if (/^MULTIPOLYGON/i.test(s)) {
    // rozdziel na poszczególne poligony po "))," 
    const inner = s.replace(/^MULTIPOLYGON\s*\(/i, "").replace(/\)\s*$/, "");
    const polys = inner.split(/\)\s*\)\s*,\s*\(\s*\(/).map((p, i, arr) => {
      let t = p;
      if (i > 0) t = "((" + t;
      if (i < arr.length - 1) t = t + "))";
      return t;
    });
    const coordinates = polys.map((p) => parseRings(p));
    return { type: "MultiPolygon", coordinates };
  }
  return null;
}

/** Zapytanie do usługi ULDK GUGiK; zwraca geometrię GeoJSON + etykietę. */
async function queryUldk(request: string, id: string): Promise<ParcelResult | null> {
  const url = `https://uldk.gugik.gov.pl/?request=${request}&id=${encodeURIComponent(id)}&result=geom_wkt,teryt&srid=4326`;
  const res = await fetch(url);
  const text = await res.text();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const status = lines[0];
  // status "0" oznacza sukces; w GetParcelByIdOrNr pierwsza linia to liczba wyników
  const dataLines = /^\d+$/.test(status) ? lines.slice(1) : lines;
  if (!dataLines.length) return null;
  const first = dataLines[0];
  const parts = first.split("|");
  const wkt = parts[0];
  const teryt = parts[1] ?? id;
  const geom = wktToGeoJson(wkt);
  if (!geom) return null;
  return {
    label: teryt,
    geojson: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { teryt, name: teryt }, geometry: geom }],
    },
  };
}

const ParcelSearch = ({ onParcelFound }: ParcelSearchProps) => {
  const [loading, setLoading] = useState(false);

  // Tryb 1: pełny identyfikator / KERG
  const [idQuery, setIdQuery] = useState("");

  // Tryb 2: wybór jednostek
  const [wojCode, setWojCode] = useState("");
  const [powCode, setPowCode] = useState("");
  const [gmiCode, setGmiCode] = useState("");
  const [obreb, setObreb] = useState("");
  const [dzialka, setDzialka] = useState("");

  const counties = useMemo(() => TERC.find((w) => w.code === wojCode)?.counties ?? [], [wojCode]);
  const communes = useMemo(() => counties.find((c) => c.code === powCode)?.communes ?? [], [counties, powCode]);

  const runSearch = async (fn: () => Promise<ParcelResult | null>) => {
    setLoading(true);
    try {
      const result = await fn();
      if (result) {
        onParcelFound(result);
        toast.success(`Znaleziono działkę: ${result.label}`);
      } else {
        toast.error("Nie znaleziono działki dla podanych danych.");
      }
    } catch {
      toast.error("Błąd połączenia z usługą ULDK (GUGiK).");
    } finally {
      setLoading(false);
    }
  };

  const searchById = () => {
    const q = idQuery.trim();
    if (!q) return;
    // Pełny identyfikator TERYT vs. "Nazwa numer" -> GetParcelByIdOrNr obsługuje oba
    runSearch(() => queryUldk("GetParcelByIdOrNr", q));
  };

  const searchByUnits = () => {
    if (!gmiCode || !obreb.trim() || !dzialka.trim()) {
      toast.warning("Wybierz gminę oraz podaj numer obrębu i działki.");
      return;
    }
    // gmina TERC = WWPPGGR (7 znaków) -> identyfikator działki: WWPPGG_R.OOOO.NR
    const gmPart = `${gmiCode.slice(0, 6)}_${gmiCode.slice(6)}`;
    const obrPart = obreb.trim().padStart(4, "0");
    const id = `${gmPart}.${obrPart}.${dzialka.trim()}`;
    runSearch(async () => (await queryUldk("GetParcelById", id)) ?? (await queryUldk("GetParcelByIdOrNr", id)));
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" /> Wyszukiwarka działek (ULDK)
      </div>
      <Tabs defaultValue="id">
        <TabsList className="grid h-8 w-full grid-cols-2">
          <TabsTrigger value="id" className="text-[11px]">Identyfikator / KERG</TabsTrigger>
          <TabsTrigger value="units" className="text-[11px]">Wybór jednostek</TabsTrigger>
        </TabsList>

        <TabsContent value="id" className="mt-2 space-y-1.5">
          <p className="text-[10px] leading-tight text-muted-foreground">
            Pełny TERYT (np. <span className="font-mono">141201_1.0001.6509</span>) lub nazwa obrębu i numer (np. <span className="font-mono">Krzewina 134</span>).
          </p>
          <div className="flex gap-1">
            <Input
              placeholder="Identyfikator działki…"
              value={idQuery}
              onChange={(e) => setIdQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchById()}
              className="h-8 text-xs font-mono"
            />
            <Button variant="outline" size="sm" onClick={searchById} disabled={loading} className="h-8 px-2">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="units" className="mt-2 space-y-1.5">
          <Select value={wojCode} onValueChange={(v) => { setWojCode(v); setPowCode(""); setGmiCode(""); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Województwo" /></SelectTrigger>
            <SelectContent className="z-[2000] max-h-64">
              {TERC.map((w) => <SelectItem key={w.code} value={w.code} className="text-xs">{w.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={powCode} onValueChange={(v) => { setPowCode(v); setGmiCode(""); }} disabled={!wojCode}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Powiat" /></SelectTrigger>
            <SelectContent className="z-[2000] max-h-64">
              {counties.map((c) => <SelectItem key={c.code} value={c.code} className="text-xs">{c.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={gmiCode} onValueChange={setGmiCode} disabled={!powCode}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Gmina" /></SelectTrigger>
            <SelectContent className="z-[2000] max-h-64">
              {communes.map((g) => <SelectItem key={g.code} value={g.code} className="text-xs">{g.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex gap-1">
            <Input placeholder="Nr obrębu" value={obreb} onChange={(e) => setObreb(e.target.value)}
              className="h-8 w-24 text-xs font-mono" />
            <Input placeholder="Nr działki" value={dzialka} onChange={(e) => setDzialka(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchByUnits()}
              className="h-8 flex-1 text-xs font-mono" />
            <Button variant="outline" size="sm" onClick={searchByUnits} disabled={loading} className="h-8 px-2">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ParcelSearch;
