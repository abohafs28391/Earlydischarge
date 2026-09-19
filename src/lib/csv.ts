/**
 * DischargeFlow — patient-list import parser.
 * Accepts CSV (comma), TSV (Excel paste) or semicolon-delimited text with
 * flexible header names, quoted fields and an optional explicit floor column.
 * Shared by the import dialog (live preview) and POST /api/patients.
 */

import { floorFromRoom } from "@/lib/workflow";

export interface ParsedPatientRow {
  row: number; // 1-based source line number
  mrn: string;
  name: string;
  room: string;
  floor: number;
  doctorName: string;
  doctorSpecialty: string;
  warnings: string[];
}

export interface ParseResult {
  rows: ParsedPatientRow[];
  errors: string[]; // fatal per-line problems (line is skipped)
  headersFound: Record<string, string>; // canonical -> raw header
}

const HEADER_ALIASES: Record<string, string[]> = {
  mrn: ["mrn", "id", "patientid", "patientid#", "medicalrecord", "medicalrecordnumber", "code", "fileno", "filenumber"],
  name: ["name", "patient", "patientname", "fullname", "patientfullname"],
  room: ["room", "bed", "roomno", "roomnumber", "roombed", "bedno", "bednumber", "wardbed", "room#"],
  doctor: ["doctor", "physician", "assigneddoctor", "attending", "attendingdoctor", "attendingphysician", "consultant", "dr", "doctorname"],
  specialty: ["specialty", "speciality", "department", "doctordepartment", "drspecialty", "doctorspecialty", "specialist"],
  floor: ["floor", "level", "storey", "story"],
};

function sniffDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    ["\t", (line.match(/\t/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    [",", (line.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Minimal quoted-aware field splitter. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_.-]+/g, "");
}

function mapHeaders(rawHeaders: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    const n = norm(h);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(n) && !(canonical in map)) {
        map[canonical] = idx;
      }
    }
  });
  return map;
}

export function parsePatientCsv(text: string, knownSpecialties: string[] = []): ParseResult {
  const errors: string[] = [];
  const rows: ParsedPatientRow[] = [];
  const headersFound: Record<string, string> = {};

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows, errors: ["The list is empty — paste the patient list or choose a file."], headersFound };
  }

  const delim = sniffDelimiter(lines[0]);
  const firstCells = splitLine(lines[0], delim).map((c) => c.trim());
  const hasHeader = mapHeaders(firstCells).name !== undefined || mapHeaders(firstCells).room !== undefined;

  let cols: Record<string, number>;
  let startLine: number;

  if (hasHeader) {
    cols = mapHeaders(firstCells);
    Object.entries(HEADER_ALIASES).forEach(([canonical, aliases]) => {
      const idx = cols[canonical];
      if (idx !== undefined) headersFound[canonical] = firstCells[idx];
    });
    startLine = 1;
    if (cols.name === undefined) {
      errors.push("Could not find a patient name column (tried: name, patient, patient name…).");
    }
    if (cols.room === undefined) {
      errors.push("Could not find a room/bed column (tried: room, bed, room no…).");
    }
  } else {
    // Headerless: expect [mrn?, name, room, doctor, specialty] or [name, room, doctor, specialty]
    cols = {};
    const width = firstCells.length;
    let idx = 0;
    if (width >= 5) {
      cols.mrn = idx++;
    }
    cols.name = idx++;
    cols.room = idx++;
    cols.doctor = idx++;
    if (width >= 4) cols.specialty = idx++;
    startLine = 0;
    errors.push(
      "No header row detected — assuming column order: " +
        (width >= 5 ? "MRN, Name, Room, Doctor, Specialty." : "Name, Room, Doctor, Specialty. Add a header row to be safe.")
    );
  }

  const seenMrn = new Set<string>();
  let autoMrn = 1;

  for (let i = startLine; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitLine(lines[i], delim);

    const name = cols.name !== undefined ? (cells[cols.name] ?? "").trim() : "";
    const room = cols.room !== undefined ? (cells[cols.room] ?? "").trim() : "";
    const doctorName = cols.doctor !== undefined ? (cells[cols.doctor] ?? "").trim() : "";
    const specialty = cols.specialty !== undefined ? (cells[cols.specialty] ?? "").trim() : "";
    let mrn = cols.mrn !== undefined ? (cells[cols.mrn] ?? "").trim() : "";

    if (!name) {
      errors.push(`Line ${lineNo}: missing patient name — skipped.`);
      continue;
    }
    if (!room) {
      errors.push(`Line ${lineNo}: missing room/bed for "${name}" — skipped.`);
      continue;
    }
    if (!specialty) {
      errors.push(`Line ${lineNo}: missing doctor specialty for "${name}" — skipped (it gates who can medically clear).`);
      continue;
    }

    const warnings: string[] = [];

    let floor: number | null = null;
    if (cols.floor !== undefined) {
      const fRaw = (cells[cols.floor] ?? "").trim();
      const f = parseInt(fRaw, 10);
      if (Number.isFinite(f)) floor = f;
    }
    if (floor === null) {
      floor = floorFromRoom(room);
      if (floor === null) {
        errors.push(`Line ${lineNo}: room "${room}" has no number coding (e.g. 201 → floor 2) and no floor column — skipped.`);
        continue;
      }
    }

    if (!mrn) {
      mrn = `AUTO-${String(Date.now()).slice(-5)}-${autoMrn++}`;
      warnings.push("MRN missing — auto-generated.");
    }
    if (seenMrn.has(mrn)) {
      errors.push(`Line ${lineNo}: duplicate MRN "${mrn}" within the file — skipped.`);
      continue;
    }
    seenMrn.add(mrn);

    if (!doctorName) {
      warnings.push("Assigned doctor name missing.");
    }

    if (
      knownSpecialties.length > 0 &&
      !knownSpecialties.some((s) => s.trim().toLowerCase() === specialty.toLowerCase())
    ) {
      warnings.push(
        `No registered physician has specialty "${specialty}" yet — import works, but nobody can medically clear until one is added.`
      );
    }

    rows.push({ row: lineNo, mrn, name, room, floor, doctorName, doctorSpecialty: specialty, warnings });
  }

  return { rows, errors, headersFound };
}

export const EXAMPLE_CSV = `MRN,Patient Name,Room,Assigned Doctor,Specialty
4829101,Adel Mansour,201,Dr. Ahmed Samy,Internal Medicine
4829102,Hoda Kamel,203-B,Dr. Layla Nasser,Cardiology
4829103,Youssef Ragab,115,Dr. Dina Rushdy,Pediatrics
4829104,Sameh Nassif,312,Dr. Tarek Gamal,Orthopedics
4829105,Ghada Sherif,421,Dr. Amira Zaki,Obstetrics & Gynecology
`;
