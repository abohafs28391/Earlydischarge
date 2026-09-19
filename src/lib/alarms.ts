/**
 * DischargeFlow — notifications & alarm engine.
 *
 * Two notification streams reach TASK OWNERS (never bystanders):
 *
 *   HANDOFF  — fired the moment a patient enters a stage: the owners of the
 *              NEW stage learn the patient is now waiting for them.
 *   ALARM    — fired when a patient's stay in the current stage crosses an
 *              admin-configured AlarmRule threshold. Alarms additionally
 *              POST a webhook (per-rule URL or the global default) so the
 *              hospital can route pings wherever it wants (for now webhook;
 *              transport is swappable later). Outbound payloads are shaped
 *              per channel, auto-detected from the URL — Discord / Slack /
 *              Teams get channel-formatted PHI-lite text, anything else gets
 *              the full DischargeFlow JSON (see lib/webhook-channels).
 *
 * Everything is deduplicated via stable dedupeKeys, so re-running the
 * evaluation (each poll does) never duplicates notifications or webhooks.
 */

import type { AlarmRule, Patient, User } from "@prisma/client";
import { db } from "@/lib/db";
import { patientToJson, userToJson } from "@/lib/serialize";
import type { PatientJson, UserJson } from "@/lib/workflow";
import { STAGES, stageOf, stageEntryAt, ROLE_LABELS, parseFloors } from "@/lib/workflow";
import {
  buildChannelPayload,
  detectWebhookChannel,
  isExternalChannel,
  type WebhookChannel,
  type WebhookMessage,
} from "@/lib/webhook-channels";

const GLOBAL_WEBHOOK_KEY = "webhook.url";
const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * ⚠️ TESTING-ONLY HARDCODED DEFAULT — a live Discord webhook used while the
 * alarm pipeline is being evaluated end-to-end. It applies ONLY while no URL
 * has been saved by an admin (Admin → Alarms → Global webhook always wins,
 * and users can change it there at any time).
 *
 * TODO(remove-before-production): delete this constant together with the
 * fallback line in getGlobalWebhookState(); the app then reverts to
 * "no webhook configured" (null) until an admin saves one.
 */
const TEST_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1469779141971808481/hOBDt_qb7qBcjUUHy-CywiCz87Fi8hmc6Ixka8oZe9myIj6U1R66z7VPVXxcq4Hqd15k";

// ---------------------------------------------------------------------------
// Task-owner resolution — who owns a patient's current stage
// ---------------------------------------------------------------------------

/**
 * The task owners of a patient's CURRENT stage:
 *   stage 1 -> physicians whose specialty matches the assigned doctor's
 *   stage 2 -> nurses assigned to the patient's floor
 *   stage 3 -> the financial team
 *   stage 4 -> the reception personnel
 *   stage 5 -> nurses assigned to the patient's floor
 * Accounts with their view privilege disabled are skipped (nothing to see,
 * nothing to be pinged about).
 */
