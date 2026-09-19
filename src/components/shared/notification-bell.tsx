"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Handshake, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { NotificationJson } from "@/lib/serialize";
import { fmtDateTime } from "@/lib/format";

interface NotificationBellProps {
  userId: string | null;
  onOpenPatient?: (patientId: string) => void;
}

/** Task-owner notification feed: handoffs ("patient waiting for your stage")
 *  and alarms (stage over threshold). Unread count badges the bell; polls
 *  every 10s alongside the board (each GET also re-evaluates alarm rules). */
export function NotificationBell({ userId, onOpenPatient }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<NotificationJson[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/notifications?userId=${userId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationJson[]; unread: number };
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch {
      // silent — the bell is non-critical
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetchNotifications();
    const poll = setInterval(fetchNotifications, 10000);
    return () => clearInterval(poll);
  }, [userId, fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!userId || unread === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, all: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as { unread: number };
        setUnread(data.unread);
        setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      }
    } finally {
      setBusy(false);
    }
  }, [userId, unread]);

  const markOneRead = useCallback(
    async (notificationId: string) => {
      if (!userId) return;
      try {
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, notificationId }),
        });
        if (res.ok) {
          const data = (await res.json()) as { unread: number };
          setUnread(data.unread);
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === notificationId ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n
            )
          );
        }
      } catch {
        // silent
      }
    },
    [userId]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 px-0"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white tabular-nums"
              aria-hidden="true"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <div className="text-xs font-semibold text-slate-700">
            Notifications
            {unread > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 tabular-nums">
                {unread} new
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy || unread === 0}
            onClick={markAllRead}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all read
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-400">
              Nothing yet — handoffs and stage alarms appear here for the stages you own.
            </p>
          ) : (
            notifications.map((n) => {
              const Icon = n.type === "ALARM" ? Siren : Handshake;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) markOneRead(n.id);
                    if (n.patientId && onOpenPatient) onOpenPatient(n.patientId);
                  }}
                  className={`flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-slate-50 ${
                    n.readAt ? "" : "bg-amber-50/60"
                  }`}
                >
                  <span
                    className={`mt-0.5 rounded-md p-1 ${
                      n.type === "ALARM" ? "bg-rose-100 text-rose-600" : "bg-teal-100 text-teal-700"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">
                      {n.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-500">
                      {n.body}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-400">
                      {fmtDateTime(n.createdAt)}
                      {!n.readAt && (
                        <span className="ml-1.5 rounded-full bg-amber-400/20 px-1.5 py-0.5 font-semibold text-amber-700">
                          new
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <p className="border-t border-slate-100 px-3 py-2 text-[10px] leading-snug text-slate-400">
          Alarms fire from the admin-configured rules and can also POST to a webhook. Click a
          notification to open the patient.
        </p>
      </PopoverContent>
    </Popover>
  );
}
