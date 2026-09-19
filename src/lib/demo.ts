/**
 * DischargeFlow — demo patient generator.
 *
 * Two layers of synthetic data, both flagged isDemo and removable in one
 * click without touching real imported rows:
 *
 *   1. TODAY'S BOARD (22 patients) — spread over floors 1–4, all specialties
 *      and all pipeline stages with backdated timestamps, several
 *      intentionally over the draft targets so delay flags and alarms fire.
 *
 *   2. 30-DAY HISTORY (~200 discharged patients) — one deterministic batch
 *      per past day with realistic stage TATs and specialty-dependent delay
 *      rates, so the Analysis tab (delayed % per stage / per specialty,
 *      TAT per stage) has substance immediately.
 *
 * Every synthetic step is attributed to a seeded staff member and mirrored
 * into the Action audit log.
 */

import { db } from "@/lib/db";
import { floorFromRoom, parseFloors } from "@/lib/workflow";

const MIN = 60_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same numbers on every reload
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Today's board — patients across every stage (unchanged behaviour)
// ---------------------------------------------------------------------------

interface DemoStep {
  field:
    | "medicalReady"
    | "templateCopied"
    | "financeNotified"
    | "financeCleared"
    | "receptionReady"
    | "physicalDischarged";
  type:
    | "MEDICAL_READY"
    | "COPY_TEMPLATE"
    | "FINANCE_NOTIFIED"
    | "FINANCE_CLEARED"
    | "RECEPTION_READY"
    | "PHYSICAL_DISCHARGED";
  by: "physician" | "nurse" | "finance" | "reception";
  agoMin: number;
}

interface DemoPatient {
  mrn: string;
  name: string;
  room: string;
  doctor: string;
  steps: DemoStep[];
  /** Optional stage-1 physician decision (update 0.3): "DISCHARGE" starts
   *  the confirmation-window countdown (agoSec ago), "NO_DISCHARGE" holds
   *  the patient in Medical Clearance. */
  decision?: { choice: "DISCHARGE" | "NO_DISCHARGE"; agoSec: number };
}

