"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Globe, Loader2, Plus, Send, Siren, Trash2, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { AlarmRuleJson, WebhookDeliveryJson } from "@/lib/serialize";
import { fmtDateTime, fmtMinutes } from "@/lib/format";
import { CHANNEL_META, detectWebhookChannel } from "@/lib/webhook-channels";

interface AlarmsSectionProps {
  admin: { id: string; name: string };
}

interface RulesPayload {
  rules: AlarmRuleJson[];
  deliveries: WebhookDeliveryJson[];
  globalWebhookUrl: string | null;
  /** True while no admin-saved URL exists and the effective webhook is the
   *   hardcoded testing default (see lib/alarms.ts TEST_WEBHOOK_URL). */
  globalWebhookIsTestDefault?: boolean;
  stages: Array<{ num: number; title: string; targetMin: number }>;
}

const STAGE_TITLES = ["Medical clearance", "Notify financial team", "Financial clearance", "Reception", "Physical discharge"];

/** Detected-channel chip shown next to webhook URL inputs. */
function ChannelBadge({ url }: { url: string | null | undefined }) {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const meta = CHANNEL_META[detectWebhookChannel(trimmed)];
  return (
    <Badge variant="secondary" className={`${meta.badgeClass} shrink-0`}>
      {meta.label}
    </Badge>
  );
}

/** Admin > Alarms & notifications: alarm rules per stage (threshold + level),
 *  task-owner notification toggles and webhook routing, with the delivery log. */
