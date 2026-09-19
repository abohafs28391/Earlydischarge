/** Prisma row -> JSON serializers shared by the API routes. */

import type {
  Action,
  AlarmRule,
  Notification,
  Patient,
  User,
  WebhookDelivery,
} from "@prisma/client";
import type { ActionJson, ActionType, PatientJson, Role, UserJson } from "@/lib/workflow";
import { parseFloors } from "@/lib/workflow";

export function userToJson(u: User): UserJson {
  return {
    id: u.id,
    name: u.name,
    role: u.role as Role,
    floors: parseFloors(u.floors),
    specialty: u.specialty,
    subcategory: u.subcategory,
    canEdit: u.canEdit,
    canView: u.canView,
  };
}

export function patientToJson(p: Patient): PatientJson {
  return {
    id: p.id,
    mrn: p.mrn,
    name: p.name,
    room: p.room,
    floor: p.floor,
    doctorName: p.doctorName,
    doctorSpecialty: p.doctorSpecialty,
    isDemo: p.isDemo,
    importedAt: p.importedAt.toISOString(),
    medicalDecision: (p.medicalDecision as PatientJson["medicalDecision"]) ?? null,
    medicalDecisionAt: p.medicalDecisionAt?.toISOString() ?? null,
    medicalDecisionById: p.medicalDecisionById,
    medicalReadyAt: p.medicalReadyAt?.toISOString() ?? null,
    medicalReadyById: p.medicalReadyById,
    templateCopiedAt: p.templateCopiedAt?.toISOString() ?? null,
    templateCopiedById: p.templateCopiedById,
    templateBody: p.templateBody,
    financeNotifiedAt: p.financeNotifiedAt?.toISOString() ?? null,
    financeNotifiedById: p.financeNotifiedById,
    financeClearedAt: p.financeClearedAt?.toISOString() ?? null,
    financeClearedById: p.financeClearedById,
    receptionReadyAt: p.receptionReadyAt?.toISOString() ?? null,
    receptionReadyById: p.receptionReadyById,
    physicalDischargedAt: p.physicalDischargedAt?.toISOString() ?? null,
    physicalDischargedById: p.physicalDischargedById,
  };
}

export function actionToJson(a: Action & { user: User }): ActionJson {
  return {
    id: a.id,
    patientId: a.patientId,
    type: a.type as ActionType,
    userId: a.userId,
    userName: a.user.name,
    userRole: a.user.role as Role,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationJson {
  id: string;
  type: "HANDOFF" | "ALARM";
  title: string;
  body: string;
  patientId: string | null;
  patientName: string | null;
  patientMrn: string | null;
  createdAt: string;
  readAt: string | null;
}

export function notificationToJson(
  n: Notification & { patient?: Patient | null }
): NotificationJson {
  return {
    id: n.id,
    type: n.type as "HANDOFF" | "ALARM",
    title: n.title,
    body: n.body,
    patientId: n.patientId,
    patientName: n.patient?.name ?? null,
    patientMrn: n.patient?.mrn ?? null,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Alarm rules & webhook deliveries
// ---------------------------------------------------------------------------

export interface AlarmRuleJson {
  id: string;
  name: string;
  stage: number;
  level: "WARN" | "LATE";
  thresholdMin: number;
  notifyTaskOwner: boolean;
  webhookUrl: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function alarmRuleToJson(r: AlarmRule): AlarmRuleJson {
  return {
    id: r.id,
    name: r.name,
    stage: r.stage,
    level: r.level as "WARN" | "LATE",
    thresholdMin: r.thresholdMin,
    notifyTaskOwner: r.notifyTaskOwner,
    webhookUrl: r.webhookUrl,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface WebhookDeliveryJson {
  id: string;
  url: string;
  event: string;
  ok: boolean;
  status: string | null;
  patientName: string | null;
  ruleName: string | null;
  createdAt: string;
}

export function webhookDeliveryToJson(
  d: WebhookDelivery & { patient?: Patient | null; alarmRule?: AlarmRule | null }
): WebhookDeliveryJson {
  return {
    id: d.id,
    url: d.url,
    event: d.event,
    ok: d.ok,
    status: d.status,
    patientName: d.patient?.name ?? null,
    ruleName: d.alarmRule?.name ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
