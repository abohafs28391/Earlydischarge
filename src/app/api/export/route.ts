import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stageOf } from "@/lib/workflow";

function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isoToLocal(iso: Date | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Full discharge log export: every step with its timestamp and actor. */
export async function GET() {
  try {
    const [patients, users] = await Promise.all([
      db.patient.findMany({ orderBy: { importedAt: "asc" } }),
      db.user.findMany(),
    ]);
    const userById = new Map(users.map((u) => [u.id, u.name]));

    const header = [
      "MRN",
      "Patient Name",
      "Room",
      "Floor",
      "Assigned Doctor",
      "Specialty",
      "Stage",
      "Imported At",
      "Medically Cleared At",
      "Medically Cleared By",
      "Template Copied At",
      "Template Copied By",
      "Financial Team Notified At",
      "Financial Team Notified By",
      "Financially Cleared At",
      "Financially Cleared By",
      "Reception Papers Confirmed At",
      "Reception Papers Confirmed By",
      "Physically Discharged At",
      "Physically Discharged By",
      "Total Minutes (Medical -> Discharge)",
    ];

    const lines = [header.join(",")];
    for (const p of patients) {
      const total =
        p.medicalReadyAt && p.physicalDischargedAt
          ? Math.round(
              (p.physicalDischargedAt.getTime() - p.medicalReadyAt.getTime()) / 60000
            )
          : "";
      const row = [
        p.mrn,
        p.name,
        p.room,
        String(p.floor),
        p.doctorName,
        p.doctorSpecialty,
        String(stageOf(patientToStageArg(p))),
        isoToLocal(p.importedAt),
        isoToLocal(p.medicalReadyAt),
        p.medicalReadyById ? userById.get(p.medicalReadyById) ?? "" : "",
        isoToLocal(p.templateCopiedAt),
        p.templateCopiedById ? userById.get(p.templateCopiedById) ?? "" : "",
        isoToLocal(p.financeNotifiedAt),
        p.financeNotifiedById ? userById.get(p.financeNotifiedById) ?? "" : "",
        isoToLocal(p.financeClearedAt),
        p.financeClearedById ? userById.get(p.financeClearedById) ?? "" : "",
        isoToLocal(p.receptionReadyAt),
        p.receptionReadyById ? userById.get(p.receptionReadyById) ?? "" : "",
        isoToLocal(p.physicalDischargedAt),
        p.physicalDischargedById ? userById.get(p.physicalDischargedById) ?? "" : "",
        total === "" ? "" : String(total),
      ];
      lines.push(row.map(csvCell).join(","));
    }

    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `discharge-log-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.csv`;

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("export GET failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

// stageOf works on the JSON shape — build the minimal argument from a Prisma row.
function patientToStageArg(p: {
  medicalReadyAt: Date | null;
  financeNotifiedAt: Date | null;
  financeClearedAt: Date | null;
  receptionReadyAt: Date | null;
  physicalDischargedAt: Date | null;
}) {
  return {
    medicalReadyAt: p.medicalReadyAt?.toISOString() ?? null,
    financeNotifiedAt: p.financeNotifiedAt?.toISOString() ?? null,
    financeClearedAt: p.financeClearedAt?.toISOString() ?? null,
    receptionReadyAt: p.receptionReadyAt?.toISOString() ?? null,
    physicalDischargedAt: p.physicalDischargedAt?.toISOString() ?? null,
  };
}
