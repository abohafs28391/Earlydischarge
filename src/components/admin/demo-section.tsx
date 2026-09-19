"use client";

import { Eye, FlaskConical, Stethoscope, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { UserJson } from "@/lib/workflow";

interface DemoSectionProps {
  users: UserJson[];
  onDemoAs: (userId: string) => void;
}

interface DemoGroup {
  key: string;
  label: string;
  note: string;
  members: UserJson[];
}

/** Admin > Demo views: launch any other user's view instantly — read-only,
 *  exactly as that account sees the board (scope, buttons, notifications). */
export function DemoSection({ users, onDemoAs }: DemoSectionProps) {
  const groups: DemoGroup[] = [
    {
      key: "nurse",
      label: "Nurses — by floor",
      note: "Floor-scoped board; drives the email template + physical discharge",
      members: users.filter((u) => u.role === "NURSE"),
    },
    {
      key: "physician",
      label: "Physicians — by specialty",
      note: "Sees only their specialty's patients; medically clears them",
      members: users.filter((u) => u.role === "PHYSICIAN"),
    },
    {
      key: "finance",
      label: "Financial team",
      note: "Read-only until notified; marks financial clearance",
      members: users.filter((u) => u.role === "FINANCE"),
    },
    {
      key: "reception",
      label: "Reception",
      note: "Sees financially cleared patients; confirms the discharge papers",
      members: users.filter((u) => u.role === "RECEPTION"),
    },
    {
      key: "manager",
      label: "Universal — managers",
      note: "Hospital-wide oversight, read-only",
      members: users.filter((u) => u.role === "UNIVERSAL" && u.subcategory === "MANAGER"),
    },
    {
      key: "quality",
      label: "Universal — quality",
      note: "Hospital-wide oversight + analysis, read-only",
      members: users.filter((u) => u.role === "UNIVERSAL" && u.subcategory === "QUALITY"),
    },
  ];

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-800">Demo any user view</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Jump into another category&rsquo;s perspective — the board, actions and notifications
          render exactly as that account sees them, but strictly read-only. A banner stays visible
          until you exit the demo.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups
            .filter((g) => g.members.length > 0)
            .map((g) => (
              <div key={g.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5">
                  {g.key === "nurse" || g.key === "manager" || g.key === "quality" ? (
                    <UsersRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  ) : g.key === "physician" ? (
                    <Stethoscope className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  ) : (
                    <FlaskConical className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  )}
                  <span className="text-xs font-semibold text-slate-700">{g.label}</span>
                  <span className="ml-auto text-[10px] text-slate-400">{g.members.length}</span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-slate-400">{g.note}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.members.map((u) => {
                    const sub =
                      u.role === "NURSE"
                        ? u.floors.length > 1
                          ? `Floors ${u.floors.join(" & ")}`
                          : `Floor ${u.floors[0] ?? "—"}`
                        : u.role === "PHYSICIAN"
                          ? u.specialty
                          : u.subcategory === "QUALITY"
                            ? "Quality"
                            : "Manager";
                    return (
                      <Button
                        key={u.id}
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-[11px]"
                        onClick={() => onDemoAs(u.id)}
                        aria-label={`Demo as ${u.name}`}
                      >
                        <Eye className="h-3 w-3 text-slate-400" aria-hidden="true" />
                        {u.name}
                        <Badge variant="secondary" className="ml-0.5 border-0 bg-slate-100 text-[9px] text-slate-500">
                          {sub}
                        </Badge>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
