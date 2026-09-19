/**
 * DischargeFlow — the physician decision window (update 0.3).
 *
 * When a physician records a DISCHARGE decision, the patient does NOT move
 * to stage 2 immediately: a confirmation window (default 60 seconds,
 * admin-adjustable at runtime) runs first so the physician can undo or
 * change the decision. Once the window closes, the patient is promoted —
 * medicalReadyAt is stamped at decision time + window (the effective
 * clearance moment), the audit log records the auto-confirmation, and the
 * stage-2 task owners (floor nurses) get their handoff notification.
 *
 * Promotion is lazy: it runs whenever the board is loaded or an action is
 * posted, so no background scheduler is needed — the board's 10s poll keeps
 * it timely.
 */

import { db } from "@/lib/db";
import { notifyHandoff } from "@/lib/alarms";
import {
  DECISION_WINDOW_MAX_SEC,
  DECISION_WINDOW_MIN_SEC,
  DEFAULT_DECISION_WINDOW_SEC,
} from "@/lib/workflow";

const DECISION_WINDOW_KEY = "decision.window.sec";

/** Current window length in seconds (setting, default 60, clamped to range). */
export async function getDecisionWindowSec(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: DECISION_WINDOW_KEY } });
  const n = row ? Number(row.value) : NaN;
  return clampWindow(n);
}

/** Persist the window length (admin-only route validates before calling). */
export async function setDecisionWindowSec(sec: number): Promise<number> {
  const value = clampWindow(sec);
  await db.setting.upsert({
    where: { key: DECISION_WINDOW_KEY },
    create: { key: DECISION_WINDOW_KEY, value: String(value) },
    update: { value: String(value) },
  });
  return value;
}

export function clampWindow(sec: number): number {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n)) return DEFAULT_DECISION_WINDOW_SEC;
  return Math.min(DECISION_WINDOW_MAX_SEC, Math.max(DECISION_WINDOW_MIN_SEC, n));
}

/**
 * Promote every DISCHARGE decision that has outlived the window: stamp
 * medicalReadyAt (effective at decision + window), log the auto-confirmed
 * MEDICAL_READY action, and hand the patient off to the stage-2 owners.
 * Returns how many patients were promoted. Idempotent — promoted patients
 * are filtered out by medicalReadyAt IS NULL on every pass.
 */
export async function promoteDueMedicalDecisions(): Promise<number> {
  const windowSec = await getDecisionWindowSec();
  const cutoff = new Date(Date.now() - windowSec * 1000);
  const due = await db.patient.findMany({
    where: {
      medicalDecision: "DISCHARGE",
      medicalReadyAt: null,
      medicalDecisionAt: { lte: cutoff },
      medicalDecisionById: { not: null },
    },
    take: 100,
  });

  let promoted = 0;
  for (const p of due) {
    const decidedById = p.medicalDecisionById as string;
    const effectiveAt = p.medicalDecisionAt
      ? new Date(p.medicalDecisionAt.getTime() + windowSec * 1000)
      : new Date();

    // updateMany with the guard conditions keeps concurrent board loads from
    // double-promoting the same patient (SQLite serializes writes).
    const res = await db.patient.updateMany({
      where: {
        id: p.id,
        medicalDecision: "DISCHARGE",
        medicalReadyAt: null,
      },
      data: { medicalReadyAt: effectiveAt, medicalReadyById: decidedById },
    });
    if (res.count !== 1) continue;

    await db.action.create({
      data: {
        patientId: p.id,
        userId: decidedById,
        type: "MEDICAL_READY",
        note: `Auto-confirmed after the ${windowSec}s decision window`,
      },
    });
    await notifyHandoff({ ...p, medicalReadyAt: effectiveAt, medicalReadyById: decidedById }, 2).catch(
      (err) => console.error("handoff notification failed", err)
    );
    promoted++;
  }
  return promoted;
}
