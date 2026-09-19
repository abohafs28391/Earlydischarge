/** Shared server-side data loading for the workflow board. */

import { db } from "@/lib/db";
import { promoteDueMedicalDecisions, getDecisionWindowSec } from "@/lib/decision-window";
import { actionToJson, patientToJson } from "@/lib/serialize";

export interface BoardStats {
  /** All discharged patients (shown via the header Discharged button). */
  dischargedTotal: number;
  /** Discharged today — feeds the KPI card. */
  dischargedToday: number;
  /** Of today's discharges, how many left before noon. */
  dischargedTodayBeforeNoon: number;
  /** Median total pipeline time (medical clearance -> departure) over the
   *  discharged patients of the last 7 days; null when none. */
  medianTotalRecent: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function loadStats(): Promise<BoardStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [dischargedTotal, dischargedRows, recent] = await Promise.all([
    db.patient.count({ where: { physicalDischargedAt: { not: null } } }),
    db.patient.findMany({
      where: { physicalDischargedAt: { gte: startOfDay } },
      select: { physicalDischargedAt: true },
    }),
    db.patient.findMany({
      where: { physicalDischargedAt: { gte: weekAgo } },
      select: { medicalReadyAt: true, physicalDischargedAt: true },
    }),
  ]);

  const dischargedTodayBeforeNoon = dischargedRows.filter(
    (p) => p.physicalDischargedAt && p.physicalDischargedAt.getHours() < 12
  ).length;
  const totals = recent
    .filter((p) => p.medicalReadyAt && p.physicalDischargedAt)
    .map(
      (p) =>
        Math.round(
          ((p.physicalDischargedAt as Date).getTime() - (p.medicalReadyAt as Date).getTime()) /
            60000
        )
    );

  return {
    dischargedTotal,
    dischargedToday: dischargedRows.length,
    dischargedTodayBeforeNoon,
    medianTotalRecent: median(totals),
  };
}

/**
 * Board payload: every patient still in the pipeline (discharged patients
 * left the board — they are listed via the header Discharged button, served
 * by loadDischarged). Stats feed the "Discharged today" KPI and the
 * Discharged button badge. decisionWindowSec is the physician decision
 * window length the UI counts down with (admin-adjustable setting).
 *
 * Loading the board also lazily promotes DISCHARGE decisions whose
 * confirmation window has closed (see lib/decision-window) — the board's
 * 10s client poll keeps that timely without a background scheduler.
 */
export async function loadBoard() {
  await promoteDueMedicalDecisions();
  const [patients, stats, decisionWindowSec] = await Promise.all([
    db.patient.findMany({
      where: { physicalDischargedAt: null },
      orderBy: { importedAt: "asc" },
    }),
    loadStats(),
    getDecisionWindowSec(),
  ]);

  const actions = patients.length
    ? await db.action.findMany({
        where: { patientId: { in: patients.map((p) => p.id) } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    patients: patients.map(patientToJson),
    actions: actions.map(actionToJson),
    stats,
    decisionWindowSec,
  };
}

/** Discharged patients (newest departure first) with their audit actions —
 *  the payload behind the header Discharged button. */
export async function loadDischarged() {
  const patients = await db.patient.findMany({
    where: { physicalDischargedAt: { not: null } },
    orderBy: { physicalDischargedAt: "desc" },
    take: 500,
  });

  const actions = patients.length
    ? await db.action.findMany({
        where: { patientId: { in: patients.map((p) => p.id) } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    patients: patients.map(patientToJson),
    actions: actions.map(actionToJson),
  };
}
