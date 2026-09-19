"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionJson, PatientJson, UserJson } from "@/lib/workflow";
import { computeView, isVisibleTo } from "@/lib/workflow";
import { fmtMinutes, fmtTime } from "@/lib/format";

interface DischargedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: UserJson | null;
  /** Total discharged count for the header line (from the board stats). */
  dischargedTotal: number;
  /** Opens the shared patient drawer with the full audit trail. */
  onOpenPatient: (patient: PatientJson, actions: ActionJson[]) => void;
}

function floorBadgeCls(floor: number): string {
  const FLOOR_BADGE = [
    "bg-emerald-100 text-emerald-800",
    "bg-sky-100 text-sky-800",
    "bg-violet-100 text-violet-800",
    "bg-amber-100 text-amber-800",
  ];
  return FLOOR_BADGE[(floor - 1 + FLOOR_BADGE.length * 8) % FLOOR_BADGE.length];
}

/**
 * Discharged patients — listed via the header Discharged button instead of a
 * board column. Shows every departed patient with its discharge data (total
 * pipeline time, before-noon flag, mini stage timeline); clicking a row opens
 * the patient drawer with the complete audit trail. Rows are scoped to the
 * acting user's visibility, exactly like the live board.
 */
export function DischargedDialog({
  open,
  onOpenChange,
  currentUser,
  dischargedTotal,
  onOpenPatient,
}: DischargedDialogProps) {
  const [patients, setPatients] = useState<PatientJson[] | null>(null);
  const [actions, setActions] = useState<ActionJson[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/patients?scope=discharged", { cache: "no-store" });
        if (!res.ok) throw new Error(`Patients API ${res.status}`);
        const data = (await res.json()) as { patients: PatientJson[]; actions: ActionJson[] };
        if (cancelled) return;
        setPatients(data.patients);
        setActions(data.actions);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load discharged patients");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const [now] = useState(() => new Date());
  const rows = useMemo(() => {
    if (!patients || !currentUser) return [];
    const views = patients.map((p) => computeView(p, now));
    let list = views.filter((v) => isVisibleTo(currentUser, v));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.mrn.toLowerCase().includes(q) ||
          v.room.toLowerCase().includes(q) ||
          v.doctorName.toLowerCase().includes(q)
      );
    }
    return list; // already newest-departure-first from the API
  }, [patients, currentUser, search, now]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Discharged patients
          </DialogTitle>
          <DialogDescription>
            Every patient who has physically left the unit, with the discharge data — the board
            itself now shows only the live pipeline. Click a row for the full audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, MRN, room or doctor"
            className="h-9 pl-8"
            aria-label="Search discharged patients"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && <p className="px-1 py-4 text-xs text-rose-600">{error}</p>}
          {!error && patients === null && (
            <div className="space-y-2 px-1 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {patients !== null && rows.length === 0 && !error && (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              No discharged patients in your view{search ? " matching the search" : ""}.
            </p>
          )}
          <div className="space-y-2">
            {rows.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenPatient(v, actions);
                }}
                className="w-full rounded-lg border border-slate-200 border-l-4 border-l-emerald-400 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md"
                aria-label={`Discharged patient ${v.name}, MRN ${v.mrn}, room ${v.room}`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${floorBadgeCls(v.floor)}`}
                    title={`Room ${v.room} — floor ${v.floor}`}
                  >
                    {v.room}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{v.name}</span>
                  {v.departedBeforeNoon && (
                    <Badge variant="secondary" className="border-0 bg-emerald-100 text-[10px] text-emerald-700">
                      Before noon
                    </Badge>
                  )}
                  {v.completedToday && (
                    <Badge variant="secondary" className="border-0 bg-sky-100 text-[10px] text-sky-700">
                      Today
                    </Badge>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-500">
                    Left {fmtTime(v.physicalDischargedAt)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">
                  MRN {v.mrn} · {v.doctorName} ({v.doctorSpecialty})
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                    {v.totalMinutes !== null ? `total ${fmtMinutes(v.totalMinutes)}` : "total —"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>MD {fmtTime(v.medicalReadyAt)}</span>
                  <span aria-hidden="true">→</span>
                  <span>Email {fmtTime(v.financeNotifiedAt)}</span>
                  <span aria-hidden="true">→</span>
                  <span>Fin {fmtTime(v.financeClearedAt)}</span>
                  <span aria-hidden="true">→</span>
                  <span>Papers {fmtTime(v.receptionReadyAt)}</span>
                  <span aria-hidden="true">→</span>
                  <span>Departed {fmtTime(v.physicalDischargedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>
            {rows.length} shown{patients && rows.length < patients.length ? ` of ${patients.length}` : ""}
          </span>
          <span>{dischargedTotal} discharged in total</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