const TODAY_DEMO: DemoPatient[] = [
  // --- Stage 1: awaiting the physician's decision ---
  { mrn: "9104201", name: "Adel Mansour", room: "201", doctor: "Internal Medicine", steps: [] },
  // physician recorded a No-discharge decision — held in Medical Clearance
  { mrn: "9104202", name: "Hoda Kamel", room: "203-B", doctor: "Cardiology", steps: [],
    decision: { choice: "NO_DISCHARGE", agoSec: 25 * 60 } },
  { mrn: "9104203", name: "Youssef Ragab", room: "115", doctor: "Pediatrics", steps: [] },
  { mrn: "9104204", name: "Sameh Nassif", room: "312", doctor: "Orthopedics", steps: [] },
  { mrn: "9104205", name: "Ghada Sherif", room: "421", doctor: "Obstetrics & Gynecology", steps: [] },
  { mrn: "9104206", name: "Kamal Aboul Fotouh", room: "108", doctor: "General Surgery", steps: [] },
  // pending DISCHARGE decision — the countdown runs and the patient moves
  // to Notify Financial Team once the 60s window closes (live demo)
  { mrn: "9104207", name: "Rania Zaki", room: "226", doctor: "Internal Medicine", steps: [],
    decision: { choice: "DISCHARGE", agoSec: 25 } },
  // imported long ago -> over the 4h draft target
  { mrn: "9104208", name: "Farid Selim", room: "335", doctor: "Neurology", steps: [] },
  { mrn: "9104209", name: "Amina Tawfik", room: "409", doctor: "Emergency Medicine", steps: [] },

  // --- Stage 2: nurse notifying the financial team ---
  { mrn: "9104210", name: "Mahmoud Rashad", room: "212", doctor: "Internal Medicine",
    steps: [{ field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 12 }] },
  { mrn: "9104211", name: "Salwa Habib", room: "118", doctor: "Pediatrics",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 40 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 22 },
    ] },
  // over the 30-min notification target
  { mrn: "9104212", name: "Tarek Mounir", room: "241", doctor: "Cardiology",
    steps: [{ field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 75 }] },
  // copied long ago but never marked sent -> well over target
  { mrn: "9104213", name: "Nadia Fahmy", room: "303", doctor: "General Surgery",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 130 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 110 },
    ] },

  // --- Stage 3: awaiting financial clearance ---
  { mrn: "9104214", name: "Hassan Gomaa", room: "127", doctor: "Internal Medicine",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 95 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 80 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 75 },
    ] },
  // over the 2h financial draft target
  { mrn: "9104215", name: "Iman Shukri", room: "235", doctor: "Neurology",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 260 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 245 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 240 },
    ] },
  { mrn: "9104216", name: "Osama Lutfi", room: "414", doctor: "Orthopedics",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 150 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 138 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 132 },
    ] },

  // --- Stage 4: reception papers pending (patient also sits in Physical
  //     Discharge, waiting on the papers) ---
  { mrn: "9104217", name: "Mervat Okasha", room: "106", doctor: "Pediatrics",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 200 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 185 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 180 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 100 },
    ] },
  // well over the 60-min reception target
  { mrn: "9104218", name: "Wahid Barakat", room: "318", doctor: "Emergency Medicine",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 330 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 315 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 310 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 195 },
    ] },

  // --- Stage 5: papers confirmed, awaiting physical discharge ---
  { mrn: "9104219", name: "Tharwat Amin", room: "210", doctor: "Internal Medicine",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 175 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 165 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 160 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 70 },
      { field: "receptionReady", type: "RECEPTION_READY", by: "reception", agoMin: 20 },
    ] },

  // --- Discharged today (listed via the header Discharged button) ---
  { mrn: "9104220", name: "Zeinab Al-Meligy", room: "220", doctor: "Internal Medicine",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 230 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 222 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 218 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 95 },
      { field: "receptionReady", type: "RECEPTION_READY", by: "reception", agoMin: 80 },
      { field: "physicalDischarged", type: "PHYSICAL_DISCHARGED", by: "nurse", agoMin: 60 },
    ] },
  { mrn: "9104221", name: "Ragaa Desouki", room: "134", doctor: "Obstetrics & Gynecology",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 300 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 288 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 282 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 150 },
      { field: "receptionReady", type: "RECEPTION_READY", by: "reception", agoMin: 135 },
      { field: "physicalDischarged", type: "PHYSICAL_DISCHARGED", by: "nurse", agoMin: 122 },
    ] },
  { mrn: "9104222", name: "Fouad Abdel Aal", room: "402", doctor: "Cardiology",
    steps: [
      { field: "medicalReady", type: "MEDICAL_READY", by: "physician", agoMin: 145 },
      { field: "templateCopied", type: "COPY_TEMPLATE", by: "nurse", agoMin: 140 },
      { field: "financeNotified", type: "FINANCE_NOTIFIED", by: "nurse", agoMin: 136 },
      { field: "financeCleared", type: "FINANCE_CLEARED", by: "finance", agoMin: 55 },
      { field: "receptionReady", type: "RECEPTION_READY", by: "reception", agoMin: 48 },
      { field: "physicalDischarged", type: "PHYSICAL_DISCHARGED", by: "nurse", agoMin: 30 },
    ] },
];

// ---------------------------------------------------------------------------
// 30-day discharged history — feeds the Analysis tab
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Mostafa", "Fatma", "Ibrahim", "Nagwa", "Sherif", "Azza", "Mahmoud", "Samira",
  "Ezzat", "Violet", "Hamdy", "Soad", "Farag", "Amal", "Ragab", "Leila",
  "Sabry", "Nahed", "Fouad", "Hoda", "Adel", "Zainab", "Maged", "Dalia",
  "Emad", "Rasha", "Galal", "Mervat", "Ashraf", "Yvonne", "Reda", "Sanaa",
];
const LAST_NAMES = [
  "Abdel Rahman", "Shafik", "El-Gohary", "Mansy", "Zaghoul", "Barakat", "El-Sayed",
  "Kandil", "Abou Zeid", "Rostom", "Habib", "El-Dib", "Mesallam", "Tadros",
  "Guirguis", "Shokry", "Fahim", "Nakhla", "Bayoumi", "Shalaby", "El-Sherbiny",
  "Abdel Malak", "Zaazou", "Henein",
];

/** Per-specialty stage-delay tendencies (0..2 multipliers on the base delay
 *  probability) — Orthopedics leans slower on financial clearance (prior
 *  auth on implants), Emergency Medicine slower on the physical steps. The
 *  4th entry biases both stage 4 (reception papers) and stage 5 (departure). */
