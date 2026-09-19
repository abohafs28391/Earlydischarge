import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";
import { ensureUsersSeeded, SPECIALTIES } from "@/lib/seed";
import { userToJson } from "@/lib/serialize";
import { parseFloors } from "@/lib/workflow";

const ORDER: Record<string, number> = {
  ADMIN: 0,
  UNIVERSAL: 1,
  NURSE: 2,
  PHYSICIAN: 3,
  FINANCE: 4,
  RECEPTION: 5,
};

export async function GET() {
  try {
    await ensureUsersSeeded();
    const users = await db.user.findMany({
      orderBy: [{ role: "asc" }, { floors: "asc" }, { name: "asc" }],
    });
    const sorted = [...users].sort(
      (a, b) =>
        (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) ||
        (a.subcategory ?? "").localeCompare(b.subcategory ?? "") ||
        (parseFloors(a.floors)[0] ?? 0) - (parseFloors(b.floors)[0] ?? 0) ||
        a.name.localeCompare(b.name)
    );
    return NextResponse.json({ users: sorted.map(userToJson), specialties: SPECIALTIES });
  } catch (err) {
    console.error("users GET failed", err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}

/** Admin: create a staff account (any category). Nurses take a floors
 *  array — one floor or several (multi-floor nurses pick the floor they
 *  are working on when acting). */
export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      name?: string;
      role?: string;
      floors?: number[] | number | null;
      specialty?: string | null;
      subcategory?: string | null;
    } | null;

    const guard = await requireAdmin(body?.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const name = body?.name?.trim();
    const role = body?.role;
    const VALID_ROLES = ["NURSE", "PHYSICIAN", "FINANCE", "RECEPTION", "UNIVERSAL", "ADMIN"];
    if (!name || !role || !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error:
            "name and a valid role (NURSE | PHYSICIAN | FINANCE | RECEPTION | UNIVERSAL | ADMIN) are required",
        },
        { status: 400 }
      );
    }

    let floors: number[] = [];
    if (role === "NURSE") {
      const raw = Array.isArray(body?.floors)
        ? (body?.floors as number[])
        : body?.floors != null
          ? [Number(body?.floors)]
          : [];
      floors = [...new Set(raw.map(Number))].filter(
        (f) => Number.isInteger(f) && f >= 1 && f <= 30
      );
      if (floors.length === 0) {
        return NextResponse.json(
          { error: "Nurses require at least one floor (1–30)" },
          { status: 400 }
        );
      }
    }
    let specialty: string | null = null;
    if (role === "PHYSICIAN") {
      specialty = body?.specialty?.trim() ?? null;
      if (!specialty) {
        return NextResponse.json({ error: "Physicians require a specialty" }, { status: 400 });
      }
    }
    let subcategory: string | null = null;
    if (role === "UNIVERSAL") {
      subcategory = body?.subcategory === "QUALITY" ? "QUALITY" : "MANAGER";
    }

    const created = await db.user.create({
      data: {
        name,
        role,
        floors: role === "NURSE" ? JSON.stringify(floors) : null,
        specialty,
        subcategory,
        canEdit: true,
        canView: true,
      },
    });

    const users = await db.user.findMany();
    return NextResponse.json({ user: userToJson(created), users: users.map(userToJson) });
  } catch (err) {
    console.error("users POST failed", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

/**
 * Admin: set the editing / viewing privilege of other users — either one
 * account (userId) or a whole category at once ({ scope: { role, subcategory? } }).
 * For a single NURSE account, `floors: number[]` re-assigns the floors the
 * nurse works on (multi-select; at least one floor required).
 * Admin accounts themselves are locked (prevents lockout); admins can always
 * import lists regardless (IMPORTER_ROLES).
 */
export async function PATCH(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      scope?: { role?: string; subcategory?: string };
      canEdit?: boolean;
      canView?: boolean;
      floors?: number[];
      actingUserId?: string;
    } | null;

    // actingUserId identifies the ADMIN doing the change; userId (when
    // present) is the TARGET account whose privileges change.
    const guard = await requireAdmin(body?.actingUserId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const actingId = guard.user.id;

    // Floor re-assignment — single nurse account only.
    if (body?.floors !== undefined) {
      const target = body?.userId ? await db.user.findUnique({ where: { id: body.userId } }) : null;
      if (!target) return NextResponse.json({ error: "userId not found" }, { status: 404 });
      if (target.role !== "NURSE") {
        return NextResponse.json(
          { error: "Only nurse accounts have assignable floors" },
          { status: 400 }
        );
      }
      const floors = [...new Set((body.floors ?? []).map(Number))].filter(
        (f) => Number.isInteger(f) && f >= 1 && f <= 30
      );
      if (floors.length === 0) {
        return NextResponse.json(
          { error: "Nurses require at least one floor (1–30)" },
          { status: 400 }
        );
      }
      const updated = await db.user.update({
        where: { id: target.id },
        data: { floors: JSON.stringify(floors) },
      });
      const users = await db.user.findMany();
      return NextResponse.json({
        updated: `${target.name} — floors ${floors.join(", ")}`,
        user: userToJson(updated),
        users: users.map(userToJson),
      });
    }

    if (body?.canEdit === undefined && body?.canView === undefined) {
      return NextResponse.json(
        { error: "Nothing to update — pass canEdit and/or canView (or floors for a nurse)" },
        { status: 400 }
      );
    }

    const data: { canEdit?: boolean; canView?: boolean } = {};
    if (typeof body?.canEdit === "boolean") data.canEdit = body.canEdit;
    if (typeof body?.canView === "boolean") data.canView = body.canView;

    let where: import("@prisma/client").Prisma.UserWhereInput;
    let scopeLabel: string;

    if (body?.scope?.role) {
      const VALID_ROLES = ["NURSE", "PHYSICIAN", "FINANCE", "RECEPTION", "UNIVERSAL"];
      if (!VALID_ROLES.includes(body.scope.role)) {
        return NextResponse.json(
          {
            error: "Category scope must be one of NURSE | PHYSICIAN | FINANCE | RECEPTION | UNIVERSAL",
          },
          { status: 400 }
        );
      }
      where = { role: body.scope.role, ...(body.scope.subcategory ? { subcategory: body.scope.subcategory } : {}) };
      scopeLabel = body.scope.subcategory
        ? `${body.scope.role} / ${body.scope.subcategory}`
        : body.scope.role;
    } else {
      const target = body?.userId ? await db.user.findUnique({ where: { id: body.userId } }) : null;
      if (!target) return NextResponse.json({ error: "userId not found" }, { status: 404 });
      if (target.id === actingId) {
        return NextResponse.json(
          { error: "You cannot change your own privileges" },
          { status: 400 }
        );
      }
      if (target.role === "ADMIN") {
        return NextResponse.json(
          { error: "Admin privileges are locked to prevent lockout" },
          { status: 400 }
        );
      }
      where = { id: target.id };
      scopeLabel = target.name;
    }

    // Never allow bulk changes to touch admin accounts.
    where = { AND: [where, { role: { not: "ADMIN" } }] };

    await db.user.updateMany({ where, data });
    const users = await db.user.findMany();
    return NextResponse.json({
      updated: scopeLabel,
      users: users.map(userToJson),
    });
  } catch (err) {
    console.error("users PATCH failed", err);
    return NextResponse.json({ error: "Failed to update privileges" }, { status: 500 });
  }
}

/** Admin: delete a staff account. Blocked for admin accounts (lockout
 *  guard) and for accounts that still own audit-trail actions (the append-only
 *  log must keep its attribution — FK constraint enforces this). */
export async function DELETE(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    const guard = await requireAdmin(req.nextUrl.searchParams.get("actingUserId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const targetId = req.nextUrl.searchParams.get("id");
    if (!targetId) return NextResponse.json({ error: "User id is required" }, { status: 400 });
    if (targetId === guard.user.id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }

    const target = await db.user.findUnique({ where: { id: targetId } });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.role === "ADMIN") {
      return NextResponse.json(
        { error: "Admin accounts cannot be deleted (lockout guard)" },
        { status: 400 }
      );
    }

    const actionCount = await db.action.count({ where: { userId: targetId } });
    if (actionCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete — this account owns ${actionCount} logged actions. The audit log must keep its attribution.`,
        },
        { status: 400 }
      );
    }

    await db.user.delete({ where: { id: targetId } });
    const users = await db.user.findMany();
    return NextResponse.json({ deleted: target.name, users: users.map(userToJson) });
  } catch (err) {
    console.error("users DELETE failed", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
