import { NextRequest, NextResponse } from "next/server";
import type { Patient } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyHandoff } from "@/lib/alarms";
import { getDecisionWindowSec, promoteDueMedicalDecisions } from "@/lib/decision-window";
import { ensureUsersSeeded } from "@/lib/seed";
import { actionToJson, patientToJson, userToJson } from "@/lib/serialize";
import { validateAction, type ActionType } from "@/lib/workflow";

/**
 * The single workflow mutation endpoint. Every call:
 *   1. re-validates the acting user's permission server-side (role + stage +
 *      gating + admin-set edit/view privileges + read-only demo views)
 *   2. stamps WHEN (timestamp) and WHO (user id) on the patient record
 *   3. appends a matching row to the append-only Action audit log
 *   4. notifies the task owners of the stage the patient just entered
 *
 * The physician stage-1 flow is decision-based (update 0.3): physicians
 * record Discharge / No discharge; a DISCHARGE decision auto-confirms into
 * medicalReadyAt once the decision window closes (promoted lazily here and
 * on every board load — never via a direct MEDICAL_READY call).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const body = (await req.json().catch(() => null)) as {
      patientId?: string;
      userId?: string;
      type?: string;
      templateBody?: string;
      demo?: boolean;
    } | null;

    if (!body?.patientId || !body?.userId || !body?.type) {
      return NextResponse.json(
        { error: "patientId, userId and type are required" },
        { status: 400 }
      );
    }

    const VALID_TYPES: ActionType[] = [
      "MEDICAL_DECIDED_DISCHARGE",
      "MEDICAL_DECIDED_NO",
      "MEDICAL_UNDO",
      "COPY_TEMPLATE",
      "FINANCE_NOTIFIED",
      "FINANCE_CLEARED",
      "RECEPTION_READY",
      "PHYSICAL_DISCHARGED",
      "COPY_CANCEL_TEMPLATE",
      "CANCEL_DISCHARGE",
    ];
    if (!VALID_TYPES.includes(body.type as ActionType)) {
      return NextResponse.json({ error: `Unknown action type "${body.type}"` }, { status: 400 });
    }
    const type = body.type as ActionType;

    const [user, patientRow] = await Promise.all([
      db.user.findUnique({ where: { id: body.userId } }),
      db.patient.findUnique({ where: { id: body.patientId } }),
    ]);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!patientRow) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

    // Keep decision state fresh: any DISCHARGE decision whose window has
    // closed is promoted BEFORE validation, so a late undo is correctly
    // rejected ("window has closed") instead of silently clearing it.
    await promoteDueMedicalDecisions();
    const refreshed =
      (await db.patient.findUnique({ where: { id: patientRow.id } })) ?? patientRow;

    const userJson = userToJson(user);
    const patientJson = patientToJson(refreshed);

    const check = validateAction(
      userJson,
      patientJson,
      type,
      body.demo === true,
      await getDecisionWindowSec()
    );
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 403 });
    }

    const now = new Date();
    let updated: typeof patientRow = refreshed;

    switch (type) {
      case "MEDICAL_DECIDED_DISCHARGE":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: {
            medicalDecision: "DISCHARGE",
            medicalDecisionAt: now,
            medicalDecisionById: user.id,
          },
        });
        break;
      case "MEDICAL_DECIDED_NO":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: {
            medicalDecision: "NO_DISCHARGE",
            medicalDecisionAt: now,
            medicalDecisionById: user.id,
          },
        });
        break;
      case "MEDICAL_UNDO":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: {
            medicalDecision: null,
            medicalDecisionAt: null,
            medicalDecisionById: null,
          },
        });
        break;
      case "COPY_TEMPLATE":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: {
            templateCopiedAt: now,
            templateCopiedById: user.id,
            templateBody:
              typeof body.templateBody === "string" && body.templateBody.trim().length > 0
                ? body.templateBody
                : refreshed.templateBody,
          },
        });
        break;
      case "FINANCE_NOTIFIED":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: { financeNotifiedAt: now, financeNotifiedById: user.id },
        });
        break;
      case "FINANCE_CLEARED":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: { financeClearedAt: now, financeClearedById: user.id },
        });
        break;
      case "RECEPTION_READY":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: { receptionReadyAt: now, receptionReadyById: user.id },
        });
        break;
      case "PHYSICAL_DISCHARGED":
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: { physicalDischargedAt: now, physicalDischargedById: user.id },
        });
        break;
      case "COPY_CANCEL_TEMPLATE":
        // audit-only: the cancellation template text itself is copied on the
        // client (same pattern as COPY_TEMPLATE logs the copy moment)
        updated = refreshed;
        break;
      case "CANCEL_DISCHARGE":
        // Called-off discharge: the patient returns to Medical Clearance —
        // stage-1 and stage-2 artifacts are reset so the pipeline restarts
        // cleanly (the full history stays in the audit log).
        updated = await db.patient.update({
          where: { id: refreshed.id },
          data: {
            medicalDecision: null,
            medicalDecisionAt: null,
            medicalDecisionById: null,
            medicalReadyAt: null,
            medicalReadyById: null,
            templateCopiedAt: null,
            templateCopiedById: null,
            templateBody: null,
            financeNotifiedAt: null,
            financeNotifiedById: null,
          },
        });
        break;
    }

    const action = await db.action.create({
      data: { patientId: updated.id, userId: user.id, type, note: actionNote(type, refreshed) },
      include: { user: true },
    });

    // Handoff notification — the owners of the stage the patient just
    // entered learn it is now waiting for them (COPY_TEMPLATE and the
    // decision actions stay within the same stage: no handoff).
    const HANDOFF_AFTER: Partial<Record<ActionType, number>> = {
      FINANCE_NOTIFIED: 3, // financial team clears the account
      FINANCE_CLEARED: 4, // reception personnel prepare the discharge papers
      RECEPTION_READY: 5, // floor nurse completes the physical discharge
    };
    const handoffStage = HANDOFF_AFTER[type];
    if (handoffStage) {
      await notifyHandoff(updated, handoffStage).catch((err) =>
        console.error("handoff notification failed", err)
      );
    }
    // A cancelled discharge hands the patient BACK to the stage-1 owners —
    // the specialty physicians learn the patient awaits a fresh decision.
    if (type === "CANCEL_DISCHARGE") {
      await notifyHandoff(updated, 1, {
        key: "return",
        title: "Discharge cancelled — patient back to Medical Clearance",
        body: `${updated.name} (Room ${updated.room}, floor ${updated.floor}) had the discharge cancelled by ${user.name} and is awaiting a fresh physician decision.`,
      }).catch((err) => console.error("handoff notification failed", err));
    }

    return NextResponse.json({
      patient: patientToJson(updated),
      action: actionToJson(action),
    });
  } catch (err) {
    console.error("actions POST failed", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

/** Human-readable notes for the new decision / cancel actions (other types
 *  keep null — their label already says what happened). */
function actionNote(type: ActionType, before: Patient): string | null {
  switch (type) {
    case "MEDICAL_DECIDED_DISCHARGE":
      return "Discharge decision — patient moves on when the confirmation window closes";
    case "MEDICAL_DECIDED_NO":
      return before.medicalDecision === "DISCHARGE"
        ? "Changed the pending discharge decision to No discharge"
        : "No-discharge decision — patient stays in Medical Clearance";
    case "MEDICAL_UNDO":
      return "Undid the pending discharge decision";
    case "CANCEL_DISCHARGE":
      return "Discharge cancelled — patient returned to Medical Clearance (typed confirmation)";
    default:
      return null;
  }
}
