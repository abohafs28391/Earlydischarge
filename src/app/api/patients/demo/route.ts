import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";
import { loadBoard } from "@/lib/board-data";
import { seedDemoPatients } from "@/lib/demo";
import { ensureUsersSeeded } from "@/lib/seed";

/** Load demo patients (replaces any previous demo data) — admin only.
 *  Seeds today's board plus a 30-day discharged history for the Analysis tab. */
export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const created = await seedDemoPatients();
    return NextResponse.json({ created, ...(await loadBoard()) });
  } catch (err) {
    console.error("demo POST failed", err);
    return NextResponse.json({ error: "Failed to load demo patients" }, { status: 500 });
  }
}

/** Remove demo patients only — imported data is untouched. Admin only. */
export async function DELETE(req: NextRequest) {
  try {
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    await db.patient.deleteMany({ where: { isDemo: true } });
    return NextResponse.json({ cleared: true, ...(await loadBoard()) });
  } catch (err) {
    console.error("demo DELETE failed", err);
    return NextResponse.json({ error: "Failed to clear demo patients" }, { status: 500 });
  }
}
