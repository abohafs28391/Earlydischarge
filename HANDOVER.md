# DischargeFlow — Developer Handover

> Hospital discharge-pipeline monitoring board (Next.js + Prisma + SQLite).
> This document gives a new coder everything needed to run, understand, and extend the project.
> Generated 2026-09-18, after "update 0.3" (Task 9) was completed and verified.

---

## 1. Project snapshot

**What it is.** A live kanban board that tracks every inpatient from *medical clearance* to *physical departure*, surfaces where and why discharge is delayed (against literature-calibrated time targets), escalates stalled patients to the right role, and pushes PHI-lite alarm notifications to a Discord (or Slack/Teams/generic) webhook.

**Status: all 9 milestones shipped and verified.** `tsc --noEmit` clean, `eslint .` clean, regression suite 137/137 API assertions passing, webhook suites 23/23 and 27/27, full browser E2E walks (screenshots in `scripts/*.png`).

**Working mode today: demo/simulation.** There is no real HIS/EMR integration. The board runs on a deterministic 30-day simulated dataset (benchmark-calibrated delay reasons) plus optional CSV import. The Prisma schema is production-shaped so real data can replace simulation later without a rewrite.

---

## 2. Quick start

```bash
# runtime: bun (preferred) or npm/node 20+
bun install

# 1) Fix the DB path — .env currently points at the original machine:
#    DATABASE_URL=file:/home/z/my-project/db/custom.db
#    change to the ABSOLUTE path where you unzip, e.g.:
#    DATABASE_URL=file:/Users/you/dischargeflow/db/custom.db
#    (the zip ships db/custom.db with demo data already inside — 552 KB SQLite file)

# 2) Generate the Prisma client
bunx prisma generate

# 3) Run
bun run dev        # http://localhost:3000
```

- First API call lazily seeds **users + 10 default alarm rules** (`ensureUsersSeeded` / `ensureAlarmRulesSeeded` in `src/lib/seed.ts`, invoked from the patients/alarm-rules/notifications routes).
- Demo patients: log in as **Engy Rostom (admin)** → *Admin → Data & audit → "Load demo dataset"*. That wipes demo rows and regenerates 22 patients for today + ~183 discharged history rows.
- If you'd rather start from an empty DB: delete `db/custom.db`, then `bunx prisma db push --accept-data-loss` and restart the dev server.

**Build for production:** `bun run build` (standalone output) then `bun run start`.

**One .env variable only:** `DATABASE_URL`. Everything else (webhook URL, decision-window seconds) lives in the `Setting` table and is edited from the Admin UI.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix primitives) |
| Data | Prisma 6 + SQLite (`db/custom.db`) |
| Runtime / pkg mgr | bun (`bun.lock` committed) |
| Charts | Recharts (analysis view) |
| Icons | lucide-react |
| Tests | Python (`requests`) API regression + TS webhook suite + agent-browser E2E |

No auth library is used — see §8.7 (simulated auth). `next-auth`, `next-intl`, `z-ai-web-dev-sdk` etc. are template dependencies; this app does not rely on them.

---

## 4. Domain model — the pipeline

### 4.1 Stages (`src/lib/workflow.ts`, `STAGES`)

| # | Stage (board column) | Owner | Target (AlarmRule) |
|---|---|---|---|
| 1 | **Medical Clearance** | physician of the patient's assigned specialty | 10:00 warn / 11:00 breach (time-of-day rules) |
| 2 | **Notify** (discharge order placed) | floor nurse | 60 m |
| 3 | **Financial Clearance** | finance | 2 h warn / 4 h breach (DRAFT) |
| 4 | **Reception** (papers confirmed) | reception personnel | 60 m |
| 5 | **Physical Discharge** | floor nurse | 30 m |
| 6 | **Discharged** | — (not a column; header dialog) | no alarms |

Stage targets 4/5 are a documented split of the original combined 90-minute post-finance target; financial thresholds are marked DRAFT pending a real TAT benchmark.

### 4.2 Roles (`Role` union in `workflow.ts`, `User.role` string in schema)

