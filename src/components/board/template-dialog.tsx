"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { PatientJson, UserJson } from "@/lib/workflow";
import { buildFinanceEmail } from "@/lib/workflow";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtTime } from "@/lib/format";

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: PatientJson | null;
  currentUser: UserJson | null;
  medicalReadyByName: string | null;
  onCopyTemplate: (patientId: string, templateBody: string) => Promise<void>;
  onMarkNotified: (patientId: string) => Promise<void>;
  busy: boolean;
  /** Read-only rendering (admin demo view or view-only account). */
  readOnly?: boolean;
}

/** Stage 2 workflow: system collates the template, the nurse revises it,
 *  copies it (time is logged), sends it from their own email client, then
 *  marks the stage completed. */
export function TemplateDialog({
  open,
  onOpenChange,
  patient,
  currentUser,
  medicalReadyByName,
  onCopyTemplate,
  onMarkNotified,
  busy,
  readOnly = false,
}: TemplateDialogProps) {
  const [draft, setDraft] = useState<{ patientId: string; text: string } | null>(null);

  const template = useMemo(() => {
    if (!patient || !currentUser) return null;
    return buildFinanceEmail(patient, medicalReadyByName, currentUser);
  }, [patient, currentUser, medicalReadyByName]);

  if (!patient || !currentUser || !template) {
    return null;
  }

  // The nurse's working copy: falls back to the saved final text (after copy)
  // or the freshly collated template on first open.
  const body =
    draft && draft.patientId === patient.id
      ? draft.text
      : (patient.templateBody ?? template.body);

  const copied = !!patient.templateCopiedAt;
  const notified = !!patient.financeNotifiedAt;
  const canAct =
    currentUser.role === "NURSE" &&
    currentUser.floors.includes(patient.floor) &&
    currentUser.canEdit &&
    !readOnly;

  const fullText = `${template.subject}\n\n${body}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-sky-600" aria-hidden="true" />
            Financial notification email
          </DialogTitle>
          <DialogDescription>
            Collated by the system from the patient record — revise as needed, copy it, send it to
            the financial team from your email client, then mark the stage completed. Copying logs
            the time automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-[11px] leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-700">{patient.name}</span> · MRN {patient.mrn} ·
            Room {patient.room} (Floor {patient.floor}) · {patient.doctorName} (
            {patient.doctorSpecialty})
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-subject" className="text-xs font-medium text-slate-600">
              Subject
            </label>
            <Input id="tpl-subject" readOnly value={template.subject} className="bg-slate-50" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-body" className="text-xs font-medium text-slate-600">
              Body {copied && <span className="text-slate-400">(final version as copied)</span>}
            </label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setDraft({ patientId: patient.id, text: e.target.value })}
              readOnly={copied}
              rows={16}
              className="font-mono text-[12px] leading-relaxed"
            />
          </div>

          {copied && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              Template copied at {fmtTime(patient.templateCopiedAt)} — time logged.
              {!notified && " Now send it to the financial team, then mark the stage completed."}
              {notified && " Email sent and stage completed."}
            </div>
          )}

          {!canAct && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {readOnly
                ? "Read-only view — the acting nurse could revise, copy and send this template."
                : `Only a nurse assigned to Floor ${patient.floor} can drive this stage — you are viewing read-only.`}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {canAct && !copied && (
            <Button
              className="gap-1.5 bg-sky-600 hover:bg-sky-700"
              disabled={busy}
              onClick={async () => {
                await onCopyTemplate(patient.id, body);
                const ok = await copyToClipboard(fullText);
                if (ok) {
                  onOpenChange(false);
                }
              }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy template — log time
            </Button>
          )}
          {canAct && copied && !notified && (
            <Button
              className="gap-1.5 bg-sky-600 hover:bg-sky-700"
              disabled={busy}
              onClick={() => onMarkNotified(patient.id)}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Mark notification completed
            </Button>
          )}
          {canAct && copied && !notified && (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={() => copyToClipboard(fullText)}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy again
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
