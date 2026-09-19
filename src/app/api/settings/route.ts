import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import {
  getDecisionWindowSec,
  setDecisionWindowSec,
} from "@/lib/decision-window";
import {
  DECISION_WINDOW_MIN_SEC,
  DECISION_WINDOW_MAX_SEC,
  DEFAULT_DECISION_WINDOW_SEC,
} from "@/lib/workflow";
import { ensureUsersSeeded } from "@/lib/seed";

/**
 * Admin workflow settings. Currently one knob:
 *   decisionWindowSec — seconds between a physician's Discharge decision and
 *   the patient moving to the next stage (the undo / change window).
 *   Default 60, allowed 1–600. The board payload carries the value to every
 *   client so countdowns match the server exactly.
 */

export async function GET(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    return NextResponse.json({
      decisionWindowSec: await getDecisionWindowSec(),
      min: DECISION_WINDOW_MIN_SEC,
      max: DECISION_WINDOW_MAX_SEC,
      default: DEFAULT_DECISION_WINDOW_SEC,
    });
  } catch (err) {
    console.error("settings GET failed", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      decisionWindowSec?: number;
    } | null;
    const guard = await requireAdmin(body?.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const sec = Number(body?.decisionWindowSec);
    if (
      !Number.isFinite(sec) ||
      !Number.isInteger(sec) ||
      sec < DECISION_WINDOW_MIN_SEC ||
      sec > DECISION_WINDOW_MAX_SEC
    ) {
      return NextResponse.json(
        {
          error: `Decision window must be a whole number between ${DECISION_WINDOW_MIN_SEC} and ${DECISION_WINDOW_MAX_SEC} seconds`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ decisionWindowSec: await setDecisionWindowSec(sec) });
  } catch (err) {
    console.error("settings POST failed", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