| Role | Sees | Can |
|---|---|---|
| `NURSE` | patients on **any of their assigned floors** (`User.floors`, JSON int array like `"[1,2]"`) | place discharge order (stage 1→2), mark finance-notified, confirm departure (stage 5→6, papers required), cancel a discharge (stage 2→1) |
| `PHYSICIAN` | **only patients whose assigned doctor's specialty matches their own** (`User.specialty`) | decide Discharge / No discharge at stage 1 (with undo window) |
| `FINANCE` | all patients | clear financially (stage 3→4) |
| `RECEPTION` | stage ≥ 4 (incl. discharged list) | confirm discharge papers ready (stage 4→5) |
| `UNIVERSAL` (subcategories MANAGER / QUALITY) | everything, read-only + acknowledge alarms | ack alarms |
| `ADMIN` | everything | users, alarm rules, thresholds, webhook, decision window, demo/import, audit, export |

**Dual-listing rule:** a stage-4 patient (financially cleared, awaiting reception papers) appears in **both** the *Reception* column and the *Physical Discharge* column (with an "Awaiting reception papers" note) — per spec, "marked financial discharge → shows in reception and physical discharge columns".

**Server-side vs view-side scoping:** permissions (what you can *do*) follow the nurse's full assigned floor set; the **working-floor picker** (top of page, localStorage-persisted per user) only scopes what the board *shows*.

---

## 5. Prisma schema (summary — `prisma/schema.prisma`)

- **User** — `id, name, role, specialty?, floors? (JSON int array), subcategory? (for UNIVERSAL)`
- **Patient** — identity + `room, floor, assignedDoctor, assignedDoctorSpecialty`, `stage` (1–6) with per-stage timestamps (`medicalReadyAt, dischargeOrderedAt, financeClearedAt, receptionReadyAt, departedAt`, …), delay-reason fields per stage, `isDemo` flag, and the decision trio `medicalDecision ("DISCHARGE"|"NO_DISCHARGE"|null) / medicalDecisionAt / medicalDecisionById`
- **Action** — append-only audit log: `type` (see §8.2), `actorId`, `patientId`, `createdAt`, note. Every workflow mutation writes one.
- **Notification** — per-user in-app alarm notifications (the bell), with ack flags.
- **AlarmRule** — stage, kind (elapsed / time-of-day), warn/breach minutes or clock times, enabled, DRAFT flag.
- **WebhookDelivery** — outbound webhook log: payload, status, response body (for debugging receiver 400s).
- **Setting** — key/value store: `webhook.url`, `decision.window.sec`.

---

## 6. Feature inventory (what shipped, milestone by milestone)

1. **Task 1 — Live monitoring dashboard**: 6-stage board (now 5 columns + discharged dialog), rules engine, benchmark research (see `research/*.json`), KPI bar, simulation.
2. **Task 2 — Board interactions**: stage actions with permission checks, patient drawer with audit history, notifications bell.
3. **Task 3 — Roles & admin gating**: user switcher (all roles), admin panel (users CRUD, alarm rules CRUD, thresholds, audit, export CSV), server-side gating of every route.
4. **Task 4 — CSV import**: template dialog (downloadable templates), import validation, real vs demo rows.
5. **Task 5 — Escalation & ownership**: tiered ownership model, ack/escalation flows, alarm notifications per user.
6. **Task 6 — External webhook delivery**: global webhook (Discord/Slack/Teams auto-format detection), delivery log, test ping.
7. **Task 7 — Hardcoded test webhook**: the user's real Discord webhook is compiled in as the default (`TEST_WEBHOOK_URL` in `src/lib/alarms.ts`, flagged `TODO(remove-before-production)`); an admin-saved `webhook.url` Setting always overrides it; UI shows an amber "Hardcoded testing default in effect" note.
8. **Task 8 — Workflow rework**: physician specialty scoping; nurses on multiple floors with working-floor picker; new **Reception** stage + RECEPTION role with dual-listing; Discharged column → header button + dialog (searchable, visibility-scoped, click-through to drawer); stage targets split; export/analysis/spec-sheet updated.
9. **Task 9 — "Update 0.3"**: stage-1 physician **Discharge / No-discharge decision with a confirmation window (default 60 s, admin-tunable 1–600 s)** — undo/change inside the window, auto-promotion at expiry; stage-2 cards got **"Send cancel mail"** (copies cancellation e-mail template to clipboard, logs `COPY_CANCEL_TEMPLATE`) and **"Cancel"** (typed confirmation — must type `cancel` — resets the patient to stage 1 and notifies the specialty physician).

