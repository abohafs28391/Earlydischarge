import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { evaluateAlarms } from "@/lib/alarms";
import { requireUser } from "@/lib/api-auth";
import { ensureAlarmRulesSeeded, ensureUsersSeeded } from "@/lib/seed";
import { notificationToJson } from "@/lib/serialize";

/**
 * The acting user's notification feed. GET first runs the alarm evaluation
 * (cheap + idempotent via dedupeKeys — this is how alarms flow without a
 * scheduler in this deployment), then returns the latest 30 notifications
 * plus the unread count for the bell badge.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    await ensureAlarmRulesSeeded();

    const userId = req.nextUrl.searchParams.get("userId");
    const guard = await requireUser(userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    await evaluateAlarms().catch((err) => console.error("alarm evaluation failed", err));

    const [notifications, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: guard.user.id },
        include: { patient: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.notification.count({ where: { userId: guard.user.id, readAt: null } }),
    ]);

    return NextResponse.json({
      notifications: notifications.map(notificationToJson),
      unread,
    });
  } catch (err) {
    console.error("notifications GET failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

/** Mark notifications read — one ({ notificationId }) or all at once. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      notificationId?: string;
      all?: boolean;
    } | null;

    const guard = await requireUser(body?.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const now = new Date();
    if (body?.all) {
      await db.notification.updateMany({
        where: { userId: guard.user.id, readAt: null },
        data: { readAt: now },
      });
    } else if (body?.notificationId) {
      const existing = await db.notification.findUnique({
        where: { id: body.notificationId },
      });
      if (!existing || existing.userId !== guard.user.id) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
      await db.notification.update({
        where: { id: body.notificationId },
        data: { readAt: existing.readAt ?? now },
      });
    } else {
      return NextResponse.json(
        { error: "Pass notificationId or all: true" },
        { status: 400 }
      );
    }

    const unread = await db.notification.count({
      where: { userId: guard.user.id, readAt: null },
    });
    return NextResponse.json({ ok: true, unread });
  } catch (err) {
    console.error("notifications POST failed", err);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
