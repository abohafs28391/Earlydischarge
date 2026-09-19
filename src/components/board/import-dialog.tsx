"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Sparkles, Upload } from "lucide-react";
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
import { EXAMPLE_CSV, parsePatientCsv } from "@/lib/csv";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialties: string[];
  onSubmitCsv: (csv: string) => Promise<{ created: number }>;
}

/** Patient-list import: paste from Excel/CSV or upload a file. The preview
 *  parses client-side with the same parser the server uses. */
export function ImportDialog({ open, onOpenChange, specialties, onSubmitCsv }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () => (text.trim() ? parsePatientCsv(text, specialties) : null),
    [text, specialties]
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const content = await file.text();
    setText(content);
  };

  const importNow = async () => {
    setBusy(true);
    try {
      const result = await onSubmitCsv(text);
      if (result.created > 0) {
        setText("");
        setFileName(null);
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Import patient list
          </DialogTitle>
          <DialogDescription>
            Paste the list straight from Excel/CSV or upload a file. Columns: patient name, room or
            bed (number coding — e.g. 201 means floor 2), assigned doctor, and specialty. An MRN
            column is optional; missing MRNs are auto-generated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
              {fileName ?? "Choose file"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setFileName("example.csv");
                setText(EXAMPLE_CSV);
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Fill example
            </Button>
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"MRN,Patient Name,Room,Assigned Doctor,Specialty\n4829101,Adel Mansour,201,Dr. Ahmed Samy,Internal Medicine"}
            rows={7}
            className="font-mono text-[12px]"
            aria-label="Patient list text"
          />

          {parsed && (
            <div className="space-y-2">
              {parsed.errors.length > 0 && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
                  {parsed.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{e}</span>
                    </div>
                  ))}
                </div>
              )}
              {parsed.rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">MRN</th>
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Room</th>
                        <th className="px-2 py-1.5 font-medium">Floor</th>
                        <th className="px-2 py-1.5 font-medium">Doctor</th>
                        <th className="px-2 py-1.5 font-medium">Specialty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 50).map((r) => (
                        <tr key={r.mrn} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-mono">{r.mrn}</td>
                          <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
                          <td className="px-2 py-1.5 font-mono">{r.room}</td>
                          <td className="px-2 py-1.5">{r.floor}</td>
                          <td className="px-2 py-1.5">{r.doctorName || "—"}</td>
                          <td className="px-2 py-1.5">{r.doctorSpecialty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > 50 && (
                    <p className="px-2 py-1.5 text-[11px] text-slate-400">
                      …and {parsed.rows.length - 50} more
                    </p>
                  )}
                </div>
              )}
              {parsed.rows.some((r) => r.warnings.length > 0) && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  {parsed.rows
                    .flatMap((r) => r.warnings.map((w) => `Row ${r.row} (${r.name}): ${w}`))
                    .slice(0, 8)
                    .map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="gap-1.5 bg-teal-600 hover:bg-teal-700"
            disabled={busy || !parsed || parsed.rows.length === 0}
            onClick={importNow}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {parsed && parsed.rows.length > 0
              ? `Import ${parsed.rows.length} patient${parsed.rows.length === 1 ? "" : "s"}`
              : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
