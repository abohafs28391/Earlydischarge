/**
 * DischargeFlow — staff account & alarm-rule seeding.
 * On first load the app auto-creates a representative staff directory:
 *   Nurses (subcategorised by floor — multi-floor where assigned), Physicians
 *   (by specialty), Financial team, Reception personnel, Universal users
 *   (managers & quality), and Admins.
 * Default alarm rules (one WARN + one LATE per pipeline stage, anchored to
 * the draft stage targets) are seeded alongside.
 * Replace with real accounts via the same User model when auth is connected.
 */

import { db } from "@/lib/db";

export const SPECIALTIES = [
  "Internal Medicine",
  "General Surgery",
  "Cardiology",
  "Orthopedics",
  "Pediatrics",
  "Obstetrics & Gynecology",
  "Neurology",
  "Emergency Medicine",
] as const;

export type SeedUser = {
  name: string;
  role: "NURSE" | "PHYSICIAN" | "FINANCE" | "RECEPTION" | "UNIVERSAL" | "ADMIN";
  floors?: number[];
  specialty?: string;
  subcategory?: string;
};

const SEED_USERS: SeedUser[] = [
  // Nurses — subcategorised into floors (2 per floor, floors 1–4);
  // Mariam Sabry is multi-floor (1 & 2): she picks the floor she works on.
  { name: "Aya Hassan", role: "NURSE", floors: [1] },
  { name: "Mariam Sabry", role: "NURSE", floors: [1, 2] },
  { name: "Nour El-Din", role: "NURSE", floors: [2] },
  { name: "Yara Mostafa", role: "NURSE", floors: [2] },
  { name: "Hana Fathi", role: "NURSE", floors: [3] },
  { name: "Omar Khaled", role: "NURSE", floors: [3] },
  { name: "Salma Adel", role: "NURSE", floors: [4] },
  { name: "Laila Ibrahim", role: "NURSE", floors: [4] },

  // Physicians — subcategorised into specialties (they see only their own)
  { name: "Dr. Ahmed Samy", role: "PHYSICIAN", specialty: "Internal Medicine" },
  { name: "Dr. Mona Ezzat", role: "PHYSICIAN", specialty: "Internal Medicine" },
  { name: "Dr. Karim Fouad", role: "PHYSICIAN", specialty: "General Surgery" },
  { name: "Dr. Layla Nasser", role: "PHYSICIAN", specialty: "Cardiology" },
  { name: "Dr. Tarek Gamal", role: "PHYSICIAN", specialty: "Orthopedics" },
  { name: "Dr. Dina Rushdy", role: "PHYSICIAN", specialty: "Pediatrics" },
  { name: "Dr. Amira Zaki", role: "PHYSICIAN", specialty: "Obstetrics & Gynecology" },
  { name: "Dr. Sherif Lotfy", role: "PHYSICIAN", specialty: "Neurology" },
  { name: "Dr. Hossam Farid", role: "PHYSICIAN", specialty: "Emergency Medicine" },

  // Financial team
  { name: "Maya Aslam", role: "FINANCE" },
  { name: "Wael Nasr", role: "FINANCE" },

  // Reception personnel — confirm the discharge papers (stage 4)
  { name: "Sara El-Masry", role: "RECEPTION" },
  { name: "Mona Fawzi", role: "RECEPTION" },

  // Universal — hospital-wide oversight, subcategorised for managers & quality
  { name: "Engy Rostom", role: "UNIVERSAL", subcategory: "MANAGER" },
  { name: "Hazem Shaker", role: "UNIVERSAL", subcategory: "MANAGER" },
  { name: "Nada Guirguis", role: "UNIVERSAL", subcategory: "QUALITY" },
  { name: "Sameh Botros", role: "UNIVERSAL", subcategory: "QUALITY" },

  // Admins — privileges, demo views, alarm & webhook configuration
  { name: "Rania Fahmy (Admin)", role: "ADMIN" },
  { name: "Khaled Mostafa (Admin)", role: "ADMIN" },
];

