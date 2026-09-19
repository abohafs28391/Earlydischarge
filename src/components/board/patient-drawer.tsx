"use client";

import { useMemo } from "react";
import {
  Ban,
  ClipboardCheck,
  Copy,
  DoorOpen,
  FileInput,
  Mail,
  MailX,
  Receipt,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ActionJson, ActionType, PatientJson, PatientView } from "@/lib/workflow";
import { ACTION_LABELS, STAGES } from "@/lib/workflow";
import { fmtDateTime, fmtMinutes } from "@/lib/format";

const ACTION_ICON: Record<ActionType, typeof Mail> = {
  IMPORTED: FileInput,
  MEDICAL_DECIDED_DISCHARGE: ThumbsUp,
  MEDICAL_DECIDED_NO: ThumbsDown,
  MEDICAL_UNDO: Undo2,
  MEDICAL_READY: Stethoscope,
  COPY_TEMPLATE: Copy,
  FINANCE_NOTIFIED: Mail,
  FINANCE_CLEARED: Receipt,
  RECEPTION_READY: ClipboardCheck,
  PHYSICAL_DISCHARGED: DoorOpen,
  COPY_CANCEL_TEMPLATE: MailX,
  CANCEL_DISCHARGE: Ban,
};

const ACTION_TONE: Record<ActionType, string> = {
  IMPORTED: "bg-slate-100 text-slate-600",
  MEDICAL_DECIDED_DISCHARGE: "bg-teal-100 text-teal-700",
  MEDICAL_DECIDED_NO: "bg-rose-100 text-rose-700",
  MEDICAL_UNDO: "bg-violet-100 text-violet-700",
  MEDICAL_READY: "bg-teal-100 text-teal-700",
  COPY_TEMPLATE: "bg-sky-100 text-sky-700",
  FINANCE_NOTIFIED: "bg-sky-100 text-sky-700",
  FINANCE_CLEARED: "bg-amber-100 text-amber-700",
  RECEPTION_READY: "bg-indigo-100 text-indigo-700",
  PHYSICAL_DISCHARGED: "bg-emerald-100 text-emerald-700",
  COPY_CANCEL_TEMPLATE: "bg-rose-100 text-rose-700",
  CANCEL_DISCHARGE: "bg-rose-100 text-rose-700",
};

interface PatientDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: PatientView | null;
  actions: ActionJson[];
}

export function PatientDrawer({ open, onOpenChange, patient, actions }: PatientDrawerProps) {
  const timeline = useMemo(
    () =>
      patient
        ? actions
            .filter((a) => a.patientId === patient.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [actions, patient]
  );

  if (!patient) return null;

  const roleSuffix = (role: string | null) =>
    role === "NURSE"
      ? " · nurse"
      : role === "PHYSICIAN"
        ? " · physician"
        : role === "FINANCE"
          ? " · finance"
          : role === "RECEPTION"
            ? " · reception"
            : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              {patient.room}
            </span>
            {patient.name}
          </SheetTitle>
          <SheetDescription>
            MRN {patient.mrn} · Floor {patient.floor} · assigned to {patient.doctorName} (
            {patient.doctorSpecialty})
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          {/* Stage stepper */}
          <div className="flex items-center gap-1" aria-label="Pipeline progress">
            {STAGES.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center gap-1">
                <div
                  title={s.title}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    patient.stage >= s.num ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {s.num}
                </div>
                {i < STAGES.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 rounded ${
                      patient.stage > s.num ? "bg-teal-500" : "bg-slate-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            {patient.stage < 6 ? (
              <>
                Currently in <b>{STAGES[patient.stage - 1].title}</b> for{" "}
                {fmtMinutes(patient.minutesInStage)}
                {patient.stageTargetMin ? ` (draft target ${fmtMinutes(patient.stageTargetMin)})` : ""}
              </>
            ) : (
              <>
                Discharged{patient.totalMinutes !== null ? ` · total pipeline ${fmtMinutes(patient.totalMinutes)}` : ""}
              </>
            )}
          </p>

          {/* Audit trail */}
          <section aria-label="Audit trail">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Audit trail — who did what, when
            </h3>
            <ol className="space-y-2 border-l border-slate-200 pl-4">
              {timeline.length === 0 && (
                <li className="text-[11px] text-slate-400">No recorded actions yet.</li>
              )}
              {timeline.map((a, i) => {
                const Icon = ACTION_ICON[a.type];
                const gapMin =
                  i > 0
                    ? Math.round(
                        (new Date(a.createdAt).getTime() -
                          new Date(timeline[i - 1].createdAt).getTime()) /
                          60000
                      )
                    : null;
                return (
                  <li key={a.id} className="relative">
                    <span
                      className={`absolute -left-[25px] flex h-5 w-5 items-center justify-center rounded-full ${ACTION_TONE[a.type]}`}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-xs font-semibold text-slate-800">
                          {ACTION_LABELS[a.type]}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {fmtDateTime(a.createdAt)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        by <span className="font-medium text-slate-700">{a.userName}</span>
                        {roleSuffix(a.userRole)}
                        {a.note ? ` — ${a.note}` : ""}
                      </div>
                      {gapMin !== null && (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          +{fmtMinutes(gapMin)} after previous step
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Final email template */}
          {patient.templateBody && (
            <section aria-label="Email template sent">
              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                  Financial notification email (as copied)
                  <span className="text-slate-400">expand</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                    {patient.templateBody}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
