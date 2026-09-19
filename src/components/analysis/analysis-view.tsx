"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisResult } from "@/lib/analysis";
import type { UserJson } from "@/lib/workflow";
import { TOTAL_TARGET_MIN } from "@/lib/workflow";
import { fmtMinutes, fmtPct } from "@/lib/format";

interface AnalysisViewProps {
  currentUser: UserJson | null;
}

type RangeMode = "today" | "7d" | "30d" | "custom";

const RANGE_OPTIONS: Array<{ value: RangeMode; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

function rangeToDates(mode: RangeMode, customFrom: string, customTo: string) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  switch (mode) {
    case "today":
      return { from, to };
    case "7d":
      from.setDate(from.getDate() - 6);
      return { from, to };
    case "30d":
      from.setDate(from.getDate() - 29);
      return { from, to };
    case "custom": {
      const f = customFrom ? new Date(`${customFrom}T00:00:00`) : from;
      const t = customTo ? new Date(`${customTo}T23:59:59`) : to;
      return { from: f > t ? t : f, to: f > t ? f : t };
    }
  }
}

function pctTone(pct: number): string {
  if (pct >= 0.25) return "bg-rose-500";
  if (pct >= 0.1) return "bg-amber-500";
  return "bg-teal-500";
}

function pctTextTone(pct: number): string {
  if (pct >= 0.25) return "text-rose-700";
  if (pct >= 0.1) return "text-amber-700";
  return "text-teal-700";
}

function fmtPctCell(pct: number, entered: number): string {
  return entered === 0 ? "—" : fmtPct(pct);
}

