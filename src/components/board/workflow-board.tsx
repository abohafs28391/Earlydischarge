"use client";

import { useState } from "react";
import {
  Ban,
  Check,
  ClipboardCheck,
  Clock,
  DoorOpen,
  Mail,
  MailX,
  Receipt,
  Stethoscope,
  Timer,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { copyToClipboard } from "@/lib/clipboard";
import type { ActionType, PatientView, UserJson } from "@/lib/workflow";
import { buildCancelEmail, permissionsFor, STAGES } from "@/lib/workflow";
import { fmtMinutes, fmtTime } from "@/lib/format";

export type ActFn = (
  patientId: string,
  type: ActionType,
  templateBody?: string
) => Promise<void>;

interface WorkflowBoardProps {
  views: PatientView[];
  currentUser: UserJson | null;
  usersById: Map<string, UserJson>;
  onAct: ActFn;
  onOpenPatient: (id: string) => void;
  onOpenTemplate: (id: string) => void;
  busyKey: string | null;
  /** Read-only rendering (admin demoing another user's view). */
  readOnly?: boolean;
  /** Physician decision window (seconds) — the stage-1 countdown + undo
   *  window length, from the admin-adjustable setting. */
  decisionWindowSec: number;
}

const COLUMN_STYLE: Record<number, { icon: typeof Stethoscope; accent: string; ring: string }> = {
  1: { icon: Stethoscope, accent: "text-teal-700", ring: "border-t-teal-500" },
  2: { icon: Mail, accent: "text-sky-700", ring: "border-t-sky-500" },
  3: { icon: Receipt, accent: "text-amber-700", ring: "border-t-amber-500" },
  4: { icon: ClipboardCheck, accent: "text-indigo-700", ring: "border-t-indigo-500" },
  5: { icon: DoorOpen, accent: "text-orange-700", ring: "border-t-orange-500" },
};

const FLOOR_BADGE = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-800",
];

function floorBadgeCls(floor: number): string {
  return FLOOR_BADGE[(floor - 1 + FLOOR_BADGE.length * 8) % FLOOR_BADGE.length];
}

function FlagBadge({ view }: { view: PatientView }) {
  if (view.flag === "ok") return null;
  const late = view.flag === "late";
  return (
    <span
      title={`${view.stageTargetMin ? `Stage target ${fmtMinutes(view.stageTargetMin)}` : ""} — draft threshold`}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        late ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {late ? "Well over" : "Over target"}
    </span>
  );
}

function DoneLine({ at, by, label }: { at: string | null; by: string | null; label: string }) {
  if (!at) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
      <span className="truncate">
        {label} {fmtTime(at)}
        {by ? ` · ${by}` : ""}
      </span>
    </div>
  );
}

/** Typed-confirmation dialog for cancelling a stage-2 discharge (update
 *  0.3): the nurse must type the word "cancel" before the button unlocks —
 *  an accidental click can never send the patient back on its own.
 *  Conditionally mounted per card, so the input starts empty on every open. */
