import { CoordinateSystem } from "./coordinateUtils";
import { DrawingLayer } from "@/types/drawing";
import { KmlLayer } from "@/types/photo";

/** Dane robocze zapisywane w obrębie pojedynczej pracy (JOB). */
export interface JobSnapshot {
  drawingLayers: DrawingLayer[];
  kmlLayers: KmlLayer[];
}

/** Pojedyncza praca (projekt). Element nadrzędny zarządzania danymi. */
export interface Job {
  id: string;
  name: string;
  /** Domyślny układ współrzędnych pracy – staje się domyślny dla całej aplikacji. */
  crs: CoordinateSystem;
  /** Przybliżona lokalizacja na mapie, do której skacze widok po wybraniu pracy. */
  center?: { lat: number; lng: number; zoom?: number };
  createdAt: number;
  updatedAt: number;
  data: JobSnapshot;
}

const KEY = "fotkapaw.jobs.v1";
const FILE_TAG = "fotkapaw-jobs";

const emptySnapshot = (): JobSnapshot => ({ drawingLayers: [], kmlLayers: [] });

export function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((j) => j && typeof j.id === "string");
  } catch {
    return [];
  }
}

export function saveJobs(jobs: Job[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* np. quota exceeded – ignorujemy, użytkownik może eksportować do pliku */
  }
}

export function createJob(name: string, crs: CoordinateSystem, center?: Job["center"]): Job {
  const now = Date.now();
  return {
    id: `job-${now}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Nowa praca",
    crs,
    center,
    createdAt: now,
    updatedAt: now,
    data: emptySnapshot(),
  };
}

/** Eksportuje pojedynczą pracę do pliku JSON (do zapisu na serwerze/dysku). */
export function exportJobToFile(job: Job): void {
  const payload = { tag: FILE_TAG, version: 1, jobs: [job] };
  downloadJson(payload, `${slug(job.name)}.job.json`);
}

/** Eksportuje całą bazę prac do jednego pliku JSON. */
export function exportAllJobsToFile(jobs: Job[]): void {
  const payload = { tag: FILE_TAG, version: 1, jobs };
  downloadJson(payload, `baza-prac-${new Date().toISOString().slice(0, 10)}.json`);
}

/** Wczytuje prace z pliku JSON. Akceptuje pojedynczą pracę lub całą bazę. */
export function parseJobsFile(text: string): Job[] {
  const data = JSON.parse(text);
  const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : data?.id ? [data] : [];
  const now = Date.now();
  return arr
    .filter((j) => j && typeof j === "object")
    .map((j, i) => ({
      id: typeof j.id === "string" ? j.id : `job-${now}-${i}`,
      name: typeof j.name === "string" ? j.name : `Praca ${i + 1}`,
      crs: (j.crs as CoordinateSystem) ?? "puwg1992",
      center: j.center,
      createdAt: typeof j.createdAt === "number" ? j.createdAt : now,
      updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : now,
      data: {
        drawingLayers: Array.isArray(j.data?.drawingLayers) ? j.data.drawingLayers : [],
        kmlLayers: Array.isArray(j.data?.kmlLayers) ? j.data.kmlLayers : [],
      },
    }));
}

function slug(name: string): string {
  return name.trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "") || "praca";
}

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