function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AnalysisView({ currentUser }: AnalysisViewProps) {
  const [mode, setMode] = useState<RangeMode>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(
    () => rangeToDates(mode, customFrom, customTo),
    [mode, customFrom, customTo]
  );

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (currentUser) params.set("userId", currentUser.id);
      const res = await fetch(`/api/analysis?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Analysis API ${res.status}`);
      const json = (await res.json()) as AnalysisResult;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to compute analysis");
    } finally {
      setLoading(false);
    }
  }, [from, to, currentUser]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const maxDaily = useMemo(
    () => (data ? Math.max(1, ...data.daily.map((d) => Math.max(d.imported, d.discharged))) : 1),
    [data]
  );

  const maxTat = useMemo(() => {
    if (!data) return 1;
    const medians = data.stages.map((s) => s.tatMedian ?? 0);
    const targets = data.stages.map((s) => s.targetMin);
    return Math.max(1, ...medians, ...targets);
  }, [data]);

  const scopeNote =
    currentUser?.role === "NURSE"
      ? `Scoped to Floor${currentUser.floors.length > 1 ? "s " + currentUser.floors.join(", ") : " " + (currentUser.floors[0] ?? "—")} — your board visibility.`
      : currentUser?.role === "FINANCE"
        ? "Scoped to patients that reached the financial stage."
        : currentUser?.role === "RECEPTION"
          ? "Scoped to patients that were financially cleared."
          : currentUser?.role === "PHYSICIAN"
            ? `Scoped to ${currentUser.specialty} patients — your specialty visibility.`
            : "Hospital-wide — all floors and specialties.";

  return (
    <div className="space-y-4">
      {/* Duration selector */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <div
          className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
          role="group"
          aria-label="Analysis duration"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setMode(opt.value);
                if (opt.value === "custom" && !customFrom && !customTo) {
                  const f = new Date();
                  f.setDate(f.getDate() - 13);
                  setCustomFrom(toISODate(f));
                  setCustomTo(toISODate(new Date()));
                }
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === opt.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              aria-pressed={mode === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {mode === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-9 w-[140px] bg-white text-xs"
              aria-label="From date"
            />
            <span className="text-xs text-slate-400">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-9 w-[140px] bg-white text-xs"
              aria-label="To date"
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5"
          onClick={fetchAnalysis}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Recompute
        </Button>
        <span className="ml-auto text-[11px] text-slate-400">
          {from.toLocaleDateString([], { month: "short", day: "numeric" })} –{" "}
          {to.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ·{" "}
          {scopeNote}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : data ? (
        <>
          {/* Overview */}
          <section aria-label="Overview" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <OverviewCard
              icon={Activity}
              label="Patients imported"
              value={String(data.cohortSize)}
              sub={`${data.inPipeline} still in pipeline`}
            />
            <OverviewCard
              icon={CheckCircle2}
              label="Discharged"
              value={String(data.discharged)}
              sub={data.total.n > 0 ? `${fmtPct(data.discharged / data.cohortSize)} of cohort` : "—"}
            />
            <OverviewCard
              icon={AlertTriangle}
              label="Delayed (any stage)"
              value={data.cohortSize > 0 ? fmtPct(data.overallDelayed.pct) : "—"}
              sub={`${data.overallDelayed.n} patients`}
              tone={data.overallDelayed.pct >= 0.25 ? "text-rose-700" : data.overallDelayed.pct >= 0.1 ? "text-amber-700" : "text-teal-700"}
            />
            <OverviewCard
              icon={Clock}
              label="Median total time"
              value={data.total.median !== null ? fmtMinutes(data.total.median) : "—"}
              sub={`medical clearance → departure · target ≤ ${fmtMinutes(data.total.targetMin)}`}
            />
            <OverviewCard
              icon={TrendingUp}
              label="Over 3h benchmark"
              value={data.total.overTargetPct !== null ? fmtPct(data.total.overTargetPct) : "—"}
              sub={data.total.n > 0 ? `${data.total.n} completed discharges` : "no completions yet"}
              tone={
                (data.total.overTargetPct ?? 0) >= 0.25
                  ? "text-rose-700"
                  : (data.total.overTargetPct ?? 0) >= 0.1
                    ? "text-amber-700"
                    : "text-teal-700"
              }
            />
            <OverviewCard
              icon={Activity}
              label="Import → departure"
              value={data.importToDischarge.median !== null ? fmtMinutes(data.importToDischarge.median) : "—"}
              sub={
                data.importToDischarge.n > 0
                  ? `mean ${fmtMinutes(data.importToDischarge.mean ?? 0)} · n=${data.importToDischarge.n}`
                  : "no completions yet"
              }
            />
          </section>

          {/* Delayed % per stage + TAT per stage */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <h2 className="text-sm font-bold text-slate-800">Delayed % — every stage</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Share of patients that entered the stage and exceeded the stage target
                  (completed over target, or still waiting past it).
                </p>
                <div className="mt-3 space-y-3">
                  {data.stages.map((s) => (
                    <div key={s.num}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-700">
                          {s.num}. {s.title}
                        </span>
                        <span className={`font-bold tabular-nums ${pctTextTone(s.delayedPct)}`}>
                          {fmtPctCell(s.delayedPct, s.entered)}
                          <span className="ml-1 font-normal text-slate-400">
                            {s.delayed}/{s.entered}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${pctTone(s.delayedPct)}`}
                          style={{ width: `${Math.min(100, s.entered ? s.delayedPct * 100 : 0)}%` }}
                          role="progressbar"
                          aria-valuenow={Math.round(s.delayedPct * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${s.title} delayed percent`}
                        />
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        target {fmtMinutes(s.targetMin)} · {s.completed} completed · {s.inProgress} waiting
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <h2 className="text-sm font-bold text-slate-800">TAT — every stage</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Median turnaround (stage entry → stage done) against the stage target.
                </p>
                <div className="mt-3 space-y-3">
                  {data.stages.map((s) => {
                    const med = s.tatMedian;
                    const width = med !== null ? (med / maxTat) * 100 : 0;
                    const marker = (s.targetMin / maxTat) * 100;
                    return (
                      <div key={s.num}>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-700">
                            {s.num}. {s.title}
                          </span>
                          <span className="font-bold tabular-nums text-slate-800">
                            {med !== null ? fmtMinutes(med) : "—"}
                            <span className="ml-1 font-normal text-slate-400">
                              target {fmtMinutes(s.targetMin)}
                            </span>
                          </span>
                        </div>
                        <div className="relative mt-1 h-2.5 w-full rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              med !== null && med > s.targetMin ? "bg-amber-500" : "bg-teal-500"
                            }`}
                            style={{ width: `${Math.min(100, width)}%` }}
                          />
                          <span
                            className="absolute top-[-2px] h-3.5 w-0.5 rounded bg-slate-400"
                            style={{ left: `${Math.min(100, marker)}%` }}
                            title={`Target ${fmtMinutes(s.targetMin)}`}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {s.tatMean !== null
                            ? `mean ${fmtMinutes(s.tatMean)} · p90 ${s.tatP90 !== null ? fmtMinutes(s.tatP90) : "—"} · n=${s.completed}`
                            : "no completed cases in range"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Delayed % by specialty */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <h2 className="text-sm font-bold text-slate-800">Delayed % — every specialty</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Per assigned-doctor specialty: share of cases delayed at each stage, and at any
                stage. Sorted by &ldquo;any stage&rdquo;.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-3 font-medium">Specialty</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cases</th>
                      <th className="px-2 py-1.5 text-right font-medium">Medical</th>
                      <th className="px-2 py-1.5 text-right font-medium">Notify</th>
                      <th className="px-2 py-1.5 text-right font-medium">Financial</th>
                      <th className="px-2 py-1.5 text-right font-medium">Physical</th>
                      <th className="px-2 py-1.5 text-right font-medium">Any stage</th>
                      <th className="py-1.5 pl-3 text-right font-medium">Median total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.specialties]
                      .sort((a, b) => b.delayedAnyPct - a.delayedAnyPct)
                      .map((sp) => (
                        <tr key={sp.specialty} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-1.5 pr-3 font-medium text-slate-700">{sp.specialty}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                            {sp.cases}
                          </td>
                          {[1, 2, 3, 4].map((n) => {
                            const cell = sp.stages[n];
                            return (
                              <td
                                key={n}
                                className={`px-2 py-1.5 text-right font-semibold tabular-nums ${
                                  cell.entered > 0 ? pctTextTone(cell.pct) : "text-slate-300"
                                }`}
                              >
                                {fmtPctCell(cell.pct, cell.entered)}
                              </td>
                            );
                          })}
                          <td
                            className={`px-2 py-1.5 text-right font-bold tabular-nums ${pctTextTone(sp.delayedAnyPct)}`}
                          >
                            {fmtPctCell(sp.delayedAnyPct, sp.cases)}
                          </td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-slate-600">
                            {sp.medianTotal !== null ? fmtMinutes(sp.medianTotal) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Specialty bars */}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[...data.specialties]
                  .sort((a, b) => b.delayedAnyPct - a.delayedAnyPct)
                  .slice(0, 8)
                  .map((sp) => (
                    <div key={sp.specialty} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 truncate text-[11px] text-slate-500" title={sp.specialty}>
                        {sp.specialty}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${pctTone(sp.delayedAnyPct)}`}
                          style={{ width: `${Math.min(100, sp.cases ? sp.delayedAnyPct * 100 : 0)}%` }}
                        />
                      </div>
                      <span className={`w-10 text-right text-[11px] font-bold tabular-nums ${pctTextTone(sp.delayedAnyPct)}`}>
                        {fmtPctCell(sp.delayedAnyPct, sp.cases)}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Daily volume */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <h2 className="text-sm font-bold text-slate-800">Daily volume</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Patients imported vs discharged per day in the selected window.
              </p>
              <div className="mt-3 flex items-end gap-[3px] overflow-x-auto pb-1" style={{ minWidth: 0 }}>
                {data.daily.map((d) => (
                  <div
                    key={d.date}
                    className="flex w-6 shrink-0 flex-col items-center gap-0.5"
                    title={`${d.date}: ${d.imported} imported · ${d.discharged} discharged`}
                  >
                    <div className="flex h-24 items-end gap-[2px]">
                      <div
                        className="w-2.5 rounded-t bg-teal-500/80"
                        style={{ height: `${(d.imported / maxDaily) * 96}px` }}
                      />
                      <div
                        className="w-2.5 rounded-t bg-slate-400/70"
                        style={{ height: `${(d.discharged / maxDaily) * 96}px` }}
                      />
                    </div>
                    <span className="text-[8px] tabular-nums text-slate-400">
                      {d.date.slice(8)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-teal-500/80" aria-hidden="true" />
                  Imported
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400/70" aria-hidden="true" />
                  Discharged
                </span>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] leading-relaxed text-slate-400">
            Methodology — cohort: patients imported inside the selected window. A stage counts as
            delayed when its turnaround exceeds the stage target (completed cases) or the elapsed
            time already exceeds it (cases still waiting). TAT percentiles use completed steps
            only. Stage targets ({data.stages.map((s) => `${s.short} ${fmtMinutes(s.targetMin)}`).join(" · ")}
            ) follow the board flags; the {fmtMinutes(TOTAL_TARGET_MIN)} total benchmark is
            El-Abbassy 2021. Financial and medical targets remain draft — recalibrate on your real
            timestamps.
          </p>
        </>
      ) : null}
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {label}
          </div>
          <Icon className="h-4 w-4 text-slate-300" aria-hidden="true" />
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums md:text-2xl ${tone ?? "text-slate-900"}`}>
          {value}
        </div>
        <div className="truncate text-[11px] text-slate-400" title={sub}>
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