function CancelConfirmDialog({
  onOpenChange,
  view,
  busy,
  onConfirm,
}: {
  onOpenChange: (open: boolean) => void;
  view: PatientView;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim().toLowerCase() === "cancel";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            Cancel this discharge?
          </DialogTitle>
          <DialogDescription>
            {view.name} (Room {view.room}, Floor {view.floor}) returns to{" "}
            <b>Medical Clearance</b> and the physician records a fresh decision. The stage-1 and
            stage-2 steps are reset; the full history stays in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="cancel-confirm-input" className="text-xs font-medium text-slate-600">
            Type <b>cancel</b> to confirm
          </label>
          <Input
            id="cancel-confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="cancel"
            autoComplete="off"
            aria-describedby="cancel-confirm-hint"
          />
          <p id="cancel-confirm-hint" className="text-[11px] text-slate-400">
            Typing the word prevents an accidental click — the Confirm button stays locked until
            it matches.
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            variant="destructive"
            className="gap-1.5"
            disabled={!confirmed || busy}
            title={confirmed ? undefined : "Type the word cancel to unlock"}
            onClick={() => {
              onConfirm();
            }}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Cancel discharge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PatientCardProps {
  view: PatientView;
  currentUser: UserJson | null;
  usersById: Map<string, UserJson>;
  onAct: ActFn;
  onOpenPatient: (id: string) => void;
  onOpenTemplate: (id: string) => void;
  busy: boolean;
  readOnly?: boolean;
  /** Column the card is rendered in — a stage-4 patient is dual-listed in
   *  the Physical Discharge column (5) as "waiting on reception papers". */
  columnNum: number;
  /** Physician decision window (seconds) — stage-1 countdown length. */
  decisionWindowSec: number;
}

function PatientCard({
  view,
  currentUser,
  usersById,
  onAct,
  onOpenPatient,
  onOpenTemplate,
  busy,
  readOnly = false,
  columnNum,
  decisionWindowSec,
}: PatientCardProps) {
  const { toast } = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const name = (id: string | null) => (id ? usersById.get(id)?.name ?? "—" : "—");
  const perm = permissionsFor(currentUser, view);
  const stage = view.stage;
  const inDischargeColumn = columnNum === 5 && stage === 4;

  const flagBorder =
    view.flag === "late"
      ? "border-l-rose-500"
      : view.flag === "warn"
        ? "border-l-amber-500"
        : "border-l-emerald-400";

  const physicianSpecialtyNote =
    stage === 1 &&
    currentUser?.role === "PHYSICIAN" &&
    !perm.canMedicalDecide &&
    currentUser.specialty
      ? `Only ${view.doctorSpecialty} physicians can decide on this patient`
      : null;

  // --- stage-1 physician decision state (update 0.3) -----------------------
  const pendingDischarge =
    stage === 1 && view.medicalDecision === "DISCHARGE" && !!view.medicalDecisionAt;
  const remainSec = pendingDischarge
    ? Math.max(
        0,
        Math.ceil(
          (new Date(view.medicalDecisionAt as string).getTime() +
            decisionWindowSec * 1000 -
            Date.now()) /
            1000
        )
      )
    : null;
  const decidedNo = stage === 1 && view.medicalDecision === "NO_DISCHARGE";

  /** "Send cancel mail" — copies the collated cancellation template and
   *  logs the copy (audit), mirroring the financial-template pattern. */
  const copyCancelMail = async () => {
    if (!currentUser) return;
    const tpl = buildCancelEmail(view, currentUser);
    const ok = await copyToClipboard(`${tpl.subject}\n\n${tpl.body}`);
    await onAct(view.id, "COPY_CANCEL_TEMPLATE");
    toast({
      title: ok ? "Cancellation template copied" : "Clipboard unavailable",
      description: ok
        ? "Paste it into your email client and send it to the financial team."
        : "Copy the cancellation text manually from the patient drawer.",
      variant: ok ? undefined : "destructive",
    });
  };

  return (
    <article
      onClick={() => onOpenPatient(view.id)}
      className={`cursor-pointer rounded-lg border border-slate-200 border-l-4 ${flagBorder} bg-white p-3 shadow-sm transition-shadow hover:shadow-md`}
      aria-label={`Patient ${view.name}, MRN ${view.mrn}, room ${view.room}, stage ${stage} of 5`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${floorBadgeCls(view.floor)}`}
              title={`Room ${view.room} — floor ${view.floor} (number coding)`}
            >
              {view.room}
            </span>
            <span className="truncate text-sm font-semibold text-slate-900">{view.name}</span>
            <FlagBadge view={view} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            MRN {view.mrn} · {view.doctorName} ({view.doctorSpecialty})
          </div>
        </div>
        {stage < 6 && (
          <div className="shrink-0 text-right">
            <div className="flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-slate-900">
              <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
              {fmtMinutes(view.minutesInStage)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              in stage{view.stageTargetMin ? ` / ${fmtMinutes(view.stageTargetMin)}` : ""}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {stage === 1 && (
          <>
            {physicianSpecialtyNote && (
              <p className="text-[11px] italic text-slate-400">{physicianSpecialtyNote}</p>
            )}
            {readOnly && (
              <p className="text-[11px] italic text-violet-600">Demo view — actions disabled</p>
            )}

            {/* Pending DISCHARGE decision — confirmation window countdown.
                Every viewer sees the state; the deciding physician can still
                undo or change it while the window runs. */}
            {pendingDischarge && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Timer className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {remainSec !== null && remainSec > 0
                    ? `Discharge decided — moves on in ${remainSec}s`
                    : "Discharge decided — confirming…"}
                </span>
                <span className="block truncate text-amber-700">
                  by {name(view.medicalDecisionById)} {fmtTime(view.medicalDecisionAt)} · undo window
                  open
                </span>
              </div>
            )}

            {/* Standing NO_DISCHARGE decision — patient intentionally held. */}
            {decidedNo && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-snug text-rose-800">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Physician decision: No discharge
                </span>
                <span className="block truncate text-rose-700">
                  by {name(view.medicalDecisionById)} {fmtTime(view.medicalDecisionAt)}
                </span>
              </div>
            )}

            {/* The physician's two options: Discharge / No discharge. A
                pending discharge swaps them for Undo / No discharge; a
                standing No discharge offers changing the decision. */}
            {perm.canMedicalDecide && !pendingDischarge && !decidedNo && (
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  className="h-8 gap-1 bg-teal-600 hover:bg-teal-700"
                  disabled={busy || readOnly}
                  title={readOnly ? "Read-only admin demo view" : "Moves the patient on after the confirmation window"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(view.id, "MEDICAL_DECIDED_DISCHARGE");
                  }}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Discharge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-slate-600"
                  disabled={busy || readOnly}
                  title={readOnly ? "Read-only admin demo view" : "Patient stays in Medical Clearance"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(view.id, "MEDICAL_DECIDED_NO");
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  No discharge
                </Button>
              </div>
            )}
            {perm.canMedicalDecide && pendingDischarge && (
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={busy || readOnly}
                  title="Clear the pending decision — the patient stays awaiting one"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(view.id, "MEDICAL_UNDO");
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Undo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-slate-600"
                  disabled={busy || readOnly}
                  title="Change the decision — the patient stays in Medical Clearance"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(view.id, "MEDICAL_DECIDED_NO");
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  No discharge
                </Button>
              </div>
            )}
            {perm.canMedicalDecide && decidedNo && (
              <Button
                size="sm"
                className="h-8 w-full gap-1.5 bg-teal-600 hover:bg-teal-700"
                disabled={busy || readOnly}
                title="Change the decision — starts the confirmation window"
                onClick={(e) => {
                  e.stopPropagation();
                  onAct(view.id, "MEDICAL_DECIDED_DISCHARGE");
                }}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Change decision — Discharge
              </Button>
            )}
          </>
        )}

        {stage === 2 && (
          <>
            <DoneLine
              at={view.medicalReadyAt}
              by={name(view.medicalReadyById)}
              label="Medically cleared"
            />
            {view.templateCopiedAt ? (
              <DoneLine
                at={view.templateCopiedAt}
                by={name(view.templateCopiedById)}
                label="Template copied"
              />
            ) : (
              <p className="text-[11px] text-slate-400">Email template not copied yet</p>
            )}
            {perm.canOpenTemplate && (
              <Button
                size="sm"
                className="h-8 w-full gap-1.5 bg-sky-600 hover:bg-sky-700"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTemplate(view.id);
                }}
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                Open email template
              </Button>
            )}
            {perm.canMarkNotified && (
              <Button
                size="sm"
                className="h-8 w-full gap-1.5 bg-sky-600 hover:bg-sky-700"
                disabled={busy || readOnly}
                title={readOnly ? "Read-only admin demo view" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onAct(view.id, "FINANCE_NOTIFIED");
                }}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Mark notification completed
              </Button>
            )}

            {/* Called-off discharge (update 0.3): copy the cancellation mail,
                then Cancel — typed confirmation — sends the patient back to
                the Medical Clearance column. */}
            {perm.canCancelDischarge && (
              <>
                <div className="mt-1 border-t border-slate-100 pt-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Discharge called off?
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    disabled={busy || readOnly}
                    title={
                      readOnly
                        ? "Read-only admin demo view"
                        : "Copies the cancellation template for your email client — the copy is logged"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyCancelMail();
                    }}
                  >
                    <MailX className="h-3.5 w-3.5" aria-hidden="true" />
                    Send cancel mail
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 gap-1"
                    disabled={busy || readOnly}
                    title={
                      readOnly
                        ? "Read-only admin demo view"
                        : "Typed confirmation — the card returns to Medical Clearance"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setCancelOpen(true);
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {stage === 3 && (
          <>
            <DoneLine
              at={view.financeNotifiedAt}
              by={name(view.financeNotifiedById)}
              label="Email sent to finance"
            />
            <DoneLine
              at={view.templateCopiedAt}
              by={name(view.templateCopiedById)}
              label="Template copied"
            />
            {perm.canFinanceClear ? (
              <Button
                size="sm"
                className="h-8 w-full gap-1.5 bg-amber-600 hover:bg-amber-700"
                disabled={busy || readOnly}
                title={readOnly ? "Read-only admin demo view" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onAct(view.id, "FINANCE_CLEARED");
                }}
              >
                <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                Mark financially cleared
              </Button>
            ) : (
              <p className="text-[11px] text-slate-400">Awaiting financial team</p>
            )}
          </>
        )}

        {stage === 4 && (
          <>
            <DoneLine
              at={view.financeClearedAt}
              by={name(view.financeClearedById)}
              label="Financially cleared"
            />
            {inDischargeColumn ? (
              <p className="text-[11px] text-slate-400">
                Awaiting reception papers — the discharge button appears once reception
                confirms them.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-slate-400">Discharge papers not confirmed yet</p>
                {readOnly && (
                  <p className="text-[11px] italic text-violet-600">Demo view — actions disabled</p>
                )}
                {perm.canReceptionReady && (
                  <Button
                    size="sm"
                    className="h-8 w-full gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                    disabled={busy || readOnly}
                    title={readOnly ? "Read-only admin demo view" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAct(view.id, "RECEPTION_READY");
                    }}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Confirm papers done
                  </Button>
                )}
                {currentUser && currentUser.role !== "RECEPTION" && !perm.canReceptionReady && (
                  <p className="text-[11px] italic text-slate-400">
                    Reception personnel confirm the papers for this stage
                  </p>
                )}
              </>
            )}
          </>
        )}

        {stage === 5 && (
          <>
            <DoneLine
              at={view.financeClearedAt}
              by={name(view.financeClearedById)}
              label="Financially cleared"
            />
            <DoneLine
              at={view.receptionReadyAt}
              by={name(view.receptionReadyById)}
              label="Papers confirmed"
            />
            {readOnly && (
              <p className="text-[11px] italic text-violet-600">Demo view — actions disabled</p>
            )}
            {perm.canPhysicalDischarge ? (
              <Button
                size="sm"
                className="h-8 w-full gap-1.5 bg-orange-600 hover:bg-orange-700"
                disabled={busy || readOnly}
                title={readOnly ? "Read-only admin demo view" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onAct(view.id, "PHYSICAL_DISCHARGED");
                }}
              >
                <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Mark physically discharged
              </Button>
            ) : (
              <p className="text-[11px] text-slate-400">Awaiting the floor nurse&rsquo;s departure mark</p>
            )}
          </>
        )}
      </div>

      {/* Typed-confirmation dialog for the stage-2 Cancel button. */}
      {cancelOpen && (
        <CancelConfirmDialog
          onOpenChange={(o) => !o && setCancelOpen(false)}
          view={view}
          busy={busy}
          onConfirm={() => {
            setCancelOpen(false);
            void onAct(view.id, "CANCEL_DISCHARGE");
          }}
        />
      )}
    </article>
  );
}

export function WorkflowBoard({
  views,
  currentUser,
  usersById,
  onAct,
  onOpenPatient,
  onOpenTemplate,
  busyKey,
  readOnly = false,
  decisionWindowSec,
}: WorkflowBoardProps) {
  const financeHiddenNote =
    "Becomes visible to the financial team once the nurse sends the notification email";
  const receptionHiddenNote =
    "Becomes visible to reception once the patient is financially cleared";

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {STAGES.slice(0, 5).map((col) => {
        // A financially-cleared patient (stage 4) sits in BOTH the Reception
        // and the Physical Discharge column until it leaves.
        const items = views.filter(
          (v) => v.stage === col.num || (col.num === 5 && v.stage === 4)
        );
        const flagged = items.filter((v) => v.flag === "warn" || v.flag === "late").length;
        const style = COLUMN_STYLE[col.num];
        const Icon = style.icon;
        const hiddenForRole =
          (currentUser?.role === "FINANCE" && col.num < 3) ||
          (currentUser?.role === "RECEPTION" && col.num < 4);
        return (
          <section
            key={col.key}
            aria-label={`${col.title} column, ${items.length} patients`}
            className={`flex min-w-0 flex-col rounded-xl border border-slate-200 border-t-2 ${style.ring} bg-slate-50/60 p-2 shadow-sm`}
          >
            <div className="flex items-center justify-between gap-2 px-1.5 pb-2 pt-1">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${style.accent}`} aria-hidden="true" />
                <h2 className="text-xs font-semibold text-slate-700">{col.title}</h2>
              </div>
              <div className="flex items-center gap-1">
                {flagged > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 tabular-nums">
                    {flagged}
                  </span>
                )}
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 tabular-nums ring-1 ring-slate-200">
                  {items.length}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-0.5 lg:max-h-[calc(100vh-24rem)]">
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-400">
                  {hiddenForRole
                    ? currentUser?.role === "FINANCE"
                      ? financeHiddenNote
                      : receptionHiddenNote
                    : "No patients"}
                </p>
              ) : (
                items.map((v) => (
                  <PatientCard
                    key={`${v.id}-${col.num}`}
                    view={v}
                    currentUser={currentUser}
                    usersById={usersById}
                    onAct={onAct}
                    onOpenPatient={onOpenPatient}
                    onOpenTemplate={onOpenTemplate}
                    busy={busyKey === v.id}
                    readOnly={readOnly}
                    columnNum={col.num}
                    decisionWindowSec={decisionWindowSec}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
