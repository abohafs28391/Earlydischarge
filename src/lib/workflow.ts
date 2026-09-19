/**
 * DischargeFlow — workflow engine.
 * Single source of truth for the role-based discharge pipeline:
 *
 *   Stage 1  Medical clearance      — physician whose specialty matches the
 *                                     patient's assigned doctor specialty
 *                                     (physicians see ONLY their specialty's
 *                                     patients)
 *   Stage 2  Notify financial team  — nurse revises the system-collated email
 *                                     template, copies it, sends it, marks done
 *   Stage 3  Financial clearance    — financial team (read-only otherwise)
 *   Stage 4  Reception              — reception personnel confirm all discharge
 *                                     papers are done. From financial clearance
 *                                     until departure the patient is listed in
 *                                     BOTH the Reception and the Physical
 *                                     Discharge columns.
 *   Stage 5  Physical discharge     — nurse marks the departure (papers must
 *                                     be confirmed by reception first)
 *   Stage 6  Discharged             — completed, full audit trail attached;
 *                                     listed via the header Discharged button
 *
 * Beyond the operating roles, two oversight categories exist:
 *   UNIVERSAL (managers / quality) — hospital-wide read-only visibility
 *   ADMIN                        — sets edit/view privileges for everyone,
 *                                  demos any user view (read-only), and owns
 *                                  alarm rules + webhook notifications
 *
 * Nurses may be assigned to ONE OR MORE floors (admin multi-select). A
 * multi-floor nurse picks the floor they are currently working on — the
 * board is then scoped to that floor.
 *
 * Every step logs WHEN (timestamp) and WHO (user id). Shared by API routes
 * (authoritative validation) and the UI (button gating, board rendering).
 */

export type Role = "NURSE" | "PHYSICIAN" | "FINANCE" | "RECEPTION" | "UNIVERSAL" | "ADMIN";

export const ROLE_LABELS: Record<Role, string> = {
  NURSE: "Nurse",
  PHYSICIAN: "Physician",
  FINANCE: "Financial team",
  RECEPTION: "Reception",
  UNIVERSAL: "Universal",
  ADMIN: "Admin",
};

/** Users in these roles never perform pipeline steps themselves. */
export const OVERSIGHT_ROLES: Role[] = ["UNIVERSAL", "ADMIN"];

/** Roles allowed to import the patient list (the workflow entry point). */
export const IMPORTER_ROLES: Role[] = ["ADMIN", "NURSE"];

export type ActionType =
  | "IMPORTED"
  | "MEDICAL_DECIDED_DISCHARGE"
  | "MEDICAL_DECIDED_NO"
  | "MEDICAL_UNDO"
  | "MEDICAL_READY"
  | "COPY_TEMPLATE"
  | "FINANCE_NOTIFIED"
  | "FINANCE_CLEARED"
  | "RECEPTION_READY"
  | "PHYSICAL_DISCHARGED"
  | "COPY_CANCEL_TEMPLATE"
  | "CANCEL_DISCHARGE";

export const ACTION_LABELS: Record<ActionType, string> = {
  IMPORTED: "Patient imported",
  MEDICAL_DECIDED_DISCHARGE: "Discharge decision recorded",
  MEDICAL_DECIDED_NO: "No-discharge decision recorded",
  MEDICAL_UNDO: "Decision undone",
  MEDICAL_READY: "Medically cleared",
  COPY_TEMPLATE: "Email template copied",
  FINANCE_NOTIFIED: "Financial team notified",
  FINANCE_CLEARED: "Financially cleared",
  RECEPTION_READY: "Reception papers confirmed",
  PHYSICAL_DISCHARGED: "Physically discharged",
  COPY_CANCEL_TEMPLATE: "Cancellation template copied",
  CANCEL_DISCHARGE: "Discharge cancelled",
};

/** Seconds between a physician's DISCHARGE decision and the patient moving
 *  to stage 2 — the undo / change window. Admin-adjustable at runtime via the
 *  "decision.window.sec" setting (see lib/decision-window); this constant is
 *  the default and the fallback. */
