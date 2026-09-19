/** Acting-user guards shared by the API routes (simulated auth). */

import { db } from "@/lib/db";

export interface GuardOk {
  ok: true;
  user: NonNullable<Awaited<ReturnType<typeof db.user.findUnique>>>;
}
export interface GuardFail {
  ok: false;
  error: string;
  status: number;
}

/** Resolve the acting user — every mutating endpoint requires one. */
export async function requireUser(userId: string | null | undefined): Promise<GuardOk | GuardFail> {
  if (!userId) return { ok: false, error: "userId is required", status: 400 };
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  return { ok: true, user };
}

/** Admin-only guard — privilege management, alarm rules, data controls. */
export async function requireAdmin(
  userId: string | null | undefined
): Promise<GuardOk | GuardFail> {
  const base = await requireUser(userId);
  if (!base.ok) return base;
  if (base.user.role !== "ADMIN") {
    return { ok: false, error: "Admin privileges required", status: 403 };
  }
  return base;
}
