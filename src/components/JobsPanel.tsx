import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Briefcase, Plus, Save, Upload, Download, Trash2, Check, MapPin } from "lucide-react";
import { CoordinateSystem } from "@/lib/coordinateUtils";
import { Job } from "@/lib/jobsStore";

const CRS_OPTIONS: { value: CoordinateSystem; label: string }[] = [
  { value: "puwg1992", label: "PUWG 1992" },
  { value: "puwg2000", label: "PUWG 2000" },
  { value: "wgs84", label: "WGS 84" },
];

interface JobsPanelProps {
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

const JobsPanel = ({
  jobs, activeJobId, onCreateJob, onSelectJob, onSaveActiveJob,
  onDeleteJob, onExportJob, onExportAllJobs, onImportJobs,
}: JobsPanelProps) => {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [crs, setCrs] = useState<CoordinateSystem>("puwg1992");
  const fileRef = useRef<HTMLInputElement>(null);

  const add = () => {
    onCreateJob(name, crs);
    setName("");
    setShowAdd(false);
  };

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <Briefcase className="h-3.5 w-3.5 text-primary" />
        <Label className="flex-1 text-xs font-semibold">JOB — prace</Label>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Importuj prace z pliku" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
        </Button>
        {jobs.length > 0 && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Eksportuj całą bazę prac" onClick={onExportAllJobs}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Nowa praca" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <input ref={fileRef} type="file" accept=".json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportJobs(f); e.target.value = ""; }} />
      </div>

      {showAdd && (
        <div className="space-y-1.5 rounded border bg-background p-2">
          <Input className="h-7 text-xs" placeholder="Nazwa pracy" value={name} autoFocus
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap text-[10px] text-muted-foreground">Układ:</Label>
            <select className="h-7 flex-1 rounded border bg-background px-1 text-xs"
              value={crs} onChange={(e) => setCrs(e.target.value as CoordinateSystem)}>
              {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Button size="sm" className="h-7 w-full text-xs" onClick={add}><Check className="mr-1 h-3 w-3" /> Utwórz</Button>
        </div>
      )}

      {jobs.length === 0 && !showAdd && (
        <p className="text-[10px] italic text-muted-foreground">Brak prac. Dodaj nową lub zaimportuj plik.</p>
      )}

      {jobs.map((job) => {
        const isActive = job.id === activeJobId;
        return (
          <div key={job.id} className={`flex items-center gap-1 rounded border px-2 py-1 ${isActive ? "border-primary ring-1 ring-primary/40" : ""}`}>
            <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => onSelectJob(job.id)} title="Wczytaj pracę i ustaw mapę">
              {job.center ? <MapPin className="h-3 w-3 shrink-0 text-primary" /> : <Briefcase className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate text-xs font-medium text-foreground">{job.name}</span>
            </button>
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-muted-foreground">{job.crs.toUpperCase()}</span>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Eksportuj pracę" onClick={() => onExportJob(job.id)}><Download className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Usuń pracę" onClick={() => onDeleteJob(job.id)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        );
      })}

      {activeJob && (
        <Button size="sm" className="h-7 w-full bg-blue-600 text-[11px] text-white hover:bg-blue-700" onClick={onSaveActiveJob}>
          <Save className="mr-1 h-3 w-3" /> Zapisz pracę „{activeJob.name}”
        </Button>
      )}
    </div>
  );
};

export default JobsPanel;