const SPECIALTY_DELAY_BIAS: Record<string, number[]> = {
  // [stage1, stage2, stage3, reception+physical] multipliers
  "Internal Medicine": [1, 1, 1, 1],
  "General Surgery": [1.1, 1, 1.15, 1],
  Cardiology: [1, 1, 1.2, 1.1],
  Orthopedics: [1.2, 1, 1.6, 1.2],
  Pediatrics: [0.9, 1, 0.9, 0.9],
  "Obstetrics & Gynecology": [0.9, 1, 0.9, 1],
  Neurology: [1.3, 1, 1.2, 1.1],
  "Emergency Medicine": [0.9, 1, 1, 1.6],
};

const SPECIALTY_LIST = Object.keys(SPECIALTY_DELAY_BIAS);

export async function seedDemoPatients(): Promise<{ today: number; history: number }> {
  await db.patient.deleteMany({ where: { isDemo: true } });

  const [nurses, physicians, finance, reception] = await Promise.all([
    db.user.findMany({ where: { role: "NURSE" } }),
    db.user.findMany({ where: { role: "PHYSICIAN" } }),
    db.user.findMany({ where: { role: "FINANCE" } }),
    db.user.findMany({ where: { role: "RECEPTION" } }),
  ]);
  if (nurses.length === 0 || physicians.length === 0 || finance.length === 0) {
    throw new Error("Staff directory not seeded");
  }

  const nurseOnFloor = (floor: number) =>
    nurses.find((n) => parseFloors(n.floors).includes(floor)) ?? nurses[0];
  const physicianOf = (specialty: string) =>
    physicians.find(
      (p) => (p.specialty ?? "").toLowerCase() === specialty.toLowerCase()
    ) ?? physicians[0];
  const receptionist = (i: number) =>
    reception.length > 0 ? reception[i % reception.length] : null;

  const now = Date.now();
  let historyCount = 0;

  // --- 1) today's board -----------------------------------------------------
  let todayCount = 0;
  for (const d of TODAY_DEMO) {
    const floor = floorFromRoom(d.room) ?? 1;
    const physician = physicianOf(d.doctor);
    const nurse = nurseOnFloor(floor);
    const financier = finance[todayCount % finance.length];
    const receptionUser = receptionist(todayCount);

    // Keep discharged patients inside the current calendar day: if the
    // backdated departure lands before midnight, shift the whole chain so
    // the "Discharged today" KPI stays populated at any load time.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const dayFloor = startOfToday.getTime() + 5 * MIN;
    const dischargeStep = d.steps.find((s) => s.field === "physicalDischarged");
    const shift =
      dischargeStep && now - dischargeStep.agoMin * MIN < dayFloor
        ? dayFloor - (now - dischargeStep.agoMin * MIN)
        : 0;

    const stepTimes = d.steps.map((s) => ({
      ...s,
      at: new Date(now - s.agoMin * MIN + shift),
    }));
    const decisionAt = d.decision ? new Date(now - d.decision.agoSec * 1000) : null;
    const importedAt = new Date(
      now - Math.max(20, (stepTimes[0]?.agoMin ?? 0) + 35 + (todayCount % 5) * 12) * MIN + shift
    );

    const patient = await db.patient.create({
      data: {
        mrn: d.mrn,
        name: d.name,
        room: d.room,
        floor,
        doctorName: physician.name,
        doctorSpecialty: physician.specialty ?? d.doctor,
        isDemo: true,
        importedAt,
        medicalDecision: d.decision?.choice ?? null,
        medicalDecisionAt: decisionAt,
        medicalDecisionById: d.decision ? physician.id : null,
        medicalReadyAt: stepTimes.find((s) => s.field === "medicalReady")?.at ?? null,
        medicalReadyById: stepTimes.find((s) => s.field === "medicalReady") ? physician.id : null,
        templateCopiedAt: stepTimes.find((s) => s.field === "templateCopied")?.at ?? null,
        templateCopiedById: stepTimes.find((s) => s.field === "templateCopied") ? nurse.id : null,
        financeNotifiedAt: stepTimes.find((s) => s.field === "financeNotified")?.at ?? null,
        financeNotifiedById: stepTimes.find((s) => s.field === "financeNotified") ? nurse.id : null,
        financeClearedAt: stepTimes.find((s) => s.field === "financeCleared")?.at ?? null,
        financeClearedById: stepTimes.find((s) => s.field === "financeCleared") ? financier.id : null,
        receptionReadyAt: stepTimes.find((s) => s.field === "receptionReady")?.at ?? null,
        receptionReadyById:
          stepTimes.find((s) => s.field === "receptionReady") && receptionUser
            ? receptionUser.id
            : null,
        physicalDischargedAt: stepTimes.find((s) => s.field === "physicalDischarged")?.at ?? null,
        physicalDischargedById: stepTimes.find((s) => s.field === "physicalDischarged")
          ? nurse.id
          : null,
      },
    });

    await db.action.createMany({
      data: [
        {
          patientId: patient.id,
          userId: nurse.id,
          type: "IMPORTED",
          note: "Demo data",
          createdAt: importedAt,
        },
        ...(d.decision
          ? [
              {
                patientId: patient.id,
                userId: physician.id,
                type:
                  d.decision.choice === "DISCHARGE"
                    ? "MEDICAL_DECIDED_DISCHARGE"
                    : "MEDICAL_DECIDED_NO",
                note: null as string | null,
                createdAt: decisionAt as Date,
              },
            ]
          : []),
        ...stepTimes.map((s) => ({
          patientId: patient.id,
          userId:
            s.by === "physician"
              ? physician.id
              : s.by === "finance"
                ? financier.id
                : s.by === "reception"
                  ? (receptionUser?.id ?? nurse.id)
                  : nurse.id,
          type: s.type,
          note: null as string | null,
          createdAt: s.at,
        })),
      ],
    });
    todayCount++;
  }

  // --- 2) 30-day discharged history (batched inserts) ------------------------
  interface HistoryRow {
    mrn: string;
    name: string;
    room: string;
    floor: number;
    doctorName: string;
    doctorSpecialty: string;
    isDemo: boolean;
    importedAt: Date;
    medicalReadyAt: Date | null;
    medicalReadyById: string | null;
    templateCopiedAt: Date | null;
    templateCopiedById: string | null;
    financeNotifiedAt: Date | null;
    financeNotifiedById: string | null;
    financeClearedAt: Date | null;
    financeClearedById: string | null;
    receptionReadyAt: Date | null;
    receptionReadyById: string | null;
    physicalDischargedAt: Date | null;
    physicalDischargedById: string | null;
  }
  const historyRows: HistoryRow[] = [];
  interface HistoryAction {
    patientId: string;
    userId: string;
    type: string;
    note: string | null;
    createdAt: Date;
  }
  // Actions are created AFTER patient ids exist (joined below by MRN).
  const pendingActions = new Map<string, HistoryAction[]>();
  const ownersByMrn = new Map<
    string,
    { physicianId: string; nurseId: string; financeId: string; receptionId: string | null }
  >();

  const rand = mulberry32(20260918);

  for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
    const dayStart = new Date(now - daysAgo * DAY);
    dayStart.setHours(0, 0, 0, 0);
    const weekend = [5, 6].includes(dayStart.getDay()); // Fri/Sat in Egypt
    const cases = weekend ? 3 + Math.floor(rand() * 3) : 5 + Math.floor(rand() * 5);

    for (let i = 0; i < cases; i++) {
      const specialty = SPECIALTY_LIST[(daysAgo * 7 + i) % SPECIALTY_LIST.length];
      const bias = SPECIALTY_DELAY_BIAS[specialty] ?? [1, 1, 1, 1];
      const floor = 1 + ((daysAgo + i) % 4);
      const room = `${floor}${String(10 + ((i * 7 + daysAgo) % 40)).padStart(2, "0")}`;
      const mrn = `9105${String(daysAgo).padStart(2, "0")}${String(i).padStart(2, "0")}`;
      const name = `${FIRST_NAMES[(daysAgo * 5 + i * 3) % FIRST_NAMES.length]} ${
        LAST_NAMES[(daysAgo * 3 + i * 11) % LAST_NAMES.length]
      }`;

      const physician = physicianOf(specialty);
      const nurse = nurseOnFloor(floor);
      const financier = finance[(daysAgo + i) % finance.length];
      const receptionUser = receptionist(daysAgo * 5 + i);
      ownersByMrn.set(mrn, {
        physicianId: physician.id,
        nurseId: nurse.id,
        financeId: financier.id,
        receptionId: receptionUser?.id ?? null,
      });

      // Import between 07:30 and 10:30.
      const importedAt = new Date(dayStart.getTime() + (7.5 + rand() * 3) * 60 * MIN);

      // Stage TATs — target-aware sampling with specialty bias. The former
      // combined stage-4 window is split: t4a reception papers (target 60),
      // t4b departure after papers confirmed (target 30).
      const delayed1 = rand() < 0.16 * bias[0];
      const t1 = delayed1 ? 250 + rand() * 260 : 35 + rand() * 190; // target 240
      const delayed2 = rand() < 0.18 * bias[1];
      const t2 = delayed2 ? 32 + rand() * 40 : 6 + rand() * 22; // target 30
      const delayed3 = rand() < 0.22 * bias[2];
      const t3 = delayed3 ? 125 + rand() * 180 : 25 + rand() * 90; // target 120
      const delayed4a = rand() < 0.15 * bias[3];
      const t4a = delayed4a ? 65 + rand() * 90 : 8 + rand() * 48; // target 60
      const delayed4b = rand() < 0.18 * bias[3];
      const t4b = delayed4b ? 35 + rand() * 70 : 4 + rand() * 26; // target 30

      const medicalReadyAt = new Date(importedAt.getTime() + t1 * MIN);
      const templateCopiedAt = new Date(medicalReadyAt.getTime() + (t2 * 0.7) * MIN);
      const financeNotifiedAt = new Date(medicalReadyAt.getTime() + t2 * MIN);
      const financeClearedAt = new Date(financeNotifiedAt.getTime() + t3 * MIN);
      const receptionReadyAt = new Date(financeClearedAt.getTime() + t4a * MIN);
      const physicalDischargedAt = new Date(receptionReadyAt.getTime() + t4b * MIN);

      historyRows.push({
        mrn,
        name,
        room,
        floor,
        doctorName: physician.name,
        doctorSpecialty: physician.specialty ?? specialty,
        isDemo: true,
        importedAt,
        medicalReadyAt,
        medicalReadyById: physician.id,
        templateCopiedAt,
        templateCopiedById: nurse.id,
        financeNotifiedAt,
        financeNotifiedById: nurse.id,
        financeClearedAt,
        financeClearedById: financier.id,
        receptionReadyAt,
        receptionReadyById: receptionUser?.id ?? nurse.id,
        physicalDischargedAt,
        physicalDischargedById: nurse.id,
      });

      pendingActions.set(mrn, [
        {
          patientId: "",
          userId: nurse.id,
          type: "IMPORTED",
          note: "Demo data (history)",
          createdAt: importedAt,
        },
        { patientId: "", userId: physician.id, type: "MEDICAL_READY", note: null, createdAt: medicalReadyAt },
        { patientId: "", userId: nurse.id, type: "COPY_TEMPLATE", note: null, createdAt: templateCopiedAt },
        { patientId: "", userId: nurse.id, type: "FINANCE_NOTIFIED", note: null, createdAt: financeNotifiedAt },
        { patientId: "", userId: financier.id, type: "FINANCE_CLEARED", note: null, createdAt: financeClearedAt },
        {
          patientId: "",
          userId: receptionUser?.id ?? nurse.id,
          type: "RECEPTION_READY",
          note: null,
          createdAt: receptionReadyAt,
        },
        {
          patientId: "",
          userId: nurse.id,
          type: "PHYSICAL_DISCHARGED",
          note: null,
          createdAt: physicalDischargedAt,
        },
      ]);
      historyCount++;
    }
  }

  if (historyRows.length > 0) {
    await db.patient.createMany({ data: historyRows });
    const created = await db.patient.findMany({
      where: { mrn: { in: historyRows.map((r) => r.mrn) } },
      select: { id: true, mrn: true },
    });
    const idByMrn = new Map(created.map((c) => [c.mrn, c.id]));
    const actionRows: HistoryAction[] = [];
    for (const [mrn, acts] of pendingActions) {
      const id = idByMrn.get(mrn);
      if (!id) continue;
      for (const a of acts) actionRows.push({ ...a, patientId: id });
    }
    // createMany in chunks to stay well within SQLite variable limits.
    for (let i = 0; i < actionRows.length; i += 500) {
      await db.action.createMany({ data: actionRows.slice(i, i + 500) });
    }
  }

  return { today: todayCount, history: historyCount };
}
