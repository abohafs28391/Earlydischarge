"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, FlaskConical, Loader2, ScrollText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { ActionJson, PatientJson, UserJson } from "@/lib/workflow";
import { ACTION_LABELS, ROLE_LABELS, type ActionType } from "@/lib/workflow";
import { fmtDateTime } from "@/lib/format";

interface DataSectionProps {
  admin: UserJson;
  patients: PatientJson[] | null;
  onBoardDataChange: (payload: { patients: PatientJson[]; actions: ActionJson[] }) => void;
}

interface AuditRow extends ActionJson {
  patientName: string | null;
  patientMrn: string | null;
  patientRoom: string | null;
}

const RECENT_ACTION_TYPES: ActionType[] = [
  "IMPORTED",
  "MEDICAL_DECIDED_DISCHARGE",
  "MEDICAL_DECIDED_NO",
  "MEDICAL_UNDO",
  "MEDICAL_READY",
  "COPY_TEMPLATE",
  "FINANCE_NOTIFIED",
  "FINANCE_CLEARED",
  "RECEPTION_READY",
  "PHYSICAL_DISCHARGED",
  "COPY_CANCEL_TEMPLATE",
  "CANCEL_DISCHARGE",
];

/** Admin > Data & audit: demo dataset controls and the hospital-wide audit
 *  trail (who did what, and when — every logged step). */
export function DataSection({ admin, patients, onBoardDataChange }: DataSectionProps) {
  const { toast } = useToast();
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch(`/api/audit?userId=${admin.id}&limit=80`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Audit API ${res.status}`);
      const data = (await res.json()) as { actions: AuditRow[] };
      setAudit(data.actions);
    } catch {
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, [admin.id]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const run = useCallback(
    async (key: string, url: string, method: string, successTitle: string, successDesc?: string) => {
      setBusy(key);
      try {
        const res = await fetch(url, { method });
        const data = (await res.json().catch(() => ({}))) as {
          patients?: PatientJson[];
          actions?: ActionJson[];
          created?: { today: number; history: number };
          error?: string;
        };
        if (!res.ok) {
          toast({ title: "Rejected", description: data.error, variant: "destructive" });
          return;
        }
        if (data.patients && data.actions)
          onBoardDataChange({ patients: data.patients, actions: data.actions });
        toast({
          title: successTitle,
          description:
            successDesc ??
            (data.created
              ? `${data.created.today} on today's board + ${data.created.history} discharged over the past 30 days`
              : undefined),
        });
      } catch {
        toast({ title: "Action failed", variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [onBoardDataChange, toast]
  );

  const demoCount = patients?.filter((p) => p.isDemo).length ?? 0;
  const realCount = patients?.filter((p) => !p.isDemo).length ?? 0;

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-800">Patient data</h2>
            <span className="text-[10px] text-slate-400">
              {realCount} imported · {demoCount} demo on the board
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            The demo dataset covers today&rsquo;s board across every stage (some intentionally over
            target so alarms fire) plus a 30-day discharged history that feeds the Analysis tab.
            Real imported rows are never touched by demo controls.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-teal-600 hover:bg-teal-700"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "demo-load",
                  `/api/patients/demo?userId=${admin.id}`,
                  "POST",
                  "Demo dataset loaded"
                )
              }
            >
              {busy === "demo-load" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Load demo dataset
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              disabled={busy !== null || demoCount === 0}
              onClick={() =>
                run("demo-clear", `/api/patients/demo?userId=${admin.id}`, "DELETE", "Demo patients removed", "Imported data untouched.")
              }
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove demo patients
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-rose-600 hover:text-rose-700"
              disabled={busy !== null || (realCount === 0 && demoCount === 0)}
              onClick={() =>
                run(
                  "all-clear",
                  `/api/patients?userId=${admin.id}`,
                  "DELETE",
                  "All patients cleared",
                  "The audit trail and notifications were cleared too."
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear ALL patients
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-800">Audit trail — hospital-wide</h2>
            </div>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={loadAudit}>
              Refresh
            </Button>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Every logged step across all patients — {RECENT_ACTION_TYPES.length} step types, each
            with its timestamp and the user who completed it.
          </p>
          <div className="mt-3 max-h-96 overflow-y-auto">
            {auditLoading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading audit trail…
              </div>
            ) : !audit || audit.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                Nothing logged yet — import a list or load the demo dataset.
              </p>
            ) : (
              <table className="w-full min-w-[560px] text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-3 font-medium">When</th>
                    <th className="px-2 py-1.5 font-medium">Step</th>
                    <th className="px-2 py-1.5 font-medium">Patient</th>
                    <th className="py-1.5 pl-3 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-slate-500">
                        {fmtDateTime(a.createdAt)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant="secondary"
                          className="border-0 bg-slate-100 text-[10px] text-slate-600"
                        >
                          {ACTION_LABELS[a.type] ?? a.type}
                        </Badge>
                      </td>
                      <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-600">
                        {a.patientName ?? "—"}
                        <span className="ml-1 text-[10px] text-slate-400">
                          {a.patientRoom ? `· ${a.patientRoom}` : ""}
                        </span>
                      </td>
                      <td className="py-1.5 pl-3 text-slate-600">
                        {a.userName}
                        <span className="ml-1 text-[10px] text-slate-400">
                          {a.userRole ? `· ${ROLE_LABELS[a.userRole]}` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
