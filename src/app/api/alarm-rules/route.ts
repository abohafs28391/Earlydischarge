import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getGlobalWebhookState,
  getGlobalWebhookUrl,
  sendTestWebhook,
  setGlobalWebhookUrl,
} from "@/lib/alarms";
import { requireAdmin } from "@/lib/api-auth";
import { ensureAlarmRulesSeeded, ensureUsersSeeded } from "@/lib/seed";
import { alarmRuleToJson, webhookDeliveryToJson } from "@/lib/serialize";
import { STAGES, STAGE_TARGETS } from "@/lib/workflow";
import {
  WEBHOOK_CHANNELS,
  detectWebhookChannel,
  type WebhookChannel,
} from "@/lib/webhook-channels";

async function loadRulesPayload() {
  const [rules, deliveries, webhookState] = await Promise.all([
    db.alarmRule.findMany({ orderBy: [{ stage: "asc" }, { thresholdMin: "asc" }] }),
    db.webhookDelivery.findMany({
      include: { patient: true, alarmRule: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    getGlobalWebhookState(),
  ]);
  return {
    rules: rules.map(alarmRuleToJson),
    deliveries: deliveries.map(webhookDeliveryToJson),
    globalWebhookUrl: webhookState.url,
    // true while the URL above is the hardcoded testing default (no admin-
    // saved value) — the admin UI shows a warning note in that case.
    globalWebhookIsTestDefault: webhookState.isTestDefault,
    stages: STAGES.slice(0, 5).map((s) => ({
      num: s.num,
      title: s.title,
      targetMin: STAGE_TARGETS[s.num].targetMin,
    })),
  };
}

/** Admin: list alarm rules, recent webhook deliveries and the global webhook. */
export async function GET(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    await ensureAlarmRulesSeeded();
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    return NextResponse.json(await loadRulesPayload());
  } catch (err) {
    console.error("alarm-rules GET failed", err);
    return NextResponse.json({ error: "Failed to load alarm rules" }, { status: 500 });
  }
}

/**
 * Admin alarm management (action-discriminated POST):
 *   { action: "create", name, stage, level, thresholdMin, webhookUrl? }
 *   { action: "setGlobalWebhook", url }
 *   { action: "test", url?, channel? } — fires a test ping and logs the
 *     delivery. `channel` optionally overrides the URL auto-detection
 *     (discord | slack | teams | generic) for edge-case URLs.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureUsersSeeded();
    await ensureAlarmRulesSeeded();
    const body = (await req.json().catch(() => null)) as {
      action?: string;
      userId?: string;
      name?: string;
      stage?: number;
      level?: string;
      thresholdMin?: number;
      webhookUrl?: string | null;
      url?: string;
      channel?: string;
    } | null;

    const guard = await requireAdmin(body?.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    switch (body?.action) {
      case "create": {
        const name = body.name?.trim();
        const stage = Number(body.stage);
        const level = body.level === "LATE" ? "LATE" : "WARN";
        const thresholdMin = Number(body.thresholdMin);
        if (!name) {
          return NextResponse.json({ error: "Rule name is required" }, { status: 400 });
        }
        if (!Number.isInteger(stage) || stage < 1 || stage > 5) {
          return NextResponse.json({ error: "Stage must be 1–5" }, { status: 400 });
        }
        if (!Number.isFinite(thresholdMin) || thresholdMin < 1 || thresholdMin > 2880) {
          return NextResponse.json(
            { error: "Threshold must be 1–2880 minutes" },
            { status: 400 }
          );
        }
        const created = await db.alarmRule.create({
          data: {
            name,
            stage,
            level,
            thresholdMin: Math.round(thresholdMin),
            notifyTaskOwner: true,
            webhookUrl: body.webhookUrl?.trim() || null,
            enabled: true,
          },
        });
        return NextResponse.json({ rule: alarmRuleToJson(created), ...(await loadRulesPayload()) });
      }

      case "setGlobalWebhook": {
        await setGlobalWebhookUrl(body.url ?? "");
        return NextResponse.json({ ...(await loadRulesPayload()) });
      }

      case "test": {
        const url = body.url?.trim() || (await getGlobalWebhookUrl());
        if (!url || !/^https?:\/\/.+/i.test(url)) {
          return NextResponse.json(
            { error: "A valid http(s) webhook URL is required" },
            { status: 400 }
          );
        }
        const channelOverride = WEBHOOK_CHANNELS.includes(body.channel as WebhookChannel)
          ? (body.channel as WebhookChannel)
          : undefined;
        const channel = channelOverride ?? detectWebhookChannel(url);
        const outcome = await sendTestWebhook(url, guard.user, channelOverride);
        return NextResponse.json({ outcome, channel, ...(await loadRulesPayload()) });
      }

      default:
        return NextResponse.json(
          { error: "Unknown action — use create | setGlobalWebhook | test" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("alarm-rules POST failed", err);
    return NextResponse.json({ error: "Alarm rule action failed" }, { status: 500 });
  }
}

/** Admin: update a rule (name/threshold/level/owner-notify/webhook/enabled). */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      id?: string;
      name?: string;
      stage?: number;
      level?: string;
      thresholdMin?: number;
      notifyTaskOwner?: boolean;
      webhookUrl?: string | null;
      enabled?: boolean;
    } | null;

    const guard = await requireAdmin(body?.userId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    if (!body?.id) return NextResponse.json({ error: "Rule id is required" }, { status: 400 });

    const existing = await db.alarmRule.findUnique({ where: { id: body.id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const data: Partial<typeof existing> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body.stage !== undefined) {
      const stage = Number(body.stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > 5) {
        return NextResponse.json({ error: "Stage must be 1–5" }, { status: 400 });
      }
      data.stage = stage;
    }
    if (body.level !== undefined) data.level = body.level === "LATE" ? "LATE" : "WARN";
    if (body.thresholdMin !== undefined) {
      const t = Number(body.thresholdMin);
      if (!Number.isFinite(t) || t < 1 || t > 2880) {
        return NextResponse.json({ error: "Threshold must be 1–2880 minutes" }, { status: 400 });
      }
      data.thresholdMin = Math.round(t);
    }
    if (typeof body.notifyTaskOwner === "boolean") data.notifyTaskOwner = body.notifyTaskOwner;
    if (body.webhookUrl !== undefined) data.webhookUrl = body.webhookUrl?.trim() || null;
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;

    await db.alarmRule.update({ where: { id: body.id }, data });
    return NextResponse.json({ ...(await loadRulesPayload()) });
  } catch (err) {
    console.error("alarm-rules PATCH failed", err);
    return NextResponse.json({ error: "Failed to update alarm rule" }, { status: 500 });
  }
}

/** Admin: delete a rule. */
export async function DELETE(req: NextRequest) {
  try {
    const guard = await requireAdmin(req.nextUrl.searchParams.get("userId"));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Rule id is required" }, { status: 400 });

    const existing = await db.alarmRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await db.alarmRule.delete({ where: { id } });
    return NextResponse.json({ ...(await loadRulesPayload()) });
  } catch (err) {
    console.error("alarm-rules DELETE failed", err);
    return NextResponse.json({ error: "Failed to delete alarm rule" }, { status: 500 });
  }
}
