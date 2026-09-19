import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyImported } from "@/lib/alarms";
import { requireUser } from "@/lib/api-auth";
import { loadBoard, loadDischarged } from "@/lib/board-data";
import { parsePatientCsv } from "@/lib/csv";
import { ensureUsersSeeded } from "@/lib/seed";
import { IMPORTER_ROLES } from "@/lib/workflow";

/**
 * Default: the active board (in-pipeline patients + stats). Pass
 * ?scope=discharged to list departed patients (newest first) with their
 * audit actions — the header Discharged button payload.
 */
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("scope") === "discharged") {
      return NextResponse.json(await loadDischarged());
    }
    return NextResponse.json(await loadBoard());
  } catch (err) {
    console.error("patients GET failed", err);
    return NextResponse.json({ error: "Failed to load patients" }, { status: 500 });
  }
}

/** Import a pasted / uploaded patient list (CSV or Excel-paste TSV).
 *  Importing is the workflow entry point — allowed for admins and nurses
 *  (with edit privilege), never in a read-only admin demo view. */
export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const body = (await req.json().catch(() => null)) as {
      csv?: string;
      userId?: string;
      demo?: boolean;
    } | null;
    if (!body?.csv || typeof body.csv !== "string" || !body.csv.trim()) {
      return NextResponse.json({ error: "Missing csv payload" }, { status: 400 });
    }
    if (body.demo) {
      return NextResponse.json(
        { error: "Read-only admin demo view — exit demo to import" },
        { status: 403 }
      );
    }

    const guard = await requireUser(body.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const importer = guard.user;

    if (!IMPORTER_ROLES.includes(importer.role as (typeof IMPORTER_ROLES)[number])) {
      return NextResponse.json(
        { error: "Only admins and nurses may import the patient list" },
        { status: 403 }
      );
    }
    if (!importer.canView || !importer.canEdit) {
      return NextResponse.json(
        { error: "This account is restricted from editing — an admin can re-enable it" },
        { status: 403 }
      );
    }

    const allUsers = await db.user.findMany({ where: { role: "PHYSICIAN" } });
    const knownSpecialties = [...new Set(allUsers.map((u) => u.specialty ?? "").filter(Boolean))];

    const { rows, errors } = parsePatientCsv(body.csv, knownSpecialties);
    if (rows.length === 0) {
      return NextResponse.json({ created: 0, errors, warnings: [] }, { status: 200 });
    }

    // Skip MRNs that already exist in the database.
    const existing = await db.patient.findMany({
      where: { mrn: { in: rows.map((r) => r.mrn) } },
      select: { mrn: true },
    });
    const existingMrns = new Set(existing.map((e) => e.mrn));
    const duplicates = rows.filter((r) => existingMrns.has(r.mrn));
    const fresh = rows.filter((r) => !existingMrns.has(r.mrn));

    let created = 0;
    for (const r of fresh) {
      const patient = await db.patient.create({
        data: {
          mrn: r.mrn,
          name: r.name,
          room: r.room,
          floor: r.floor,
          doctorName: r.doctorName || "Unassigned",
          doctorSpecialty: r.doctorSpecialty,
          isDemo: false,
        },
      });
      await db.action.create({
        data: {
          patientId: patient.id,
          userId: importer.id,
          type: "IMPORTED",
          note: `Imported to room ${r.room} (floor ${r.floor})`,
        },
      });
      // Task owners of stage 1 (matching-specialty physicians) get pinged.
      await notifyImported(patient).catch(() => undefined);
      created++;
    }

    const warnings = [
      ...rows.flatMap((r) => r.warnings.map((w) => `Row ${r.row} (${r.name}): ${w}`)),
      ...duplicates.map((r) => `Row ${r.row} (${r.name}): MRN ${r.mrn} already exists — skipped.`),
    ];

    return NextResponse.json({ created, errors, warnings, ...(await loadBoard()) });
  } catch (err) {
    console.error("patients POST failed", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

/** Clear ALL patients (and the audit trail) — admin only. */
export async function DELETE(req: NextRequest) {
  try {
    const actingUserId = req.nextUrl.searchParams.get("userId");
    const guard = await requireUser(actingUserId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    if (guard.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin privileges required" }, { status: 403 });
    }

    await db.patient.deleteMany({});
    return NextResponse.json({ cleared: true, ...(await loadBoard()) });
  } catch (err) {
    console.error("patients DELETE failed", err);
    return NextResponse.json({ error: "Failed to clear patients" }, { status: 500 });
  }
}
