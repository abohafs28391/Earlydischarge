import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeAnalysis } from "@/lib/analysis";
import { ensureUsersSeeded } from "@/lib/seed";
import { patientToJson, userToJson } from "@/lib/serialize";

/**
 * Analysis-tab statistics over a user-selected duration.
 *   ?from=ISO&to=ISO&userId=ID
 * The cohort is every patient imported inside [from, to]; results are
 * additionally scoped to the acting user's visibility (nurses see their
 * floor; finance sees notified patients; physicians/universal/admins see
 * the whole hospital).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureUsersSeeded();

    const params = req.nextUrl.searchParams;
    const fromParam = params.get("from");
    const toParam = params.get("to");

    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(to.getTime() - 30 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return NextResponse.json(
        { error: "Invalid range — from must precede to" },
        { status: 400 }
      );
    }

    // Round the window to whole days so "today" behaves predictably.
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    const [patients, viewerRow] = await Promise.all([
      db.patient.findMany({ orderBy: { importedAt: "asc" } }),
      params.get("userId")
        ? db.user.findUnique({ where: { id: params.get("userId") as string } })
        : Promise.resolve(null),
    ]);

    const viewer = viewerRow ? userToJson(viewerRow) : null;
    if (params.get("userId") && !viewer) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = computeAnalysis(
      patients.map(patientToJson),
      from,
      to,
      new Date(),
      viewer
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("analysis GET failed", err);
    return NextResponse.json({ error: "Failed to compute analysis" }, { status: 500 });
  }
}
