"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  DECISION_WINDOW_MAX_SEC,
  DECISION_WINDOW_MIN_SEC,
  DEFAULT_DECISION_WINDOW_SEC,
} from "@/lib/workflow";

interface WorkflowSectionProps {
  admin: { id: string; name: string };
}

/** Admin > Workflow: the decision-window setting — the delay between a
 *  physician's Discharge decision and the patient moving to the next stage
 *  (the undo / change window). Default 60s, adjustable 1–600s. */
export function WorkflowSection({ admin }: WorkflowSectionProps) {
  const { toast } = useToast();
  const [current, setCurrent] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/settings?userId=${admin.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Settings API ${res.status}`);
        const data = (await res.json()) as { decisionWindowSec: number };
        if (cancelled) return;
        setCurrent(data.decisionWindowSec);
        setDraft(String(data.decisionWindowSec));
      } catch {
        if (!cancelled) setCurrent(DEFAULT_DECISION_WINDOW_SEC);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [admin.id]);

  const save = async () => {
    const sec = Number(draft);
    if (
      !Number.isFinite(sec) ||
      !Number.isInteger(sec) ||
      sec < DECISION_WINDOW_MIN_SEC ||
      sec > DECISION_WINDOW_MAX_SEC
    ) {
      toast({
        title: "Invalid value",
        description: `The window must be a whole number between ${DECISION_WINDOW_MIN_SEC} and ${DECISION_WINDOW_MAX_SEC} seconds.`,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: admin.id, decisionWindowSec: sec }),
      });
      const data = (await res.json()) as { decisionWindowSec?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setCurrent(data.decisionWindowSec ?? sec);
      setDraft(String(data.decisionWindowSec ?? sec));
      toast({
        title: `Decision window set to ${data.decisionWindowSec ?? sec}s`,
        description:
          "Applies immediately — every board picks it up on the next refresh and stage-1 countdowns match the server.",
      });
    } catch (e) {
      toast({
        title: "Could not save the decision window",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const dirty = current !== null && Number(draft) !== current;

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-teal-600" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-800">Physician decision window</h2>
          {current !== null && (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 tabular-nums">
              live: {current}s
            </span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          When a physician records a <b>Discharge</b> decision, the patient waits this many seconds
          before moving to <b>Notify Financial Team</b> — the window in which the physician can undo
          or change the decision (No discharge). Every decision, undo and change is audit-logged.
          Default {DEFAULT_DECISION_WINDOW_SEC}s; range {DECISION_WINDOW_MIN_SEC}–
          {DECISION_WINDOW_MAX_SEC}s.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="decision-window-input" className="text-xs font-medium text-slate-600">
              Window (seconds)
            </label>
            <Input
              id="decision-window-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="60"
              className="h-9 w-32 font-mono tabular-nums"
              disabled={current === null}
              aria-describedby="decision-window-hint"
            />
          </div>
          <Button
            size="sm"
            className="h-9 gap-1.5 bg-teal-600 hover:bg-teal-700"
            disabled={busy || current === null || !dirty}
            onClick={save}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save window
          </Button>
          <p id="decision-window-hint" className="text-[10px] text-slate-400">
            {dirty ? "Unsaved change" : "Matches the saved value"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