/** Default alarm rules — WARN at the stage target, LATE at twice it,
 *  mirroring the board's ok/warn/late flagging. Admins can edit or delete
 *  every rule and point alarms at a webhook. */
const DEFAULT_ALARM_RULES: Array<{
  name: string;
  stage: number;
  level: "WARN" | "LATE";
  thresholdMin: number;
}> = [
  { name: "Medical clearance approaching 4h", stage: 1, level: "WARN", thresholdMin: 240 },
  { name: "Medical clearance over 8h", stage: 1, level: "LATE", thresholdMin: 480 },
  { name: "Financial notification approaching 30m", stage: 2, level: "WARN", thresholdMin: 30 },
  { name: "Financial notification over 60m", stage: 2, level: "LATE", thresholdMin: 60 },
  { name: "Financial clearance approaching 2h", stage: 3, level: "WARN", thresholdMin: 120 },
  { name: "Financial clearance over 4h", stage: 3, level: "LATE", thresholdMin: 240 },
  { name: "Reception papers approaching 60m", stage: 4, level: "WARN", thresholdMin: 60 },
  { name: "Reception papers over 2h", stage: 4, level: "LATE", thresholdMin: 120 },
  { name: "Physical discharge approaching 30m", stage: 5, level: "WARN", thresholdMin: 30 },
  { name: "Physical discharge over 1h", stage: 5, level: "LATE", thresholdMin: 60 },
];

let seeding: Promise<void> | null = null;

/** Idempotent — creates the staff directory when missing and tops up new
 *  categories (universal / admin) on databases seeded by older versions. */
export async function ensureUsersSeeded(): Promise<void> {
  if (seeding) return seeding;
  seeding = (async () => {
    const [count, adminCount, universalCount, receptionCount] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { role: "ADMIN" } }),
      db.user.count({ where: { role: "UNIVERSAL" } }),
      db.user.count({ where: { role: "RECEPTION" } }),
    ]);

    if (count === 0) {
      await db.user.createMany({
        data: SEED_USERS.map((u) => ({
          name: u.name,
          role: u.role,
          floors: u.floors ? JSON.stringify(u.floors) : null,
          specialty: u.specialty ?? null,
          subcategory: u.subcategory ?? null,
          canEdit: true,
          canView: true,
        })),
      });
      return;
    }

    // Legacy database (pre-admin/universal/reception): append the new
    // categories only.
    if (adminCount === 0 || universalCount === 0 || receptionCount === 0) {
      const existing = await db.user.findMany({
        select: { name: true, role: true },
      });
      const known = new Set(existing.map((u) => `${u.role}:${u.name}`));
      const missing = SEED_USERS.filter(
        (u) =>
          (u.role === "ADMIN" || u.role === "UNIVERSAL" || u.role === "RECEPTION") &&
          !known.has(`${u.role}:${u.name}`)
      );
      if (missing.length > 0) {
        await db.user.createMany({
          data: missing.map((u) => ({
            name: u.name,
            role: u.role,
            floors: u.floors ? JSON.stringify(u.floors) : null,
            specialty: u.specialty ?? null,
            subcategory: u.subcategory ?? null,
            canEdit: true,
            canView: true,
          })),
        });
      }
    }
  })().catch((err) => {
    seeding = null; // allow retry on failure
    throw err;
  });
  return seeding;
}

let ruleSeeding: Promise<void> | null = null;

/** Idempotent — seeds the default alarm rules when none exist. */
export async function ensureAlarmRulesSeeded(): Promise<void> {
  if (ruleSeeding) return ruleSeeding;
  ruleSeeding = (async () => {
    const count = await db.alarmRule.count();
    if (count > 0) return;
    await db.alarmRule.createMany({
      data: DEFAULT_ALARM_RULES.map((r) => ({
        name: r.name,
        stage: r.stage,
        level: r.level,
        thresholdMin: r.thresholdMin,
        notifyTaskOwner: true,
        webhookUrl: null,
        enabled: true,
      })),
    });
  })().catch((err) => {
    ruleSeeding = null;
    throw err;
  });
  return ruleSeeding;
}
