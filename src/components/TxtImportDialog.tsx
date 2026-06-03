import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CoordinateSystem } from "@/lib/coordinateUtils";
import { TxtDelimiter, TxtImportOptions } from "@/lib/vectorImportExport";

interface TxtImportDialogProps {
  name: string;
  text: string;
  onConfirm: (opts: TxtImportOptions) => void;
  onCancel: () => void;
}

const CRS_OPTIONS: { value: CoordinateSystem; label: string }[] = [
  { value: "puwg1992", label: "PUWG 1992" },
  { value: "puwg2000", label: "PUWG 2000 (strefa auto)" },
  { value: "wgs84", label: "WGS 84 (stopnie)" },
];

const DELIMS: { value: TxtDelimiter; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "space", label: "Spacja" },
  { value: "tab", label: "Tabulator" },
  { value: "semicolon", label: "Średnik ;" },
  { value: "comma", label: "Przecinek ," },
];

function split(line: string, d: TxtDelimiter): string[] {
  switch (d) {
    case "tab": return line.split("\t");
    case "semicolon": return line.split(";");
    case "comma": return line.split(",");
    case "space": return line.split(/\s+/).filter(Boolean);
    default: {
      const p = line.split(/[\t;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      return p.length >= 2 ? p : line.split(/[\s,]+/).filter(Boolean);
    }
  }
}

const TxtImportDialog = ({ name, text, onConfirm, onCancel }: TxtImportDialogProps) => {
  const [crs, setCrs] = useState<CoordinateSystem>("puwg1992");
  const [delimiter, setDelimiter] = useState<TxtDelimiter>("auto");
  const [startLine, setStartLine] = useState(1);
  const [colX, setColX] = useState(2);
  const [colY, setColY] = useState(3);
  const [colH, setColH] = useState(4);
  const [colName, setColName] = useState(1);
  const [colCode, setColCode] = useState(0);

  const rawLines = useMemo(() => text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6), [text]);
  const previewRows = useMemo(() => rawLines.map((l) => split(l.trim(), delimiter)), [rawLines, delimiter]);
  const maxCols = useMemo(() => Math.max(1, ...previewRows.map((r) => r.length)), [previewRows]);

  const confirm = () => {
    onConfirm({
      crs, delimiter, startLine,
      colX, colY,
      colH: colH > 0 ? colH : undefined,
      colName: colName > 0 ? colName : undefined,
      colCode: colCode > 0 ? colCode : undefined,
    });
  };

  const NumField = ({ label, value, set, allowZero }: { label: string; value: number; set: (n: number) => void; allowZero?: boolean }) => (
    <div className="space-y-0.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input type="number" min={allowZero ? 0 : 1} className="h-7 text-xs" value={value}
        onChange={(e) => set(parseInt(e.target.value, 10) || (allowZero ? 0 : 1))} />
    </div>
  );

  return (
    <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-lg border bg-card p-4 shadow-xl">
        <h3 className="text-sm font-bold text-foreground">Import TXT: {name}</h3>

        {/* Podgląd */}
        <div className="overflow-x-auto rounded border bg-background">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                {Array.from({ length: maxCols }).map((_, i) => (
                  <th key={i} className="px-2 py-0.5 text-left">kol {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, ri) => (
                <tr key={ri} className={ri + 1 < startLine ? "opacity-40" : ""}>
                  {Array.from({ length: maxCols }).map((_, ci) => (
                    <td key={ci} className="px-2 py-0.5 text-foreground whitespace-nowrap">{r[ci] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] text-muted-foreground">Układ współrzędnych</Label>
            <select className="h-7 w-full rounded border bg-background px-1 text-xs"
              value={crs} onChange={(e) => setCrs(e.target.value as CoordinateSystem)}>
              {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] text-muted-foreground">Separator</Label>
            <select className="h-7 w-full rounded border bg-background px-1 text-xs"
              value={delimiter} onChange={(e) => setDelimiter(e.target.value as TxtDelimiter)}>
              {DELIMS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <NumField label="Pierwsza linia danych" value={startLine} set={setStartLine} />
          <NumField label="Kolumna X (płn.)" value={colX} set={setColX} />
          <NumField label="Kolumna Y (wsch.)" value={colY} set={setColY} />
          <NumField label="Kolumna H (0=brak)" value={colH} set={setColH} allowZero />
          <NumField label="Kolumna nazwa (0=brak)" value={colName} set={setColName} allowZero />
          <NumField label="Kolumna kod (0=brak)" value={colCode} set={setColCode} allowZero />
        </div>

        <p className="text-[10px] text-muted-foreground">
          X = współrzędna północna (geodezyjna X / szerokość), Y = wschodnia (Y / długość).
        </p>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={confirm}>Importuj</Button>
          <Button variant="outline" onClick={onCancel}>Anuluj</Button>
        </div>
      </div>
    </div>
  );
};

export default TxtImportDialog;
