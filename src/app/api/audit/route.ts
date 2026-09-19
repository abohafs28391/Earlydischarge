import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";
import { ensureUsersSeeded } from "@/lib/seed";
import { actionToJson } from "@/lib/serialize";

/** Admin: the hospital-wide audit trail — the most recent logged steps
 *  across ALL patients (who did what, and when). */
export async function GET(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 60);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 60;

    const [actions, patients] = await Promise.all([
      db.action.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: limit }),
      db.patient.findMany({ select: { id: true, name: true, mrn: true, room: true } }),
    ]);
    const patientById = new Map(patients.map((p) => [p.id, p]));

    return NextResponse.json({
      actions: actions.map((a) => ({
        ...actionToJson(a),
        patientName: patientById.get(a.patientId)?.name ?? null,
        patientMrn: patientById.get(a.patientId)?.mrn ?? null,
        patientRoom: patientById.get(a.patientId)?.room ?? null,
      })),
    });
  } catch (err) {
    console.error("audit GET failed", err);
    return NextResponse.json({ error: "Failed to load audit trail" }, { status: 500 });
  }
}