export function AlarmsSection({ admin }: AlarmsSectionProps) {
  const { toast } = useToast();
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookDraft, setWebhookDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // new-rule form
  const [newName, setNewName] = useState("");
  const [newStage, setNewStage] = useState("1");
  const [newLevel, setNewLevel] = useState("WARN");
  const [newThreshold, setNewThreshold] = useState("60");
  const [newUrl, setNewUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/alarm-rules?userId=${admin.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Alarm rules API ${res.status}`);
      const data = (await res.json()) as RulesPayload;
      setPayload(data);
      setWebhookDraft(data.globalWebhookUrl ?? "");
    } catch (e) {
      toast({
        title: "Could not load alarm rules",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [admin.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = useCallback(
    async (init: RequestInit & { url: string }) => {
      const { url, ...initRest } = init;
      const res = await fetch(url, initRest);
      const data = (await res.json().catch(() => ({}))) as RulesPayload & { error?: string };
      if (!res.ok) {
        toast({ title: "Rejected", description: data.error, variant: "destructive" });
        return null;
      }
      if (data.rules) {
        setPayload(data);
        setWebhookDraft(data.globalWebhookUrl ?? "");
      }
      return data;
    },
    [toast]
  );

  const patchRule = useCallback(
    async (id: string, patch: Partial<AlarmRuleJson>) => {
      setBusy(id);
      await apply({
        url: "/api/alarm-rules",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: admin.id, id, ...patch }),
      });
      setBusy(null);
    },
    [admin.id, apply]
  );

  const deleteRule = useCallback(
    async (id: string) => {
      setBusy(id);
      await apply({ url: `/api/alarm-rules?id=${encodeURIComponent(id)}&userId=${admin.id}`, method: "DELETE" });
      setBusy(null);
      toast({ title: "Rule deleted" });
    },
    [admin.id, apply, toast]
  );

  const createRule = useCallback(async () => {
    const data = await apply({
      url: "/api/alarm-rules",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        userId: admin.id,
        name: newName.trim() || `${STAGE_TITLES[Number(newStage) - 1]} over ${newThreshold} min`,
        stage: Number(newStage),
        level: newLevel,
        thresholdMin: Number(newThreshold),
        webhookUrl: newUrl.trim() || null,
      }),
    });
    if (data) {
      toast({ title: "Alarm rule created" });
      setNewName("");
      setNewUrl("");
    }
  }, [admin.id, apply, newLevel, newName, newStage, newThreshold, newUrl, toast]);

  const saveGlobalWebhook = useCallback(async () => {
    const data = await apply({
      url: "/api/alarm-rules",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setGlobalWebhook", userId: admin.id, url: webhookDraft.trim() }),
    });
    if (data) {
      toast({
        title: webhookDraft.trim() ? "Global webhook saved" : "Global webhook cleared",
        description: "Alarms without a rule-specific URL now route here.",
      });
    }
  }, [admin.id, apply, webhookDraft, toast]);

  const testWebhook = useCallback(async () => {
    setTesting(true);
    const data = await apply({
      url: "/api/alarm-rules",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test", userId: admin.id, url: webhookDraft.trim() || undefined }),
    });
    setTesting(false);
    if (data) {
      const outcome = (data as RulesPayload & { outcome?: { ok: boolean; status: string } }).outcome;
      const channel = (data as RulesPayload & { channel?: string }).channel;
      toast({
        title: outcome?.ok ? "Test ping delivered" : "Test ping failed",
        description: outcome
          ? `${outcome.status}${channel ? ` · sent as ${channel}` : ""} · logged in the delivery log`
          : "See the delivery log",
        variant: outcome?.ok ? "default" : "destructive",
      });
    }
  }, [admin.id, apply, webhookDraft, toast]);

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="flex items-center gap-2 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading alarm rules…
        </CardContent>
      </Card>
    );
  }

  const rules = payload?.rules ?? [];
  const deliveries = payload?.deliveries ?? [];

  return (
    <div className="space-y-4">
      {/* Global webhook */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-800">Notifications via webhook</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            When an alarm fires, DischargeFlow POSTs to the rule&rsquo;s webhook — or this global
            URL when the rule has none. The channel is auto-detected from the URL: Discord, Slack
            and Teams endpoints receive channel-formatted messages with patient identifiers
            stripped; any other URL receives the full DischargeFlow JSON (rule, patient, minutes
            in stage, task owners). Transport is swappable later (email / SMS / push) without
            touching the rules.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                value={webhookDraft}
                onChange={(e) => setWebhookDraft(e.target.value)}
                placeholder="https://hooks.example.com/dischargeflow"
                className="h-9 pl-8 text-xs"
                aria-label="Global webhook URL"
                type="url"
              />
            </div>
            <Button size="sm" className="h-9 gap-1.5 bg-teal-600 hover:bg-teal-700" onClick={saveGlobalWebhook}>
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={testWebhook}
              disabled={testing || !webhookDraft.trim()}
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Send test ping
            </Button>
          </div>
          {webhookDraft.trim() && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span className="shrink-0">Detected channel:</span>
              <ChannelBadge url={webhookDraft} />
              <span>{CHANNEL_META[detectWebhookChannel(webhookDraft)].hint}</span>
            </div>
          )}
          {payload?.globalWebhookIsTestDefault && (
            <div
              role="note"
              className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Hardcoded testing default in effect.</strong> While no URL is saved,
                alarms and test pings are posted to a built-in Discord webhook used for
                testing this pipeline — it will be removed later. Save your own URL above
                to override it at any time (clearing the saved value brings this default
                back).
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rules */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-800">Alarm rules</h2>
            <span className="text-[10px] text-slate-400">
              evaluated live against every active patient
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {rules.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                No rules yet — add one below.
              </p>
            )}
            {rules.map((r) => (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-2.5 ${
                  r.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"
                }`}
              >
                <Switch
                  checked={r.enabled}
                  disabled={busy === r.id}
                  onCheckedChange={(v) => patchRule(r.id, { enabled: v })}
                  aria-label={`Enable rule ${r.name}`}
                />
                <Badge
                  variant="secondary"
                  className={
                    r.level === "LATE"
                      ? "border-0 bg-rose-100 text-rose-700"
                      : "border-0 bg-amber-100 text-amber-700"
                  }
                >
                  {r.level}
                </Badge>
                <div className="min-w-[180px] flex-1">
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                    defaultValue={r.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== r.name) {
                        patchRule(r.id, { name: e.target.value.trim() });
                      }
                    }}
                    aria-label={`Rule name ${r.name}`}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Select
                    value={String(r.stage)}
                    onValueChange={(v) => patchRule(r.id, { stage: Number(v) })}
                  >
                    <SelectTrigger className="h-8 w-[160px] text-[11px]" aria-label={`Stage for ${r.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_TITLES.map((t, i) => (
                        <SelectItem key={i} value={String(i + 1)}>
                          {i + 1}. {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <span>over</span>
                  <input
                    type="number"
                    min={1}
                    max={2880}
                    defaultValue={r.thresholdMin}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 1 && v !== r.thresholdMin) {
                        patchRule(r.id, { thresholdMin: v });
                      }
                    }}
                    className="h-8 w-20 rounded border border-slate-200 px-1.5 text-right tabular-nums focus:border-slate-300 focus:outline-none"
                    aria-label={`Threshold minutes for ${r.name}`}
                  />
                  <span>min</span>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
                  <Bell className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  <span className="hidden sm:inline">notify owner</span>
                  <Switch
                    checked={r.notifyTaskOwner}
                    disabled={busy === r.id}
                    onCheckedChange={(v) => patchRule(r.id, { notifyTaskOwner: v })}
                    aria-label={`Notify task owner for ${r.name}`}
                  />
                </label>
                <input
                  type="url"
                  defaultValue={r.webhookUrl ?? ""}
                  placeholder="rule webhook (optional)"
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== r.webhookUrl) {
                      patchRule(r.id, { webhookUrl: e.target.value.trim() || null });
                    }
                  }}
                  className="h-8 w-[200px] rounded border border-slate-200 px-2 text-[11px] text-slate-600 focus:border-slate-300 focus:outline-none"
                  aria-label={`Webhook URL for ${r.name}`}
                />
                <ChannelBadge url={r.webhookUrl} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 px-0 text-rose-600 hover:text-rose-700"
                  disabled={busy === r.id}
                  onClick={() => deleteRule(r.id)}
                  aria-label={`Delete rule ${r.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add rule */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-2.5">
            <Plus className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Rule name (optional)"
              className="h-8 w-[190px] text-xs"
              aria-label="New rule name"
            />
            <Select value={newStage} onValueChange={setNewStage}>
              <SelectTrigger className="h-8 w-[170px] text-[11px]" aria-label="New rule stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_TITLES.map((t, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {i + 1}. {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newLevel} onValueChange={setNewLevel}>
              <SelectTrigger className="h-8 w-[90px] text-[11px]" aria-label="New rule level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WARN">WARN</SelectItem>
                <SelectItem value="LATE">LATE</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 text-[11px] text-slate-500">
              <span>over</span>
              <Input
                type="number"
                min={1}
                max={2880}
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                className="h-8 w-20 text-right tabular-nums"
                aria-label="New rule threshold minutes"
              />
              <span>min</span>
            </div>
            <Input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="webhook (optional)"
              className="h-8 w-[190px] text-xs"
              aria-label="New rule webhook URL"
            />
            <ChannelBadge url={newUrl} />
            <Button size="sm" className="h-8 gap-1.5 bg-teal-600 hover:bg-teal-700" onClick={createRule}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add rule
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delivery log */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <h2 className="text-sm font-bold text-slate-800">Webhook delivery log</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Every outbound POST — alarms and test pings — with its outcome. Alarm sends are
            deduplicated per rule + patient.
          </p>
          <div className="mt-3 max-h-72 overflow-y-auto">
            {deliveries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                Nothing sent yet — set a webhook and send a test ping, or let an alarm fire.
              </p>
            ) : (
              <table className="w-full min-w-[560px] text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-3 font-medium">When</th>
                    <th className="px-2 py-1.5 font-medium">Event</th>
                    <th className="px-2 py-1.5 font-medium">Rule / patient</th>
                    <th className="px-2 py-1.5 font-medium">Outcome</th>
                    <th className="py-1.5 pl-3 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-slate-500">
                        {fmtDateTime(d.createdAt)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant="secondary"
                          className={
                            d.event === "alarm"
                              ? "border-0 bg-rose-100 text-rose-700"
                              : "border-0 bg-slate-100 text-slate-600"
                          }
                        >
                          {d.event}
                        </Badge>
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-600">
                        {[d.ruleName, d.patientName].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`font-medium ${d.ok ? "text-emerald-600" : "text-rose-600"}`}
                        >
                          {d.ok ? "delivered" : "failed"}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-400">{d.status}</span>
                      </td>
                      <td className="max-w-[200px] truncate py-1.5 pl-3 font-mono text-[10px] text-slate-400">
                        {d.url}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Defaults were seeded from the stage targets (WARN at target, LATE at twice the target —{" "}
        {["4h/8h", "30m/60m", "2h/4h", "60m/2h", "30m/1h"].map((s) => s).join(", ")}
        {` — `}i.e. {fmtMinutes(240)}→{fmtMinutes(480)}, {fmtMinutes(30)}→{fmtMinutes(60)}, …).
        Task owners: stage 1 → assigned-specialty physicians · stage 2 & 5 → floor nurses · stage 3
        → financial team · stage 4 → reception personnel.
      </p>
    </div>
  );
}