---

## 7. Code map

```
src/
  app/
    page.tsx                 — the single board page: header (user switcher, working-floor
                               picker, Discharged dialog button), KPI bar, board, drawer,
                               admin panel mount, board polling + expiry refresh
    api/
      patients/              — GET board/active (default) + ?scope=discharged (newest-first);
                               POST create; patients/demo POST (admin, reload demo);
                               patients/[id] PATCH (data edit) — board views are read-only
      actions/               — POST: the single workflow mutation endpoint (all 15 action
                               types, validateAction first; promotes due decisions BEFORE
                               validation so a late undo is correctly rejected)
      users/                 — GET list; POST create; PATCH update (floors[], role, name…)
      alarm-rules/           — GET (rules + globalWebhookUrl + isTestDefault flag);
                               POST enable/disable/threshold updates (admin)
      settings/              — GET decision-window; POST setDecisionWindowSec (admin, 1–600)
      notifications/         — GET (bell poll → runs evaluateAlarms); POST ack
      analysis/              — GET analytics (stage windows t1..t5, bottleneck causes, KPIs)
      audit/                 — GET hospital-wide audit trail (admin)
      export/                — GET CSV export (incl. reception paper fields)
      webhook/ (in alarms lib test action) — admin "send test ping"
  lib/
    workflow.ts              — THE domain core: Role, STAGES, stageOf/stageEntryAt,
                               isVisibleTo (role scoping), permissionsFor, validateAction,
                               buildCancelEmail (cancellation template), HANDOFF_AFTER map,
                               ActionType list + labels
    decision-window.ts       — Setting get/set for window seconds;
                               promoteDueMedicalDecisions(): lazy, guarded updateMany that
                               stamps medicalReadyAt = decisionAt + window, logs the
                               auto-confirmed MEDICAL_READY action, fires stage-2 handoff
    alarms.ts                — evaluateAlarms (rules engine → Notification + webhook),
                               taskOwnersForStage (who gets notified per stage/role/floors),
                               notifyHandoff (with optional variant for cancel-return),
                               webhook-channels.ts integration,
                               TEST_WEBHOOK_URL + getGlobalWebhookState() (Task 7)
    webhook-channels.ts      — Discord/Slack/Teams/generic payload formatting + delivery log
    board-data.ts            — loadBoard(): promotes due decisions, then returns board views,
                               stats {dischargedTotal, dischargedToday, beforeNoon, 7d median},
                               decisionWindowSec (single source for all client countdowns)
    seed.ts                  — users + 10 default alarm rules (lazy ensure* functions)
    demo.ts                  — deterministic 22-today + 183-history patient generator,
                               literature-weighted delay reasons, decision states showcase
    api-auth.ts              — requireUser / requireAdmin guards (simulated auth, §8.7)
    serialize.ts / csv.ts    — Patient JSON shaping; CSV import/export
    analysis.ts              — analytics aggregation
    clipboard.ts             — shared copyToClipboard
  components/
    board/workflow-board.tsx — the 5 columns, stage-1 decision grid + countdown + undo,
                               stage-2 cancel block + CancelConfirmDialog, dual-listing
    board/discharged-dialog  — header dialog listing departed patients (search, scoped)
    board/patient-drawer.tsx — per-patient sheet: data, timeline stepper (6 steps),
                               audit history with action icons
    board/user-switcher.tsx  — pick acting user (grouped by role, floors/specialty labels)
    board/kpi-bar.tsx        — discharged today, before-noon %, 7-day median, DBN rate
    board/spec-sheet.tsx     — "how this board works" spec overlay per role
    board/template-dialog / import-dialog — CSV templates + import
    admin/                   — admin-panel + sections: users (floors multi-select chips),
                               alarms (rules + webhook + test ping + hardcoded-default note),
                               workflow (decision-window seconds control), data (demo/import/
                               audit/export)
    analysis/analysis-view.tsx — Recharts bottleneck analytics
    shared/notification-bell.tsx — bell poll + ack
scripts/                     — regression tests + E2E screenshots (see §10)
research/                    — Task-1 benchmark sources (JSON) backing the thresholds
worklog.md                   — full 9-task development log (decisions, verification runs)
```

