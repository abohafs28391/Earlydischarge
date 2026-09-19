/**
 * DischargeFlow — dashboard analysis engine.
 *
 * Computes the statistics shown in the Analysis tab over a user-selected
 * duration (from/to). Cohort definition: every patient IMPORTED inside the
 * range. For each pipeline stage we report:
 *   - entered      patients that reached the stage (within the cohort)
 *   - completed    patients whose stage step is stamped
 *   - TAT          turnaround time = completion − stage entry (completed only)
 *   - delayed      completed over target, OR still in progress past target
 *   - delayed %    delayed / entered
 * In-progress patients are counted against the elapsed time since stage
 * entry, so today's backlog is visible immediately rather than only after
 * the fact. Stage targets are the same draft/calibrated values used by the
 * board flags — recalibrate with real timestamps.
 */

import type { PatientJson } from "@/lib/workflow";
import { isVisibleTo, STAGE_TARGETS, STAGES, TOTAL_TARGET_MIN, type UserJson } from "@/lib/workflow";

const MIN = 60000;

// ---------------------------------------------------------------------------
// Payload types (API -> UI)
// ---------------------------------------------------------------------------

export interface StageStat {
  num: number;
  key: string;
  title: string;
  short: string;
  targetMin: number;
  entered: number;
  completed: number;
  inProgress: number;
  delayed: number;
  delayedPct: number; // 0..1, null-safe -> 0 when entered === 0
  tatMean: number | null;
  tatMedian: number | null;
  tatP90: number | null;
}

export interface SpecialtyStageCell {
  entered: number;
  delayed: number;
  pct: number; // 0..1
}

export interface SpecialtyStat {
  specialty: string;
  cases: number;
  delayedAny: number;
  delayedAnyPct: number; // 0..1
  stages: Record<number, SpecialtyStageCell>;
  medianTotal: number | null; // medical clearance -> departure (completed)
}

export interface DailyStat {
  date: string; // YYYY-MM-DD
  imported: number;
  discharged: number;
}

export interface AnalysisResult {
  range: { from: string; to: string };
  cohortSize: number;
  discharged: number;
  inPipeline: number;
  overallDelayed: { n: number; pct: number };
  total: {
    n: number;
    median: number | null;
    mean: number | null;
    p90: number | null;
    overTargetPct: number | null; // share over the 3h benchmark
    targetMin: number;
  };
  importToDischarge: { n: number; median: number | null; mean: number | null };
  stages: StageStat[];
  specialties: SpecialtyStat[];
  daily: DailyStat[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function median(values: number[]): number | null {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN));
}

interface StageWindow {
  entry: string | null; // when the patient entered the stage
  done: string | null; // when the stage step completed
}

function stageWindow(p: PatientJson, stage: number): StageWindow {
  switch (stage) {
    case 1:
      return { entry: p.importedAt, done: p.medicalReadyAt };
    case 2:
      return { entry: p.medicalReadyAt, done: p.financeNotifiedAt };
    case 3:
      return { entry: p.financeNotifiedAt, done: p.financeClearedAt };
    case 4:
      return { entry: p.financeClearedAt, done: p.receptionReadyAt };
    default:
      return { entry: p.receptionReadyAt, done: p.physicalDischargedAt };
  }
}

/** Is this stage delayed for this patient (completed over target, or
 *  in progress past target)? */
