"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { STAGES, STAGE_TARGETS, TOTAL_TARGET_MIN } from "@/lib/workflow";
import { fmtMinutes } from "@/lib/format";

interface SpecSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SOURCES = [
  {
    label: "3 h maximum acceptable decision-to-discharge time",
    cite: "El-Abbassy et al. 2021, PMC (trauma cohort) — basis for the total pipeline target",
  },
  {
    label: "Median order-to-departure 171 min → 88 min after intervention",
    cite: "UCLA Health, Oct 2025 — basis for the post-finance targets (reception papers + departure)",
  },
  {
    label: "Discharge-before-noon target ~30%, actual 15–20%",
    cite: "PMC11025149; PMC11613578 — the before-noon KPI",
  },
  {
    label: "Prior-authorization delays well documented; no stage-TAT benchmark",
    cite: "AMA 2024 — the financial stage target stays DRAFT until calibrated on your data",
  },
];

export function SpecSheet({ open, onOpenChange }: SpecSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <SheetTitle className="text-base">Workflow specification</SheetTitle>
          <SheetDescription className="text-xs">
            Pipeline stages, role permissions, privileges, alarms, room coding, delay thresholds,
            analysis methodology and their sources. Thresholds marked{" "}
            <span className="font-semibold text-rose-600">draft</span> are provisional pending
            calibration on your real timestamps.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-5 text-[13px] leading-relaxed text-slate-700">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Pipeline</h3>
            <ol className="space-y-2">
              {STAGES.map((s) => (
                <li key={s.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {s.num}. {s.title}
                    </span>
                    <span className="text-[11px] text-slate-500">{s.owner}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{s.description}</p>
                </li>
              ))}
            </ol>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Who can do what</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Sees</th>
                    <th className="px-3 py-2 font-medium">Can do</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-3 py-2 font-medium">Nurse (per floor, multi-select)</td>
                    <td className="px-3 py-2">
                      Own assigned floor(s); a multi-floor nurse picks the floor they are working
                      on
                    </td>
                    <td className="px-3 py-2">
                      Revise + copy the notification email, mark notification completed, mark
                      physically discharged (once reception confirmed the papers). At the
                      notification stage: copy the cancellation mail and Cancel the discharge
                      (typed confirmation) — the patient returns to Medical Clearance
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Physician (per specialty)</td>
                    <td className="px-3 py-2">Only patients of their own specialty</td>
                    <td className="px-3 py-2">
                      Record the Discharge / No-discharge decision for patients whose assigned
                      doctor specialty matches their own. A Discharge decision moves the patient on
                      only after the confirmation window (default 60s, admin-adjustable) — during
                      which the physician can undo or change it
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Financial team</td>
                    <td className="px-3 py-2">Patients once the notification email is sent</td>
                    <td className="px-3 py-2">
                      Mark patients financially cleared — everything else read-only
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Reception personnel</td>
                    <td className="px-3 py-2">Patients once financially cleared (and discharged)</td>
                    <td className="px-3 py-2">
                      Confirm all discharge papers are done — the patient then moves to the floor
                      nurse&rsquo;s departure step
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Universal — managers &amp; quality</td>
                    <td className="px-3 py-2">The whole hospital</td>
                    <td className="px-3 py-2">
                      Read-only oversight + the Analysis tab; no pipeline actions
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Admin</td>
                    <td className="px-3 py-2">The whole hospital + Admin console</td>
                    <td className="px-3 py-2">
                      Set every other category&rsquo;s editing/viewing mode, demo any user view
                      (read-only), own alarm rules &amp; webhook notifications, import lists, manage
                      demo data &amp; the audit trail
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              The assigned doctor does not need to be the one who acts — any physician of the same
              specialty may decide. A recorded Discharge auto-confirms once the decision window
              closes (Admin → Workflow; default 60s) and the patient then waits for the floor
              nurse; undo and change are logged. Once financially cleared, a patient is listed in
              BOTH the Reception and the Physical Discharge columns until departure; discharged
              patients move off the board into the header&rsquo;s Discharged list. Every step logs
              both the timestamp and the user who completed it, in an append-only audit log.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Privileges &amp; demo views</h3>
            <p className="text-xs text-slate-600">
              Admins control two switches for every non-admin account:{" "}
              <b>editing mode</b> (on = normal actions; off = view-only — the server rejects their
              mutations) and <b>viewing mode</b> (off = the board is hidden entirely). Categories can
              be flipped in bulk. Admin accounts are locked so nobody locks themselves out. From the
              Admin console, <b>demo views</b> let an admin jump into any other user&rsquo;s
              perspective — scoped board, buttons and notifications render exactly as that account
              sees them, but strictly read-only (server-enforced) with a banner until exited.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Notifications &amp; alarms</h3>
            <p className="text-xs text-slate-600">
              Two streams reach <b>task owners only</b>: <b>handoffs</b> (a patient just entered your
              stage — specialty physicians at stage 1, floor nurses at stages 2/5, the financial team
              at stage 3, reception personnel at stage 4) and <b>alarms</b> (a patient&rsquo;s stay in
              the current stage crossed an admin-configured threshold). Default rules mirror the
              board flags — WARN at the stage target, LATE at twice it. Alarm delivery is deduplicated per rule + patient and is
              routed in-app plus, for now, via <b>webhook</b> (per-rule URL or one global URL —
              both POST a payload with rule, patient, minutes-in-stage and task owners; every
              attempt lands in the delivery log). Webhook URLs are <b>auto-detected</b>: Discord,
              Slack and Teams endpoints receive channel-formatted messages with patient
              identifiers stripped (PHI-lite), while any other URL receives the full JSON. The
              transport is designed to be swapped later (email / SMS / push) without touching
              the rules.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Analysis tab</h3>
            <p className="text-xs text-slate-600">
              One tab computes the dashboard&rsquo;s statistics over a duration you set — today, last
              7 or 30 days, or a custom window. Cohort: patients imported inside the window. It
              reports the <b>delayed % of every stage</b> (turnaround over the stage target, or still
              waiting past it), the <b>delayed % of every specialty</b> (per stage and overall), and
              the <b>TAT of every stage</b> (median / mean / p90 turnaround), plus totals against the
              3h benchmark and daily import vs discharge volumes. Results respect your visibility
              (nurses see their floors; finance sees notified patients; reception sees financially
              cleared patients; physicians see their own specialty; universal and admin accounts see
              the whole hospital).
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Room number coding</h3>
            <p className="text-xs text-slate-600">
              The floor is derived from the room/bed code: the leading digits are the floor —{" "}
              <code className="rounded bg-slate-100 px-1 font-mono">201</code> → floor 2,{" "}
              <code className="rounded bg-slate-100 px-1 font-mono">115</code> → floor 1,{" "}
              <code className="rounded bg-slate-100 px-1 font-mono">1125</code> → floor 11, two-digit
              rooms like <code className="rounded bg-slate-100 px-1 font-mono">12</code> → floor 1.
              Letters are ignored (<code className="rounded bg-slate-100 px-1 font-mono">203-B</code>{" "}
              → floor 2). An explicit <i>floor</i> column in the import overrides the derivation.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Delay thresholds</h3>
            <ul className="space-y-1.5 text-xs">
              {STAGES.slice(0, 5).map((s) => {
                const t = STAGE_TARGETS[s.num];
                return (
                  <li key={s.key} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{s.title}</span>
                      <span className="font-mono text-slate-500">{fmtMinutes(t.targetMin)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{t.basis}</p>
                    {!t.calibrated && (
                      <span className="mt-1 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-600">
                        draft
                      </span>
                    )}
                  </li>
                );
              })}
              <li className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">Total pipeline (medical → departure)</span>
                  <span className="font-mono text-slate-500">{fmtMinutes(TOTAL_TARGET_MIN)}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  El-Abbassy et al. 2021, PMC — 3h maximum acceptable from discharge decision to
                  actual discharge.
                </p>
              </li>
            </ul>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Import format</h3>
            <p className="text-xs text-slate-600">
              CSV, TSV (Excel paste) or semicolon-delimited. Recognised headers (case-insensitive):{" "}
              <span className="font-mono">MRN / Patient Name / Room|Bed / Assigned Doctor / Specialty</span>{" "}
              — plus an optional <span className="font-mono">Floor</span> override. Headerless lists
              are assumed to be{" "}
              <span className="font-mono">MRN, Name, Room, Doctor, Specialty</span> in that order.
              Unknown specialties import fine but no physician can medically clear them until one is
              registered.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Benchmark sources</h3>
            <ul className="space-y-1.5">
              {SOURCES.map((s) => (
                <li key={s.label} className="text-xs">
                  <span className="font-medium text-slate-700">{s.label}</span>
                  <div className="text-[11px] text-slate-500">{s.cite}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