export const DEFAULT_DECISION_WINDOW_SEC = 60;

/** Allowed range for the admin-adjustable decision window (seconds). */
export const DECISION_WINDOW_MIN_SEC = 1;
export const DECISION_WINDOW_MAX_SEC = 600;

// ---------------------------------------------------------------------------
// Serialized JSON types (API <-> UI)
// ---------------------------------------------------------------------------

export interface UserJson {
  id: string;
  name: string;
  role: Role;
  floors: number[]; // nurses — one or more assigned floors (others: empty)
  specialty: string | null;
  subcategory: string | null; // universal users: MANAGER | QUALITY
  canEdit: boolean; // privilege set by admins — false = view-only account
  canView: boolean; // privilege set by admins — false = board hidden
}

/** Parse the JSON-encoded floors column of a User row ("[1,2]" -> [1,2]). */
export function parseFloors(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((f) => Number.isInteger(f)) : [];
  } catch {
    return [];
  }
}

export interface PatientJson {
  id: string;
  mrn: string;
  name: string;
  room: string;
  floor: number;
  doctorName: string;
  doctorSpecialty: string;
  isDemo: boolean;
  importedAt: string;
  /** Standing stage-1 physician decision: "DISCHARGE" | "NO_DISCHARGE" |
   *  null (not decided yet). A pending DISCHARGE advances to stage 2 once
   *  the decision window elapses (see lib/decision-window). */
  medicalDecision: "DISCHARGE" | "NO_DISCHARGE" | null;
  medicalDecisionAt: string | null;
  medicalDecisionById: string | null;
  medicalReadyAt: string | null;
  medicalReadyById: string | null;
  templateCopiedAt: string | null;
  templateCopiedById: string | null;
  templateBody: string | null;
  financeNotifiedAt: string | null;
  financeNotifiedById: string | null;
  financeClearedAt: string | null;
  financeClearedById: string | null;
  receptionReadyAt: string | null;
  receptionReadyById: string | null;
  physicalDischargedAt: string | null;
  physicalDischargedById: string | null;
}