function stageDelayed(p: PatientJson, stage: number, now: Date): boolean {
  const { entry, done } = stageWindow(p, stage);
  if (!entry) return false;
  const target = STAGE_TARGETS[stage].targetMin;
  if (done) return minutesBetween(entry, done) > target;
  return Math.round((now.getTime() - new Date(entry).getTime()) / MIN) > target;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeAnalysis(
  patients: PatientJson[],
  from: Date,
  to: Date,
  now = new Date(),
  viewer: UserJson | null = null
): AnalysisResult {
  // Scope to the viewer's visibility (nurses -> their floors, finance ->
  // stage>=3, reception -> financially cleared, physicians -> own specialty).
  const scoped = viewer ? patients.filter((p) => isVisibleTo(viewer, p)) : patients;
  const cohort = scoped.filter((p) => {
    const t = new Date(p.importedAt).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  // ----- per-stage stats ----------------------------------------------------
  const stages: StageStat[] = STAGES.slice(0, 5).map((meta) => {
    const entered = cohort.filter((p) => stageWindow(p, meta.num).entry).length;
    const completedWindows = cohort
      .map((p) => stageWindow(p, meta.num))
      .filter((w) => w.entry && w.done) as Array<{ entry: string; done: string }>;
    const tats = completedWindows.map((w) => minutesBetween(w.entry, w.done));
    const sortedTats = [...tats].sort((a, b) => a - b);
    const completed = tats.length;
    const inProgress = entered - completed;
    const delayed = cohort.filter((p) => stageDelayed(p, meta.num, now)).length;

    return {
      num: meta.num,
      key: meta.key,
      title: meta.title,
      short: meta.short,
      targetMin: STAGE_TARGETS[meta.num].targetMin,
      entered,
      completed,
      inProgress,
      delayed,
      delayedPct: entered > 0 ? delayed / entered : 0,
      tatMean: mean(tats),
      tatMedian: quantile(sortedTats, 0.5),
      tatP90: quantile(sortedTats, 0.9),
    };
  });

  // ----- total pipeline (medical clearance -> physical departure) -----------
  const totals = cohort
    .filter((p) => p.medicalReadyAt && p.physicalDischargedAt)
    .map((p) => minutesBetween(p.medicalReadyAt as string, p.physicalDischargedAt as string));
  const sortedTotals = [...totals].sort((a, b) => a - b);
  const importTotals = cohort
    .filter((p) => p.physicalDischargedAt)
    .map((p) => minutesBetween(p.importedAt, p.physicalDischargedAt as string));

  // ----- per-specialty stats -------------------------------------------------
  const specialties = [...new Set(cohort.map((p) => p.doctorSpecialty))]
    .sort((a, b) => a.localeCompare(b))
    .map<SpecialtyStat>((specialty) => {
      const group = cohort.filter((p) => p.doctorSpecialty === specialty);
      const stageCells: Record<number, SpecialtyStageCell> = {};
      for (const meta of STAGES.slice(0, 5)) {
        const entered = group.filter((p) => stageWindow(p, meta.num).entry).length;
        const delayed = group.filter((p) => stageDelayed(p, meta.num, now)).length;
        stageCells[meta.num] = {
          entered,
          delayed,
          pct: entered > 0 ? delayed / entered : 0,
        };
      }
      const delayedAny = group.filter((p) =>
        STAGES.slice(0, 5).some((meta) => stageDelayed(p, meta.num, now))
      ).length;
      const groupTotals = group
        .filter((p) => p.medicalReadyAt && p.physicalDischargedAt)
        .map((p) => minutesBetween(p.medicalReadyAt as string, p.physicalDischargedAt as string));

      return {
        specialty,
        cases: group.length,
        delayedAny,
        delayedAnyPct: group.length > 0 ? delayedAny / group.length : 0,
        stages: stageCells,
        medianTotal: quantile([...groupTotals].sort((a, b) => a - b), 0.5),
      };
    });

  // ----- daily volumes (all scoped patients, not just the cohort, so
  //       long-stay discharges still appear on the day they left) -------------
  const daily: DailyStat[] = [];
  const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
  for (let i = 0; i <= Math.min(dayCount, 62); i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    daily.push({
      date: key,
      imported: cohort.filter((p) => dayKey(p.importedAt) === key).length,
      discharged: scoped.filter(
        (p) => p.physicalDischargedAt && dayKey(p.physicalDischargedAt) === key
      ).length,
    });
  }

  const discharged = cohort.filter((p) => p.physicalDischargedAt).length;
  const overallDelayed = cohort.filter((p) =>
    STAGES.slice(0, 5).some((meta) => stageDelayed(p, meta.num, now))
  ).length;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    cohortSize: cohort.length,
    discharged,
    inPipeline: cohort.length - discharged,
    overallDelayed: {
      n: overallDelayed,
      pct: cohort.length > 0 ? overallDelayed / cohort.length : 0,
    },
    total: {
      n: totals.length,
      median: quantile(sortedTotals, 0.5),
      mean: mean(totals),
      p90: quantile(sortedTotals, 0.9),
      overTargetPct:
        totals.length > 0
          ? totals.filter((t) => t > TOTAL_TARGET_MIN).length / totals.length
          : null,
      targetMin: TOTAL_TARGET_MIN,
    },
    importToDischarge: {
      n: importTotals.length,
      median: median(importTotals),
      mean: mean(importTotals),
    },
    stages,
    specialties,
    daily,
  };
}
