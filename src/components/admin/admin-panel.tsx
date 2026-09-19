"use client";

import { useState } from "react";
import { Database, Eye, Siren, SlidersHorizontal, UsersRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ActionJson, PatientJson, UserJson } from "@/lib/workflow";
import { UsersSection } from "@/components/admin/users-section";
import { AlarmsSection } from "@/components/admin/alarms-section";
import { DemoSection } from "@/components/admin/demo-section";
import { DataSection } from "@/components/admin/data-section";
import { WorkflowSection } from "@/components/admin/workflow-section";

interface AdminPanelProps {
  admin: UserJson;
  users: UserJson[];
  specialties: string[];
  patients: PatientJson[] | null;
  onUsersChange: (users: UserJson[]) => void;
  onBoardDataChange: (payload: { patients: PatientJson[]; actions: ActionJson[] }) => void;
  onDemoAs: (userId: string) => void;
}

type Section = "users" | "alarms" | "workflow" | "demo" | "data";

const SECTIONS: Array<{ key: Section; label: string; icon: typeof UsersRound; hint: string }> = [
  { key: "users", label: "Users & privileges", icon: UsersRound, hint: "edit / view modes" },
  { key: "alarms", label: "Alarms & webhooks", icon: Siren, hint: "rules + notifications" },
  { key: "workflow", label: "Workflow", icon: SlidersHorizontal, hint: "decision window" },
  { key: "demo", label: "Demo views", icon: Eye, hint: "see as any user" },
  { key: "data", label: "Data & audit", icon: Database, hint: "demo data · trail" },
];

/** The admin console — reachable only by ADMIN accounts (not while demoing). */
export function AdminPanel({
  admin,
  users,
  specialties,
  patients,
  onUsersChange,
  onBoardDataChange,
  onDemoAs,
}: AdminPanelProps) {
  const [section, setSection] = useState<Section>("users");

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <h1 className="text-base font-bold text-slate-800">Admin console</h1>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Signed in as <b>{admin.name}</b> — admins set every other category&rsquo;s editing and
            viewing privileges, demo any user view (read-only), and own the alarm rules with
            webhook notifications for task owners.
          </p>
        </CardContent>
      </Card>

      {/* Section nav */}
      <div
        className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
        role="tablist"
        aria-label="Admin sections"
      >
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {s.label}
              <span className="hidden text-[10px] font-normal text-slate-400 lg:inline">
                · {s.hint}
              </span>
            </button>
          );
        })}
      </div>

      {section === "users" && (
        <UsersSection
          admin={admin}
          users={users}
          specialties={specialties}
          onUsersChange={onUsersChange}
        />
      )}
      {section === "alarms" && <AlarmsSection admin={{ id: admin.id, name: admin.name }} />}
      {section === "workflow" && <WorkflowSection admin={{ id: admin.id, name: admin.name }} />}
      {section === "demo" && <DemoSection users={users} onDemoAs={onDemoAs} />}
      {section === "data" && (
        <DataSection admin={admin} patients={patients} onBoardDataChange={onBoardDataChange} />
      )}
    </div>
  );
}