---

## 8. Key mechanisms a new coder must understand

### 8.1 One mutation endpoint
Everything that changes a patient flows through `POST /api/actions` → `validateAction()` in `workflow.ts` (role, stage, ownership: specialty for physicians, floors for nurses, papers-required for discharge). Don't add ad-hoc mutation routes.

### 8.2 Action types (audit log vocabulary)
`MEDICAL_DECIDED_DISCHARGE, MEDICAL_DECIDED_NO, MEDICAL_UNDO, MEDICAL_READY` (internal-only now — auto-confirmation at window expiry; direct API calls are rejected 400), `DISCHARGE_ORDERED, FINANCE_NOTIFIED, FINANCE_CLEARED, RECEPTION_READY, PHYSICAL_DISCHARGE, COPY_CANCEL_TEMPLATE, CANCEL_DISCHARGE, ALARM_ACK, …` (see `ActionType` in `workflow.ts`).

### 8.3 Decision window (Task 9)
- Physician clicks Discharge/No discharge → `medicalDecision` + timestamp stamped; **patient stays in column 1** with a live countdown ("moves on in Ns").
- Inside the window the deciding physician sees Undo / change buttons (`MEDICAL_UNDO` re-validates the window — after expiry it's 403).
- Promotion is **lazy**: `promoteDueMedicalDecisions()` runs on board load and before every action POST; the client also triggers a board refresh at expiry time so the card moves immediately instead of waiting for the next 10 s poll.
- Window length = `Setting "decision.window.sec"` (default 60, clamped 1–600), editable in Admin → Workflow. No scheduler/cron exists by design.

### 8.4 Cancel flow (Task 9)
Stage-2 card → "Send cancel mail" copies `buildCancelEmail()` to clipboard and logs `COPY_CANCEL_TEMPLATE`; "Cancel" opens a dialog where the button unlocks only when the input equals `cancel` (case-insensitive) → `CANCEL_DISCHARGE` resets all stage-1/2 artifacts (decision trio, medicalReady, template copy, financeNotified), writes an audit action, and notifies the specialty physician ("Discharge cancelled — patient back to Medical Clearance").

### 8.5 Visibility scoping
`isVisibleTo(patient, user)` in `workflow.ts` is the single source: nurse → floors array intersection; physician → same specialty only; reception → stage ≥ 4; finance/universal/admin → all. Reused by board views, discharged dialog, and drawer.

### 8.6 Alarms + webhook
`evaluateAlarms()` runs during the bell poll (`GET /api/notifications`): elapsed + time-of-day rules → per-role `Notification`s (bell) + one consolidated PHI-lite webhook message (patient identifiers stripped for external IM channels; generic/self-hosted receivers get full JSON). `webhook-channels.ts` auto-formats Discord/Slack/Teams payloads. Deliveries (incl. receiver error bodies) are logged in `WebhookDelivery` and visible in Admin → Alarms.

**⚠️ Hardcoded test webhook (Task 7):** `TEST_WEBHOOK_URL` in `src/lib/alarms.ts` contains a real Discord webhook and is the effective default unless an admin saves one (`Setting webhook.url` overrides; clearing it restores the default). Amber note in the UI flags this. **Before production: delete `TEST_WEBHOOK_URL` and the fallback line in `getGlobalWebhookState()` (both marked `TODO(remove-before-production)`)** — app then reverts to no-webhook-until-configured.

### 8.7 Simulated auth
No login. The acting user is chosen with the **user switcher** and passed as `x-user-id` header (see API calls in `page.tsx` / components). `requireUser` / `requireAdmin` in `api-auth.ts` enforce it server-side. Real auth (e.g. next-auth) would replace exactly this layer.

### 8.8 Demo data discipline
Demo rows are flagged `isDemo` and regenerated on demand; imported real rows are never touched by demo controls. The 30-day history is what keeps the analysis view and KPI medians populated at any load time.

---

## 9. Demo users cheat sheet (seeded automatically)

| User | Role | Use them to see… |
|---|---|---|
| Engy Rostom | ADMIN | admin panel: users + floors multi-select, alarm rules, webhook (prefilled Discord default), Workflow tab (decision window), demo load, audit, export |
| Dr. Ahmed Samy | PHYSICIAN · Internal Medicine | **only IM patients** in column 1; Discharge/No-discharge buttons, 60 s countdown, Undo, "Change decision"; "Physician decision: No discharge" badge (see Hoda Kamel card) |
| Mariam Sabry | NURSE · floors [1,2] | working-floor picker in the header — switching floor rescopes the board |
| Nour El-Din | NURSE · floor 2 | stage-2 cards: Send cancel mail + Cancel (type "cancel") |
| Hana Fathi | NURSE · floor 3 | stage-5 discharge button (Wahid/Tharwat cards) |
| Maya Aslam | FINANCE | stage-3 Financial Clearance action |
| Sara El-Masry | RECEPTION | columns 1–3 hidden with a hint; stage-4 "Confirm papers done" buttons |
| Nada Guirguis | UNIVERSAL · QUALITY | whole board read-only + alarm ack |

Demo patients worth knowing: **Rania Zaki** (pending DISCHARGE decision, live countdown), **Hoda Kamel** (standing NO_DISCHARGE), **Wahid / Mervat** (stage-4 dual-listed in Reception + Physical Discharge), **Tharwat Amin** (stage 5, ready to discharge).

---

## 10. Testing & verification

| Suite | File | What it covers | Last state |
|---|---|---|---|
| API regression (the big one) | `scripts/test_task3_api.py` | 137 assertions: board scoping per role, all action permissions (incl. wrong-specialty/off-floor/late-undo 403s), decision flow decide→undo→change→auto-promote, cancel flow + stage-1 reset, reception chain, users/floors CRUD + validation, alarm rules CRUD + stage validation, settings window CRUD, demo 403 gating, discharged endpoint | **137/137 PASS** |
| Discord/webhook guard | `scripts/test_webhook_discord.py` | 23 assertions; points the global webhook at a local mock for the whole run so regression never posts to the live Discord channel, clears it after | **23/23 PASS** |
| Channel formatting | `scripts/webhook_channels_check.ts` | 27 assertions on Discord/Slack/Teams payload shaping | **27/27 PASS** |
| E2E (manual/agent-browser) | `scripts/e2e_update03.sh`, screenshots `scripts/e2e03_*.png`, `scripts/task7_alarms_ui.png`, `scripts/task8_board_ui.png` | full UI walkthroughs: decision window, cancel dialog lock/unlock, reception chain, multi-floor, specialty scoping, admin tabs | all pass, zero console errors |

Run the API regression against a running dev server (`bun run dev` in another terminal):

```bash
python3 scripts/test_task3_api.py        # needs requests: pip install requests
bunx tsx  scripts/webhook_channels_check.ts
python3 scripts/test_webhook_discord.py  # spins its own mock; safe vs live Discord
```

`scripts/test_workflow_api.py` is a stale Task-2-era suite kept only for reference — **do not use it as regression** (it predates admin gating). `scripts/run_update03_tests.sh` / `run_webhook_tests.sh` are single-invocation runners used in the sandbox.

House style before handing work back: `bunx tsc --noEmit` (zero src errors) and `bun run lint` (clean).

---

## 11. Known caveats / pre-production TODO list

1. **Remove the hardcoded Discord webhook** — `TEST_WEBHOOK_URL` + fallback in `getGlobalWebhookState()` (`src/lib/alarms.ts`), both flagged `TODO(remove-before-production)`. Regression checks that assert the default exist in `test_task3_api.py` (they carry revert instructions in comments).
2. **No real authentication** — replace the `x-user-id` simulated layer (§8.7) before exposing the app.
3. **Financial thresholds are DRAFT** (2 h/4 h) — no published financial-clearance TAT benchmark existed; recalibrate from your hospital's own data.
4. **No real e-mail sending** — "Send cancel mail" copies the template to the clipboard (per spec). Wire an SMTP/provider send if actual mail is wanted; the template builder (`buildCancelEmail`) and audit action already exist.
5. **Decision promotion is lazy** (board load + action POST + client expiry refresh). If boards can stay open and unattended for very long, consider a cron/scheduler calling `promoteDueMedicalDecisions()`.
6. **SQLite** is single-writer — fine for a ward-scale demo; move `DATABASE_URL` to Postgres (schema is compatible) for multi-user production.
7. **Simulation data** — replace demo/CSV with HIS feed; `serialize.ts`/`csv.ts` show the expected patient shape.

---

## 12. "I need to change X — where do I edit?" recipes

| Want to… | Touch |
|---|---|
| add/rename a pipeline stage | `STAGES` + `stageOf` + `HANDOFF_AFTER` in `workflow.ts`; stage timestamps on `Patient` (schema.prisma); columns render from `STAGES` so the board follows |
| change who may do an action | `permissionsFor` + `validateAction` in `workflow.ts` |
| change default alarm rules | `DEFAULT_RULES`-shaped seeding in `seed.ts` (and Admin → Alarms at runtime) |
| change the decision window default/range | `DEFAULT_DECISION_WINDOW_SEC` + clamp in `decision-window.ts` |
| change the cancellation e-mail text | `buildCancelEmail` in `workflow.ts` |
| tweak webhook payload/privacy | `webhook-channels.ts` (PHI stripping happens in `alarms.ts`) |
| adjust who gets notified per stage | `taskOwnersForStage` + `HANDOFF_TEXT` in `alarms.ts` |
| add an admin setting | copy the `settings/route.ts` + Admin Workflow-tab pattern (Setting key + validation) |
| modify board card actions | `workflow-board.tsx` (stage-1 block and stage-2 block are clearly separated) |

---

## 13. Task history (condensed from `worklog.md` — full detail lives there)

| # | Task | Outcome |
|---|---|---|
| 1 | Early-discharge pipeline analysis + live dashboard | benchmark research (DBN 15–20% vs 30% target etc.), rules engine, sim, KPIs |
| 2 | Board interactions + drawer + bell | actions, audit, notifications |
| 3 | Roles, admin gating, admin panel | user switcher, users/rules/thresholds/audit/export, all routes gated |
| 4 | CSV import + templates | import-dialog, validation, real-vs-demo separation |
| 5 | Escalation & ownership | tiered ownership, ack flow |
| 6 | External webhook delivery | channels formatting, delivery log, test ping |
| 7 | Hardcoded test Discord webhook | `TEST_WEBHOOK_URL` default + override + UI amber note |
| 8 | Kanban/role rework (0.2 spec) | specialty scoping, multi-floor nurses, Reception stage + role, dual-listing, Discharged dialog, 5-stage targets |
| 9 | Update 0.3 | physician decision + 60 s undo window, cancel-mail + typed-confirmation cancel |

---

## 14. What's inside the zip

```
dischargeflow/            ← zip root
  HANDOVER.md             ← this file
  worklog.md              ← full 9-task dev log (read after this)
  package.json / bun.lock / configs (next, ts, tailwind, eslint, postcss, components)
  .env                    ← DATABASE_URL — ADJUST THE ABSOLUTE PATH (see §2)
  prisma/schema.prisma
  db/custom.db            ← SQLite with users/rules/demo data preloaded
  src/                    ← application code (see §7)
  scripts/                ← regression suites + E2E screenshots
  research/               ← benchmark JSONs behind the thresholds
  public/                 ← logo, robots
  .git/                   ← 11-commit history (kept for reference)
```

Excluded (regenerate/ignore): `node_modules` (`bun install`), `.next` (`bun run build`), `dev.log`, sandbox-only dirs (`skills/`, `tool-results/`, `mini-services/`, `tests/`, `Caddyfile`, `examples/`, `upload/`, `download/`).

---

*House rules honored throughout this codebase: surgical edits (minimal diff, keep existing caller signatures — e.g. thin-wrapper patterns like `getGlobalWebhookUrl()`), every mutation audited, every permission checked server-side, and every threshold traceable to a source or marked DRAFT.*