export function taskOwnersForStage(
  users: User[],
  patient: Patient | PatientJson,
  stage: number
): User[] {
  const active = users.filter((u) => u.canView);
  switch (stage) {
    case 1:
      return active.filter(
        (u) =>
          u.role === "PHYSICIAN" &&
          (u.specialty ?? "").trim().toLowerCase() ===
            patient.doctorSpecialty.trim().toLowerCase()
      );
    case 2:
    case 5:
      return active.filter(
        (u) => u.role === "NURSE" && parseFloors(u.floors).includes(patient.floor)
      );
    case 3:
      return active.filter((u) => u.role === "FINANCE");
    case 4:
      return active.filter((u) => u.role === "RECEPTION");
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Notification creation (deduplicated)
// ---------------------------------------------------------------------------

interface NotificationDraft {
  userId: string;
  patientId: string;
  type: "HANDOFF" | "ALARM";
  title: string;
  body: string;
  dedupeKey: string;
}

async function createNotifications(rows: NotificationDraft[]): Promise<number> {
  if (rows.length === 0) return 0;
  const existing = await db.notification.findMany({
    where: { dedupeKey: { in: rows.map((r) => r.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const have = new Set(existing.map((e) => e.dedupeKey));
  const fresh = rows.filter((r) => !have.has(r.dedupeKey));
  if (fresh.length === 0) return 0;
  await db.notification.createMany({ data: fresh });
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Handoff notifications — "the patient is now waiting for your stage"
// ---------------------------------------------------------------------------

const HANDOFF_TEXT: Record<number, { title: string; body: (p: PatientJson) => string }> = {
  1: {
    title: "New patient awaiting medical clearance",
    body: (p) =>
      `${p.name} (Room ${p.room}, floor ${p.floor}) was imported with assigned doctor ${p.doctorName} (${p.doctorSpecialty}). Medical clearance is the first pipeline step.`,
  },
  2: {
    title: "Patient medically cleared — send the financial notification",
    body: (p) =>
      `${p.name} (Room ${p.room}, floor ${p.floor}) is medically cleared. Revise the collated email template, copy it, send it to the financial team, then mark the stage completed.`,
  },
  3: {
    title: "Financial clearance requested",
    body: (p) =>
      `${p.name} (Room ${p.room}, floor ${p.floor}) has been notified to your team. Review the account and mark the patient financially cleared.`,
  },
  4: {
    title: "Patient financially cleared — prepare the discharge papers",
    body: (p) =>
      `${p.name} (Room ${p.room}, floor ${p.floor}) is financially cleared. Confirm all discharge papers are done, then mark the patient ready for physical discharge.`,
  },
  5: {
    title: "Papers confirmed — complete the physical discharge",
    body: (p) =>
      `${p.name} (Room ${p.room}, floor ${p.floor}) has all papers confirmed by reception. Complete the physical discharge and mark the patient departed.`,
  },
};

/** Notify the owners of `stage` that the patient just entered their stage.
 *  `variant` optionally overrides the title/body AND the dedupe key — used
 *  by the stage-2 cancel flow so "returned after a cancelled discharge"
 *  reads differently from the original import handoff. */
export async function notifyHandoff(
  patientRow: Patient,
  stage: number,
  variant?: { key: string; title: string; body: string }
): Promise<void> {
  const text = variant ?? HANDOFF_TEXT[stage];
  if (!text) return; // stage 6 (discharged) has no owner to hand off to
  const users = await db.user.findMany();
  const owners = taskOwnersForStage(users, patientRow, stage);
  if (owners.length === 0) return;
  const patientJson = patientToJson(patientRow);
  await createNotifications(
    owners.map((u) => ({
      userId: u.id,
      patientId: patientRow.id,
      type: "HANDOFF" as const,
      title: text.title,
      body: typeof text.body === "string" ? text.body : text.body(patientJson),
      dedupeKey: variant
        ? `handoff:${stage}:${variant.key}:${patientRow.id}:${u.id}`
        : `handoff:${stage}:${patientRow.id}:${u.id}`,
    }))
  );
}

/** Notify stage-1 owners (specialty physicians) right after an import. */
export async function notifyImported(patientRow: Patient): Promise<void> {
  await notifyHandoff(patientRow, 1);
}

// ---------------------------------------------------------------------------
// Webhook delivery (with log + dedupe)
// ---------------------------------------------------------------------------

export interface GlobalWebhookState {
  /** Effective URL alarms fire at (saved value, or the testing default). */
  url: string | null;
  /** True while the effective URL is the hardcoded testing default above —
   *  i.e. no admin-saved URL. Surfaced as a warning note in the admin UI. */
  isTestDefault: boolean;
}

export async function getGlobalWebhookState(): Promise<GlobalWebhookState> {
  const row = await db.setting.findUnique({ where: { key: GLOBAL_WEBHOOK_KEY } });
  const saved = row?.value?.trim() ? row.value.trim() : null;
  if (saved) return { url: saved, isTestDefault: false };
  // TESTING-ONLY fallback — remove together with TEST_WEBHOOK_URL.
  return { url: TEST_WEBHOOK_URL, isTestDefault: true };
}

export async function getGlobalWebhookUrl(): Promise<string | null> {
  return (await getGlobalWebhookState()).url;
}

export async function setGlobalWebhookUrl(url: string): Promise<void> {
  const value = url.trim();
  if (!value) {
    await db.setting.delete({ where: { key: GLOBAL_WEBHOOK_KEY } }).catch(() => undefined);
    return;
  }
  await db.setting.upsert({
    where: { key: GLOBAL_WEBHOOK_KEY },
    create: { key: GLOBAL_WEBHOOK_KEY, value },
    update: { value },
  });
}

interface WebhookOutcome {
  ok: boolean;
  status: string;
}

async function postWebhook(url: string, payload: unknown): Promise<WebhookOutcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, status: `HTTP ${res.status}` };
    // Surface the receiver's own error body (Discord, for example, answers
    // 400 {"message":"Cannot send an empty message","code":50006}) so the
    // delivery log shows the actual reason instead of a bare status code.
    const detail = (await res.text().catch(() => "")).trim().slice(0, 200);
    return { ok: false, status: `HTTP ${res.status}${detail ? ` — ${detail}` : ""}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, status: msg.slice(0, 120) };
  }
}

interface DeliveryDraft {
  url: string;
  event: "alarm" | "test";
  payload: unknown;
  alarmRuleId?: string | null;
  patientId?: string | null;
  dedupeKey?: string | null;
}

/** POST a webhook and append the outcome to the delivery log. */
async function deliverWebhook(d: DeliveryDraft): Promise<WebhookOutcome> {
  if (d.dedupeKey) {
    const seen = await db.webhookDelivery.findUnique({ where: { dedupeKey: d.dedupeKey } });
    if (seen) return { ok: true, status: "already sent" };
  }
  const outcome = await postWebhook(d.url, d.payload);
  await db.webhookDelivery
    .create({
      data: {
        url: d.url,
        event: d.event,
        payload: JSON.stringify(d.payload).slice(0, 4000),
        ok: outcome.ok,
        status: outcome.status,
        alarmRuleId: d.alarmRuleId ?? null,
        patientId: d.patientId ?? null,
        dedupeKey: d.dedupeKey ?? null,
      },
    })
    .catch(() => undefined); // logging must never break the workflow
  return outcome;
}

/** Admin "send test ping" action — always fires, always logged.
 *  `channelOverride` forces a channel (used by tests and edge-case URLs). */
export async function sendTestWebhook(
  url: string,
  admin: User,
  channelOverride?: WebhookChannel
): Promise<WebhookOutcome> {
  const channel = channelOverride ?? detectWebhookChannel(url);
  const sentAt = new Date().toISOString();
  const sentBy = `${admin.name} (${ROLE_LABELS[userToJson(admin).role]})`;
  return deliverWebhook({
    url,
    event: "test",
    payload: buildChannelPayload(channel, {
      title: "DischargeFlow webhook test",
      lines: [
        "Configuration OK — delay alarms will land in this channel.",
        `Sent by ${sentBy}`,
        `Sent at ${sentAt}`,
      ],
      fields: { event: "test", source: "DischargeFlow", sentBy, sentAt },
    }),
  });
}

// ---------------------------------------------------------------------------
// Alarm evaluation
// ---------------------------------------------------------------------------

export interface AlarmEvaluationResult {
  checkedPatients: number;
  firedRules: number;
  notificationsCreated: number;
  webhooksFired: number;
}

function minutesSince(iso: Date | string, now: Date): number {
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

/**
 * Build the alarm message for an outbound webhook. External IM channels
 * (Discord / Slack / Teams) receive PHI-lite text — room, floor, stage timing,
 * enough to act on the board — while generic receivers keep the full
 * structured payload (patient identifiers included).
 */
function alarmWebhookMessage(
  channel: WebhookChannel,
  rule: AlarmRule,
  p: PatientJson,
  stage: number,
  minutesInStage: number,
  stageMeta: { title: string; owner: string },
  taskOwnerNames: string[],
  now: Date
): WebhookMessage {
  const title = `${rule.level === "LATE" ? "LATE" : "Warning"}: ${stageMeta.title} over ${rule.thresholdMin} min`;
  if (isExternalChannel(channel)) {
    return {
      title,
      lines: [
        `Room ${p.room} (floor ${p.floor}) has been in "${stageMeta.title}" for ${minutesInStage} min — rule "${rule.name}" fired.`,
        `Stage owner: ${stageMeta.owner}. Open the DischargeFlow board to act.`,
      ],
    };
  }
  return {
    title,
    lines: [
      `${p.name} (Room ${p.room}, floor ${p.floor}) has been in "${stageMeta.title}" for ${minutesInStage} min — rule "${rule.name}" fired.`,
      `Stage owner: ${stageMeta.owner}. Task owners: ${taskOwnerNames.join(", ") || "—"}.`,
    ],
    fields: {
      event: "alarm",
      source: "DischargeFlow",
      firedAt: now.toISOString(),
      rule: {
        id: rule.id,
        name: rule.name,
        stage,
        stageTitle: stageMeta.title,
        level: rule.level,
        thresholdMin: rule.thresholdMin,
      },
      patient: {
        mrn: p.mrn,
        name: p.name,
        room: p.room,
        floor: p.floor,
        doctorName: p.doctorName,
        doctorSpecialty: p.doctorSpecialty,
      },
      minutesInStage,
      taskOwners: taskOwnerNames,
    },
  };
}

/**
 * Evaluate every enabled alarm rule against every active (not-yet-discharged)
 * patient. Called opportunistically when notifications are fetched — cheap,
 * idempotent (dedupeKeys), and it keeps alarms flowing without a scheduler.
 */
export async function evaluateAlarms(now = new Date()): Promise<AlarmEvaluationResult> {
  const result: AlarmEvaluationResult = {
    checkedPatients: 0,
    firedRules: 0,
    notificationsCreated: 0,
    webhooksFired: 0,
  };

  const [rules, patients, users, globalUrl] = await Promise.all([
    db.alarmRule.findMany({ where: { enabled: true } }),
    db.patient.findMany({ where: { physicalDischargedAt: null } }),
    db.user.findMany(),
    getGlobalWebhookUrl(),
  ]);
  if (rules.length === 0 || patients.length === 0) return result;

  const notificationDrafts: NotificationDraft[] = [];
  const webhookDrafts: DeliveryDraft[] = [];

  for (const patient of patients) {
    const p = patientToJson(patient);
    const stage = stageOf(p);
    if (stage === 6) continue; // discharged — nothing left to watch
    result.checkedPatients++;

    const entry = stageEntryAt(p, stage);
    const minutesInStage = minutesSince(entry, now);
    const stageMeta = STAGES[stage - 1];

    for (const rule of rules) {
      if (rule.stage !== stage) continue;
      if (minutesInStage < rule.thresholdMin) continue;
      result.firedRules++;

      // 1) in-app notification for the stage's task owners
      if (rule.notifyTaskOwner) {
        const owners = taskOwnersForStage(users, patient, stage);
        for (const owner of owners) {
          notificationDrafts.push({
            userId: owner.id,
            patientId: patient.id,
            type: "ALARM",
            title: `${rule.level === "LATE" ? "LATE" : "Warning"}: ${stageMeta.title} over ${rule.thresholdMin} min`,
            body: `${p.name} (Room ${p.room}, floor ${p.floor}) has been in "${stageMeta.title}" for ${minutesInStage} min — rule "${rule.name}" fired. Owner: ${stageMeta.owner}.`,
            dedupeKey: `alarm:${rule.id}:${patient.id}:${owner.id}`,
          });
        }
      }

      // 2) outbound webhook (per-rule URL, falling back to the global one),
      //    shaped per detected channel — Discord/Slack/Teams URLs get
      //    channel-formatted PHI-lite text; generic receivers get the full JSON.
      const url = rule.webhookUrl?.trim() || globalUrl;
      if (url) {
        const channel = detectWebhookChannel(url);
        const taskOwnerNames = taskOwnersForStage(users, patient, stage).map(
          (u) => `${u.name} (${ROLE_LABELS[userToJson(u).role]})`
        );
        webhookDrafts.push({
          url,
          event: "alarm",
          alarmRuleId: rule.id,
          patientId: patient.id,
          dedupeKey: `alarm:${rule.id}:${patient.id}`,
          payload: buildChannelPayload(
            channel,
            alarmWebhookMessage(
              channel,
              rule,
              p,
              stage,
              minutesInStage,
              stageMeta,
              taskOwnerNames,
              now
            )
          ),
        });
      }
    }
  }

  result.notificationsCreated = await createNotifications(notificationDrafts);

  for (const draft of webhookDrafts) {
    const outcome = await deliverWebhook(draft);
    if (outcome.status !== "already sent") result.webhooksFired++;
  }

  return result;
}
