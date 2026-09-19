"use client";

import { AlertTriangle, CheckCircle2, Timer, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PatientView } from "@/lib/workflow";
import { STAGES, STAGE_TARGETS, TOTAL_TARGET_MIN } from "@/lib/workflow";
import { fmtMinutes, fmtPct } from "@/lib/format";

interface KpiBarProps {
  views: PatientView[]; // active (in-pipeline) patients only
  dischargedToday: number;
  dischargedTodayBeforeNoon: number;
  medianTotalRecent: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function KpiBar({
  views,
  dischargedToday,
  dischargedTodayBeforeNoon,
  medianTotalRecent,
}: KpiBarProps) {
  const inPipeline = views;
  const flagged = inPipeline.filter((v) => v.flag === "warn" || v.flag === "late");
  const medTotal = medianTotalRecent ?? median(inPipeline.map((v) => v.totalMinutes).filter((t): t is number => t !== null));

  const kpis = [
    {
      icon: Timer,
      label: "In pipeline",
      value: String(inPipeline.length),
      sub: `${views.length} patient${views.length === 1 ? "" : "s"} in scope`,
    },
    {
      icon: AlertTriangle,
      label: "Over draft targets",
      value: String(flagged.length),
      sub: flagged.length
        ? flagged.map((f) => `${STAGES[f.stage - 1].short}:${fmtMinutes(f.minutesInStage)}`).slice(0, 3).join(" · ")
        : "none flagged",
      tone: flagged.length ? "text-amber-700" : "text-slate-900",
    },
    {
      icon: CheckCircle2,
      label: "Discharged today",
      value: `${dischargedToday}`,
      sub: dischargedToday
        ? `${dischargedTodayBeforeNoon} before noon (${fmtPct(
            dischargedTodayBeforeNoon / dischargedToday
          )}) — target ~30%`
        : "none yet today",
    },
    {
      icon: TrendingUp,
      label: "Median total time",
      value: medTotal !== null ? fmtMinutes(medTotal) : "—",
      sub: `medical clearance → departure · 7-day discharged · target ≤ ${fmtMinutes(TOTAL_TARGET_MIN)}`,
    },
  ];

  return (
    <section aria-label="Discharge KPIs" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="shadow-sm">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {kpi.label}
                  </div>
                  <Icon className="h-4 w-4 text-slate-300" aria-hidden="true" />
                </div>
                <div className={`mt-1 text-xl font-bold tabular-nums md:text-2xl ${kpi.tone ?? "text-slate-900"}`}>
                  {kpi.value}
                </div>
                <div className="truncate text-[11px] text-slate-400" title={kpi.sub}>
                  {kpi.sub}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">
        Stage targets:{" "}
        {STAGES.slice(0, 5)
          .map((s) => `${s.short} ${fmtMinutes(STAGE_TARGETS[s.num].targetMin)}`)
          .join(" · ")}
        {" — "}draft values pending calibration against your real timestamps.
      </p>
    </section>
  );
}