export interface ActionJson {
  id: string;
  patientId: string;
  type: ActionType;
  userId: string;
  userName: string;
  userRole: Role | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Stage model
// ---------------------------------------------------------------------------

export interface StageMeta {
  num: number;
  key: "medical" | "notify" | "finance" | "reception" | "physical" | "done";
  title: string;
  short: string;
  owner: string;
  description: string;
}

export const STAGES: StageMeta[] = [
  {
    num: 1,
    key: "medical",
    title: "Medical Clearance",
    short: "Medical",
    owner: "Assigned-doctor specialty physicians",
    description:
      "Patient admitted and awaiting the physician's decision: Discharge or No discharge. Only a physician whose specialty matches the assigned doctor's specialty can decide — and physicians only see the patients of their own specialty. A Discharge decision moves the patient on after a confirmation window (default 60s) during which the physician can undo or change it.",
  },
  {
    num: 2,
    key: "notify",
    title: "Notify Financial Team",
    short: "Notify",
    owner: "Floor nurse",
    description:
      "The system collates an email template from the patient record; the nurse revises it, copies it, sends it to the financial team, then marks the stage completed. If the discharge is called off instead, the nurse copies the cancellation template and cancels (typed confirmation) — the patient returns to Medical Clearance.",
  },
  {
    num: 3,
    key: "finance",
    title: "Financial Clearance",
    short: "Financial",
    owner: "Financial team",
    description:
      "The financial team sees the notified patients with full data, read-only, and marks each one ready for discharge financially.",
  },
  {
    num: 4,
    key: "reception",
    title: "Reception",
    short: "Reception",
    owner: "Reception personnel",
    description:
      "Once financially cleared, the patient appears here AND in Physical Discharge. Reception personnel confirm all discharge papers are done and mark the patient ready to physically leave.",
  },
  {
    num: 5,
    key: "physical",
    title: "Physical Discharge",
    short: "Physical",
    owner: "Floor nurse",
    description:
      "The floor nurse marks the patient physically discharged once reception has confirmed the papers. Until then the card here shows what reception is still preparing.",
  },
  {
    num: 6,
    key: "done",
    title: "Discharged",
    short: "Done",
    owner: "—",
    description:
      "Patient has physically left the unit. Discharged patients are listed via the Discharged button in the header, with their full audit trail.",
  },
];

/** Structural input for stageOf — callers may pass any object carrying
 *  the five step timestamps (e.g. a partial built from a Prisma row). */
export type StageTimestamps = Pick<
  PatientJson,
  | "medicalReadyAt"
  | "financeNotifiedAt"
  | "financeClearedAt"
  | "receptionReadyAt"
  | "physicalDischargedAt"
>;

export function stageOf(p: StageTimestamps): number {
  if (p.physicalDischargedAt) return 6;
  if (p.receptionReadyAt) return 5;
  if (p.financeClearedAt) return 4;
  if (p.financeNotifiedAt) return 3;
  if (p.medicalReadyAt) return 2;
  return 1;
}

/** ISO timestamp of when the patient entered the given stage. */
export function stageEntryAt(p: PatientJson, stage: number): string {
  switch (stage) {
    case 1:
      return p.importedAt;
    case 2:
      return p.medicalReadyAt ?? p.importedAt;
    case 3:
      return p.financeNotifiedAt ?? p.importedAt;
    case 4:
      return p.financeClearedAt ?? p.importedAt;
    case 5:
      return p.receptionReadyAt ?? p.importedAt;
    default:
      return p.physicalDischargedAt ?? p.importedAt;
  }
}

// ---------------------------------------------------------------------------
// Draft stage-duration targets (flag = early warning, not a hard rule)
// ---------------------------------------------------------------------------

export interface StageTarget {
  targetMin: number;
  label: string;
  basis: string;
  calibrated: boolean;
}

export const STAGE_TARGETS: Record<number, StageTarget> = {
  1: {
    targetMin: 240,
    label: "Medical clearance > 4h since import",
    basis: "DRAFT — no imported-list benchmark; waiting time is measured from list import. Calibrate to your rounding schedule.",
    calibrated: false,
  },
  2: {
    targetMin: 30,
    label: "Notification email > 30 min since medical clearance",
    basis: "DRAFT — internal handoff target; the shorter the order-to-notification gap, the earlier the financial team can start.",
    calibrated: false,
  },
  3: {
    targetMin: 120,
    label: "Financial clearance > 2h since notification",
    basis: "DRAFT — no published financial-clearance TAT benchmark located (prior-authorization delays are documented, AMA 2024, but stage-specific timing is not). Calibrate against your own distribution.",
    calibrated: false,
  },
  4: {
    targetMin: 60,
    label: "Reception papers > 60 min since financial clearance",
    basis: "DRAFT — the former 90-min combined post-finance target, split between reception papers and departure once Reception became its own stage. Calibrate on your own data.",
    calibrated: false,
  },
  5: {
    targetMin: 30,
    label: "Physical discharge > 30 min since papers confirmed",
    basis: "UCLA Health 2025: median order-to-departure 171 min, improved to 88 min; El-Abbassy 2021: 3h maximum acceptable from discharge decision to actual discharge.",
    calibrated: true,
  },
};

/** Total pipeline target: medical clearance -> physical departure. */
export const TOTAL_TARGET_MIN = 180; // El-Abbassy 2021 — 3h acceptable maximum

export type FlagLevel = "ok" | "warn" | "late";

export function flagFor(minutesInStage: number, targetMin: number): FlagLevel {
  if (minutesInStage >= targetMin * 2) return "late";
  if (minutesInStage >= targetMin) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// Room number coding: "201" -> floor 2, "1125" -> floor 11, "12" -> floor 1
// ---------------------------------------------------------------------------

export function floorFromRoom(room: string): number | null {
  const digits = room.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 100) return Math.floor(n / 100);
  if (n >= 10) return Math.floor(n / 10);
  return 1; // single-digit rooms sit on the ground/first floor
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export interface PatientPermissions {
  visible: boolean;
  /** Physician of the matching specialty may record / change the stage-1
   *  Discharge / No-discharge decision (and undo inside the window). */
  canMedicalDecide: boolean;
  /** Floor nurse may copy the cancellation mail and cancel a stage-2
   *  discharge (typed confirmation), sending the patient back to stage 1. */
  canCancelDischarge: boolean;
  canOpenTemplate: boolean;
  canMarkNotified: boolean;
  canFinanceClear: boolean;
  canReceptionReady: boolean;
  canPhysicalDischarge: boolean;
}

function sameSpecialty(user: UserJson, p: PatientJson): boolean {
  return (
    !!user.specialty &&
    user.specialty.trim().toLowerCase() === p.doctorSpecialty.trim().toLowerCase()
  );
}

function isFloorNurse(user: UserJson, p: PatientJson): boolean {
  return user.role === "NURSE" && user.floors.includes(p.floor);
}

/** Which patients a given user can see on their board. */
export function isVisibleTo(user: UserJson, p: PatientJson): boolean {
  switch (user.role) {
    case "NURSE":
      return user.floors.includes(p.floor);
    case "PHYSICIAN":
      // physicians see ONLY the patients assigned to their own specialty
      return sameSpecialty(user, p);
    case "RECEPTION":
      return stageOf(p) >= 4; // reception sees patients once financially cleared
    case "UNIVERSAL":
    case "ADMIN":
      return true; // oversight roles see the whole hospital
    case "FINANCE":
      return stageOf(p) >= 3; // financial team sees patients once notified
  }
}

export function permissionsFor(user: UserJson | null, p: PatientJson): PatientPermissions {
  const none: PatientPermissions = {
    visible: false,
    canMedicalDecide: false,
    canCancelDischarge: false,
    canOpenTemplate: false,
    canMarkNotified: false,
    canFinanceClear: false,
    canReceptionReady: false,
    canPhysicalDischarge: false,
  };
  if (!user) return none;

  // Admin-set privileges: view-only accounts never act. Oversight roles
  // (universal / admin) supervise — they demo views instead of acting.
  const editAllowed = user.canView && user.canEdit && !OVERSIGHT_ROLES.includes(user.role);

  const stage = stageOf(p);
  const visible = isVisibleTo(user, p);
  const nurse = isFloorNurse(user, p);

  return {
    visible,
    canMedicalDecide:
      editAllowed && visible && stage === 1 && user.role === "PHYSICIAN" && sameSpecialty(user, p),
    canCancelDischarge: editAllowed && visible && nurse && stage === 2,
    canOpenTemplate: editAllowed && visible && nurse && stage === 2 && !p.templateCopiedAt,
    canMarkNotified: editAllowed && visible && nurse && stage === 2 && !!p.templateCopiedAt && !p.financeNotifiedAt,
    canFinanceClear: editAllowed && visible && stage === 3 && user.role === "FINANCE",
    canReceptionReady:
      editAllowed && visible && stage === 4 && user.role === "RECEPTION" && !p.receptionReadyAt,
    canPhysicalDischarge:
      editAllowed && visible && nurse && stage === 5 && !!p.receptionReadyAt && !p.physicalDischargedAt,
  };
}

/** Server-side validation for POST /api/actions — mirrors permissionsFor.
 * `demo` marks an admin demoing another user's view: strictly read-only.
 * `decisionWindowSec` is the current undo-window length (from the setting) —
 * it gates MEDICAL_UNDO timing. */
export function validateAction(
  user: UserJson,
  p: PatientJson,
  type: ActionType,
  demo = false,
  decisionWindowSec: number = DEFAULT_DECISION_WINDOW_SEC
): { ok: true } | { ok: false; reason: string } {
  if (demo) {
    return { ok: false, reason: "Read-only admin demo view — exit demo to act as yourself" };
  }
  if (!user.canView) {
    return { ok: false, reason: "This account's view privilege is disabled — contact an admin" };
  }
  if (!user.canEdit) {
    return { ok: false, reason: "This account is in view-only mode — an admin can re-enable editing" };
  }
  const perm = permissionsFor(user, p);
  const map: Record<ActionType, { allowed: boolean; reason: string }> = {
    IMPORTED: { allowed: false, reason: "Imported rows are created via the import endpoint" },
    MEDICAL_READY: {
      // internal only — stamped by the decision-window promotion, never by
      // a direct API call: physicians record decisions instead
      allowed: false,
      reason:
        "Medical clearance now flows from the physician's Discharge decision — it auto-confirms once the decision window closes",
    },
    MEDICAL_DECIDED_DISCHARGE: {
      allowed: perm.canMedicalDecide,
      reason:
        "Only a physician matching the assigned doctor's specialty can record a discharge decision while the patient awaits one",
    },
    MEDICAL_DECIDED_NO: {
      allowed: perm.canMedicalDecide,
      reason:
        "Only a physician matching the assigned doctor's specialty can record a no-discharge decision while the patient awaits one",
    },
    MEDICAL_UNDO: { allowed: true, reason: "" }, // validated in full below
    COPY_TEMPLATE: {
      allowed: perm.canOpenTemplate,
      reason: "Only a floor nurse can copy the notification template at this stage",
    },
    FINANCE_NOTIFIED: {
      allowed: perm.canMarkNotified,
      reason: "Template must be copied first; a floor nurse then marks the notification completed",
    },
    FINANCE_CLEARED: {
      allowed: perm.canFinanceClear,
      reason: "Only the financial team can mark a patient financially cleared",
    },
    RECEPTION_READY: {
      allowed: perm.canReceptionReady,
      reason: "Only reception personnel can confirm the discharge papers at this stage",
    },
    PHYSICAL_DISCHARGED: {
      allowed: perm.canPhysicalDischarge,
      reason: "Reception must confirm the papers first; a floor nurse then marks the patient physically discharged",
    },
    COPY_CANCEL_TEMPLATE: {
      allowed: perm.canCancelDischarge,
      reason: "Only a floor nurse can copy the cancellation template at this stage",
    },
    CANCEL_DISCHARGE: {
      allowed: perm.canCancelDischarge,
      reason: "Only a floor nurse can cancel a discharge at the notification stage",
    },
  };
  const entry = map[type];
  if (!entry.allowed) return { ok: false, reason: entry.reason };

  // MEDICAL_UNDO — undo / change a pending DISCHARGE decision inside the
  // confirmation window (the route promotes expired decisions first, so a
  // closed window shows up here as stage !== 1).
  if (type === "MEDICAL_UNDO") {
    if (!perm.canMedicalDecide) {
      return {
        ok: false,
        reason:
          "Only a physician matching the assigned doctor's specialty can undo a decision, while the patient still awaits one",
      };
    }
    if (p.medicalDecision !== "DISCHARGE" || !p.medicalDecisionAt) {
      return { ok: false, reason: "There is no pending discharge decision to undo" };
    }
    const elapsedSec = (Date.now() - new Date(p.medicalDecisionAt).getTime()) / 1000;
    if (elapsedSec >= decisionWindowSec) {
      return {
        ok: false,
        reason: `The ${decisionWindowSec}s confirmation window has closed — the patient has already moved on`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Computed board view
// ---------------------------------------------------------------------------

export interface PatientView extends PatientJson {
  stage: number;
  stageEntry: string;
  minutesInStage: number;
  flag: FlagLevel;
  stageTargetMin: number | null;
  totalMinutes: number | null; // medical clearance -> physical discharge
  completedToday: boolean;
  departedBeforeNoon: boolean | null;
}

export function computeView(p: PatientJson, now: Date): PatientView {
  const stage = stageOf(p);
  const entry = stageEntryAt(p, stage);
  const minutesInStage =
    stage === 6 ? 0 : Math.max(0, Math.round((now.getTime() - new Date(entry).getTime()) / 60000));
  const target = STAGE_TARGETS[stage];
  const totalMinutes =
    p.medicalReadyAt && p.physicalDischargedAt
      ? Math.max(
          0,
          Math.round(
            (new Date(p.physicalDischargedAt).getTime() - new Date(p.medicalReadyAt).getTime()) /
              60000
          )
        )
      : null;
  const departed = p.physicalDischargedAt ? new Date(p.physicalDischargedAt) : null;

  return {
    ...p,
    stage,
    stageEntry: entry,
    minutesInStage,
    flag: target ? flagFor(minutesInStage, target.targetMin) : "ok",
    stageTargetMin: target?.targetMin ?? null,
    totalMinutes,
    completedToday: !!departed && departed.toDateString() === now.toDateString(),
    departedBeforeNoon: departed ? departed.getHours() < 12 : null,
  };
}

// ---------------------------------------------------------------------------
// System-collated financial-notification email template
// ---------------------------------------------------------------------------

export function buildFinanceEmail(
  p: PatientJson,
  medicalReadyByName: string | null,
  nurse: UserJson
): { subject: string; body: string } {
  const cleared = p.medicalReadyAt
    ? `${fmtTimeStatic(p.medicalReadyAt)}${medicalReadyByName ? ` by ${medicalReadyByName}` : ""}`
    : "pending";

  const subject = `Financial Clearance Request — ${p.name} (MRN ${p.mrn}, Room ${p.room})`;

  const body = [
    "Dear Financial Team,",
    "",
    "The following patient has been medically cleared for discharge and is awaiting financial clearance:",
    "",
    `Patient name: ${p.name}`,
    `MRN: ${p.mrn}`,
    `Room / Bed: ${p.room} (Floor ${p.floor})`,
    `Assigned doctor: ${p.doctorName} (${p.doctorSpecialty})`,
    `Medically cleared: ${cleared}`,
    "",
    "Please proceed with the financial clearance at your earliest convenience and confirm once the account is ready for discharge.",
    "",
    "Kind regards,",
    `${nurse.name}`,
    `Floor ${p.floor} Nursing Team`,
  ].join("\n");

  return { subject, body };
}

function fmtTimeStatic(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// System-collated cancellation template (stage-2 "Send cancel mail")
// ---------------------------------------------------------------------------

/** The cancellation mail a nurse copies when a discharge is called off at
 *  the notification stage — counterpart to buildFinanceEmail. Copying it is
 *  logged (COPY_CANCEL_TEMPLATE); the actual send happens from the nurse's
 *  own email client, mirroring the notification-template flow. */
export function buildCancelEmail(
  p: PatientJson,
  nurse: UserJson
): { subject: string; body: string } {
  const subject = `Discharge Cancellation — ${p.name} (MRN ${p.mrn}, Room ${p.room})`;

  const body = [
    "Dear Financial Team,",
    "",
    "The discharge process for the patient below has been CANCELLED. Please disregard any earlier financial-clearance request for this account:",
    "",
    `Patient name: ${p.name}`,
    `MRN: ${p.mrn}`,
    `Room / Bed: ${p.room} (Floor ${p.floor})`,
    `Assigned doctor: ${p.doctorName} (${p.doctorSpecialty})`,
    `Medically cleared: ${p.medicalReadyAt ? fmtTimeStatic(p.medicalReadyAt) : "pending"}`,
    "",
    "The patient has been returned to Medical Clearance and will re-enter the discharge workflow if the decision changes. No further financial action is needed for now.",
    "",
    "Kind regards,",
    `${nurse.name}`,
    `Floor ${p.floor} Nursing Team`,
  ].join("\n");

  return { subject, body };
}
