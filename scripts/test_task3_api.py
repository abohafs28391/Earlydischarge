#!/usr/bin/env python3
"""E2E API test for Task 3: user categories (universal/admin), privileges,
demo views, alarm rules + webhook notifications, notifications, analysis."""
import json
import time
import urllib.request

BASE = "http://localhost:3000"
passed, failed = 0, 0


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=60) as res:
            raw = res.read().decode()
            try:
                return res.status, json.loads(raw)
            except json.JSONDecodeError:
                return res.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name} {extra}")


def main():
    # ---------------------------------------------------------------- users
    print("\n== User categories ==")
    st, data = call("GET", "/api/users")
    users = data.get("users", [])
    roles = {u["role"] for u in users}
    check("users list 200", st == 200, st)
    check("ADMIN users exist", "ADMIN" in roles)
    check("UNIVERSAL users exist", "UNIVERSAL" in roles)
    check("NURSE/PHYSICIAN/FINANCE still exist", {"NURSE", "PHYSICIAN", "FINANCE"} <= roles)
    universal = [u for u in users if u["role"] == "UNIVERSAL"]
    check("universal subcategories MANAGER/QUALITY",
          {u["subcategory"] for u in universal} >= {"MANAGER", "QUALITY"})
    check("privilege fields present", all("canEdit" in u and "canView" in u for u in users))
    admin = next(u for u in users if u["role"] == "ADMIN")
    nurse2 = next(u for u in users if u["role"] == "NURSE" and u["floors"] == [2])
    nurse_multi = next(u for u in users if u["role"] == "NURSE" and len(u["floors"]) > 1)
    physician_im = next(u for u in users if u["role"] == "PHYSICIAN" and u["specialty"] == "Internal Medicine")
    finance = next(u for u in users if u["role"] == "FINANCE")
    reception = next(u for u in users if u["role"] == "RECEPTION")
    quality = next(u for u in users if u["role"] == "UNIVERSAL" and u["subcategory"] == "QUALITY")

    check("reception users seeded", reception is not None)
    check("multi-floor nurse seeded", nurse_multi is not None and len(nurse_multi["floors"]) >= 2)

    # ------------------------------------------------------- demo dataset
    print("\n== Demo dataset (admin-gated) ==")
    # reset the decision window so this suite is deterministic regardless of
    # leftovers from an interrupted earlier run
    st, data = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 60})
    check("decision window reset to 60", st == 200 and data.get("decisionWindowSec") == 60, st)
    st, data = call("POST", f"/api/patients/demo?userId={nurse2['id']}")
    check("non-admin demo load 403", st == 403, st)
    st, data = call("POST", f"/api/patients/demo?userId={admin['id']}")
    created = data.get("created", {})
    check("admin demo load 200", st == 200, st)
    check("today's board seeded (22)", created.get("today") == 22, created)
    check("30-day history seeded (>150)", (created.get("history") or 0) > 150, created)

    st, data = call("GET", "/api/patients")
    board = data.get("patients", [])
    check("board scoped to active patients only (19)", len(board) == 19, len(board))
    check("board stats present",
          data.get("stats", {}).get("dischargedTotal", 0) >= 180 and
          data.get("stats", {}).get("dischargedToday") == 3, data.get("stats"))
    check("board payload carries the decision window",
          data.get("decisionWindowSec") == 60, data.get("decisionWindowSec"))
    # two stage-1 demo patients carry physician decisions (update 0.3)
    demo_decided = [p for p in board if p.get("medicalDecision")]
    check("demo patient with pending discharge decision",
          any(p["medicalDecision"] == "DISCHARGE" for p in demo_decided),
          [p.get("mrn") for p in demo_decided])
    check("demo patient with no-discharge decision",
          any(p["medicalDecision"] == "NO_DISCHARGE" for p in demo_decided),
          [p.get("mrn") for p in demo_decided])

    # discharged listing endpoint (header Discharged button)
    st, data = call("GET", "/api/patients?scope=discharged")
    discharged = data.get("patients", [])
    check("discharged listing 200 + all departed", st == 200 and len(discharged) >= 180, st)
    check("discharged listed newest-first",
          all((discharged[i]["physicalDischargedAt"] or "") >= (discharged[i + 1]["physicalDischargedAt"] or "")
              for i in range(len(discharged) - 1)))
    check("discharged payload carries audit actions", len(data.get("actions", [])) > 0)

    # ---------------------------------------------------------- analysis
    print("\n== Analysis tab ==")
    now = time.time()
    frm = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - 31 * 86400))
    to = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now))
    st, data = call("GET", f"/api/analysis?from={frm}&to={to}&userId={admin['id']}")
    check("analysis 200", st == 200, st)
    check("cohort > 150", data.get("cohortSize", 0) > 150, data.get("cohortSize"))
    check("5 stages reported", len(data.get("stages", [])) == 5)
    check("8 specialties reported", len(data.get("specialties", [])) == 8)
    s1 = data["stages"][0]
    check("stage stats sane", s1["entered"] > 150 and 0 <= s1["delayedPct"] <= 1 and s1["tatMedian"] > 0, s1)
    check("total median > 0", (data.get("total", {}).get("median") or 0) > 0)
    check("daily series > 25 days", len(data.get("daily", [])) > 25)
    # scoped analysis for a floor nurse
    st, ndata = call("GET", f"/api/analysis?from={frm}&to={to}&userId={nurse2['id']}")
    check("nurse analysis scoped (cohort < admin's)",
          ndata.get("cohortSize", 999) < data.get("cohortSize", 0), ndata.get("cohortSize"))
    # invalid range
    st, _ = call("GET", f"/api/analysis?from={to}&to={frm}&userId={admin['id']}")
    check("invalid range 400", st == 400, st)

    # -------------------------------------------------------- privileges
    print("\n== Privileges (admin sets edit/view modes) ==")
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": nurse2["id"], "userId": physician_im["id"], "canEdit": False})
    check("non-admin privilege change 403", st == 403, st)
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": admin["id"], "canEdit": False})
    check("self privilege change 400", st == 400, st)
    other_admin = next(u for u in users if u["role"] == "ADMIN" and u["id"] != admin["id"])
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": other_admin["id"], "canEdit": False})
    check("admin target locked 400", st == 400, st)

    st, data = call("GET", "/api/patients")
    board_patients = data.get("patients", [])

    def find_stage4():
        for p in board_patients:  # prefer one awaiting the reception papers
            if p["financeClearedAt"] and not p["receptionReadyAt"] and not p["physicalDischargedAt"]:
                return p
        for p in board_patients:
            if p["financeClearedAt"] and not p["physicalDischargedAt"]:
                return p
        return None

    stage4 = find_stage4()
    stage4nurse = next(u for u in users if u["role"] == "NURSE" and stage4["floor"] in u["floors"])
    stage4_action = "RECEPTION_READY" if not stage4["receptionReadyAt"] else "PHYSICAL_DISCHARGED"
    stage3 = next(p for p in board_patients if p["financeNotifiedAt"] and not p["financeClearedAt"])

    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": stage4nurse["id"], "canEdit": False})
    check("nurse set view-only 200", st == 200, st)
    check("users reflect canEdit=false",
          any(u["id"] == stage4nurse["id"] and not u["canEdit"] for u in data.get("users", [])))

    st, data = call("POST", "/api/actions",
                    {"patientId": stage4["id"], "userId": stage4nurse["id"], "type": stage4_action})
    check("view-only nurse action 403", st == 403, st)
    check("view-only reason mentions view-only", "view-only" in data.get("error", ""), data.get("error"))

    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": stage4nurse["id"], "canEdit": True})
    check("nurse edit restored 200", st == 200, st)

    # bulk scope: hide all finance accounts' view
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "scope": {"role": "FINANCE"}, "canEdit": False, "canView": False})
    check("bulk category hide 200", st == 200, st)
    check("finance users hidden",
          all(not u["canView"] for u in data.get("users", []) if u["role"] == "FINANCE"))
    st, data = call("POST", "/api/actions",
                    {"patientId": stage3["id"], "userId": finance["id"], "type": "FINANCE_CLEARED"})
    check("hidden finance action 403", st == 403, st)
    check("hidden reason mentions view privilege", "view" in data.get("error", "").lower(), data.get("error"))
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "scope": {"role": "FINANCE"}, "canEdit": True, "canView": True})
    check("bulk category restore 200", st == 200, st)

    # --------------------------------------------------------- demo mode
    print("\n== Admin demo view (read-only) ==")
    st, data = call("POST", "/api/actions",
                    {"patientId": stage4["id"], "userId": stage4nurse["id"], "type": stage4_action,
                     "demo": True})
    check("demo action 403", st == 403, st)
    check("demo reason mentions read-only", "demo" in data.get("error", "").lower(), data.get("error"))
    st, data = call("POST", "/api/actions",
                    {"patientId": stage4["id"], "userId": reception["id"], "type": stage4_action})
    check("same action OK when not demo (reception confirms papers)", st == 200, st)
    if stage4_action == "RECEPTION_READY":
        st, data = call("POST", "/api/actions",
                        {"patientId": stage4["id"], "userId": stage4nurse["id"], "type": "PHYSICAL_DISCHARGED"})
        check("discharge completes after papers confirmed", st == 200, st)

    # universal account: full visibility, no actions
    st, data = call("POST", "/api/actions",
                    {"patientId": stage3["id"], "userId": quality["id"], "type": "FINANCE_CLEARED"})
    check("universal action 403", st == 403, st)

    # ------------------------------------------------------ alarm rules
    print("\n== Alarm rules & webhooks ==")
    # deterministic runs: clear the persisted global webhook first
    call("POST", "/api/alarm-rules", {"userId": admin["id"], "action": "setGlobalWebhook", "url": ""})
    st, data = call("GET", f"/api/alarm-rules?userId={nurse2['id']}")
    check("non-admin alarm rules 403", st == 403, st)
    st, data = call("GET", f"/api/alarm-rules?userId={admin['id']}")
    rules = data.get("rules", [])
    check("default rules seeded (10, one WARN+LATE per stage 1-5)", st == 200 and len(rules) == 10, len(rules))
    check("reception + physical stage rules seeded",
          any(r["stage"] == 4 for r in rules) and any(r["stage"] == 5 for r in rules))
    # no admin-saved URL -> effective webhook is the hardcoded testing
    # default (a Discord URL, see lib/alarms.ts TEST_WEBHOOK_URL); revert this
    # check to `is None` when that testing default is deleted.
    check("global webhook falls back to hardcoded testing default",
          isinstance(data.get("globalWebhookUrl"), str)
          and data["globalWebhookUrl"].startswith("https://discord.com/api/webhooks/")
          and data.get("globalWebhookIsTestDefault") is True,
          data.get("globalWebhookUrl"))

    st, data = call("POST", "/api/alarm-rules",
                    {"userId": admin["id"], "action": "create", "name": "Test rule stage1 1min",
                     "stage": 1, "level": "WARN", "thresholdMin": 1})
    check("rule create 200", st == 200 and len(data.get("rules", [])) == 11, st)
    rule = next(r for r in data["rules"] if r["name"] == "Test rule stage1 1min")

    # invalid rule values
    st, _ = call("POST", "/api/alarm-rules",
                 {"userId": admin["id"], "action": "create", "name": "bad", "stage": 9,
                  "level": "WARN", "thresholdMin": 5})
    check("rule create bad stage 400", st == 400, st)
    st, _ = call("POST", "/api/alarm-rules",
                 {"userId": admin["id"], "action": "create", "name": "bad", "stage": 6,
                  "level": "WARN", "thresholdMin": 5})
    check("rule create stage 6 rejected (1-5 only)", st == 400, st)

    # global webhook + evaluation -> alarm notifications + deliveries
    st, data = call("POST", "/api/alarm-rules",
                    {"userId": admin["id"], "action": "setGlobalWebhook", "url": "http://localhost:9/hook"})
    check("set global webhook 200 (saved URL overrides test default)", st == 200 and
          data.get("globalWebhookUrl") == "http://localhost:9/hook" and
          data.get("globalWebhookIsTestDefault") is False, st)

    st, data = call("GET", f"/api/notifications?userId={physician_im['id']}")
    check("physician notifications 200", st == 200, st)
    alarms = [n for n in data.get("notifications", []) if n["type"] == "ALARM"]
    check("alarm notifications created", len(alarms) >= 1, len(alarms))
    check("unread count > 0", data.get("unread", 0) >= 1, data.get("unread"))

    st, data = call("GET", f"/api/alarm-rules?userId={admin['id']}")
    deliveries = data.get("deliveries", [])
    alarm_deliveries = [d for d in deliveries if d["event"] == "alarm"]
    check("alarm webhook deliveries logged", len(alarm_deliveries) >= 1, len(alarm_deliveries))
    check("deliveries carry patient names",
          all(d.get("patientName") is not None for d in alarm_deliveries))

    # dedupe: second evaluation must not duplicate
    st, before = call("GET", f"/api/notifications?userId={physician_im['id']}")
    st, after = call("GET", f"/api/notifications?userId={physician_im['id']}")
    check("evaluation idempotent (no duplicate unread)",
          before.get("unread") == after.get("unread"), (before.get("unread"), after.get("unread")))

    # PATCH + DELETE rule
    st, data = call("PATCH", "/api/alarm-rules",
                    {"userId": admin["id"], "id": rule["id"], "enabled": False, "thresholdMin": 55})
    check("rule patch 200", st == 200 and
          next(r for r in data["rules"] if r["id"] == rule["id"])["thresholdMin"] == 55, st)
    st, data = call("DELETE", f"/api/alarm-rules?id={rule['id']}&userId={admin['id']}")
    check("rule delete 200", st == 200 and
          all(r["id"] != rule["id"] for r in data.get("rules", [])), st)

    # test webhook (valid format, unreachable port)
    st, data = call("POST", "/api/alarm-rules",
                    {"userId": admin["id"], "action": "test", "url": "http://localhost:9/ping"})
    check("test webhook returns outcome", st == 200 and "outcome" in data, st)
    check("test webhook logged",
          any(d["event"] == "test" for d in data.get("deliveries", [])))
    st, _ = call("POST", "/api/alarm-rules", {"userId": admin["id"], "action": "test", "url": "ftp://bad"})
    check("test webhook invalid URL 400", st == 400, st)

    # --------------------------------------------------- handoff flow
    print("\n== Handoff notifications through the pipeline ==")
    csv = ("MRN,Patient Name,Room,Assigned Doctor,Specialty\n"
           "9300101,Test Handoff,220,Dr. Ahmed Samy,Internal Medicine\n")
    st, data = call("POST", "/api/patients", {"csv": csv, "userId": physician_im["id"]})
    check("physician import 403", st == 403, st)
    st, data = call("POST", "/api/patients", {"csv": csv, "userId": finance["id"]})
    check("finance import 403", st == 403, st)
    st, data = call("POST", "/api/patients", {"csv": csv, "userId": admin["id"]})
    check("admin import 200", st == 200 and data.get("created") == 1, st)

    st, before = call("GET", f"/api/notifications?userId={physician_im['id']}")
    imp_handoffs = [n for n in before["notifications"]
                    if n["type"] == "HANDOFF" and n["patientMrn"] == "9300101"]
    check("import handoff notified to specialty physician", len(imp_handoffs) >= 1, len(imp_handoffs))

    patient = next(p for p in data["patients"] if p["mrn"] == "9300101")
    # update 0.3: physicians decide Discharge / No discharge — the patient
    # moves on only after the decision window (set to 1s here for speed)
    st, data = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 1})
    check("admin sets 1s decision window", st == 200 and data.get("decisionWindowSec") == 1, st)
    st, data = call("POST", "/api/actions",
                 {"patientId": patient["id"], "userId": physician_im["id"], "type": "MEDICAL_DECIDED_DISCHARGE"})
    check("physician decides discharge", st == 200, st)
    check("patient still in stage 1 while the window runs",
          data.get("patient", {}).get("medicalDecision") == "DISCHARGE" and
          not data.get("patient", {}).get("medicalReadyAt"),
          data.get("patient", {}).get("medicalDecision"))
    time.sleep(2)
    st, data = call("GET", "/api/patients")
    promoted = next(p for p in data.get("patients", []) if p["mrn"] == "9300101")
    check("decision auto-confirmed after the window",
          promoted["medicalReadyAt"] and promoted["medicalDecision"] == "DISCHARGE",
          promoted.get("medicalReadyAt"))
    check("board payload reflects the 1s window", data.get("decisionWindowSec") == 1,
          data.get("decisionWindowSec"))
    st, n_nurse = call("GET", f"/api/notifications?userId={nurse2['id']}")
    nurse_handoffs = [n for n in n_nurse["notifications"]
                      if n["type"] == "HANDOFF" and n["patientMrn"] == "9300101"]
    check("stage-2 handoff notified to floor nurse", len(nurse_handoffs) >= 1, len(nurse_handoffs))

    st, _ = call("POST", "/api/actions",
                 {"patientId": patient["id"], "userId": nurse2["id"], "type": "COPY_TEMPLATE",
                  "templateBody": "revised body"})
    st, _ = call("POST", "/api/actions",
                 {"patientId": patient["id"], "userId": nurse2["id"], "type": "FINANCE_NOTIFIED"})
    st, n_fin = call("GET", f"/api/notifications?userId={finance['id']}")
    fin_handoffs = [n for n in n_fin["notifications"]
                    if n["type"] == "HANDOFF" and n["patientMrn"] == "9300101"]
    check("stage-3 handoff notified to finance", len(fin_handoffs) >= 1, len(fin_handoffs))

    st, _ = call("POST", "/api/actions",
                 {"patientId": patient["id"], "userId": finance["id"], "type": "FINANCE_CLEARED"})
    st, n_rec = call("GET", f"/api/notifications?userId={reception['id']}")
    rec_handoffs = [n for n in n_rec["notifications"]
                    if n["type"] == "HANDOFF" and n["patientMrn"] == "9300101"]
    check("stage-4 handoff notified to reception (papers)", len(rec_handoffs) >= 1, len(rec_handoffs))

    # reception confirms the papers -> floor nurse gets the discharge handoff
    st, _ = call("POST", "/api/actions",
                 {"patientId": patient["id"], "userId": reception["id"], "type": "RECEPTION_READY"})
    check("reception confirms papers 200", st == 200, st)
    st, n_nurse2 = call("GET", f"/api/notifications?userId={nurse2['id']}")
    stage5_handoffs = [n for n in n_nurse2["notifications"]
                       if n["type"] == "HANDOFF" and n["patientMrn"] == "9300101"
                       and "papers" in n["title"].lower()]
    check("stage-5 handoff notified to floor nurse (papers done)", len(stage5_handoffs) >= 1, len(stage5_handoffs))

    # nurse completes the physical discharge (patient leaves the live board)
    st, data = call("POST", "/api/actions",
                    {"patientId": patient["id"], "userId": nurse2["id"], "type": "PHYSICAL_DISCHARGED"})
    check("nurse discharges after papers confirmed", st == 200, st)
    st, data = call("GET", "/api/patients")
    check("discharged patient left the active board",
          all(p["mrn"] != "9300101" for p in data.get("patients", [])))
    st, data = call("GET", "/api/patients?scope=discharged")
    check("discharged patient listed in the discharged endpoint",
          any(p["mrn"] == "9300101" for p in data.get("patients", [])))

    # mark-all-read
    st, data = call("POST", "/api/notifications", {"userId": nurse2["id"], "all": True})
    check("mark all read", st == 200 and data.get("unread") == 0, data)

    # ------------------------------------------- physician decision flow
    print("\n== Physician decision flow (update 0.3) ==")
    physician_cardio = next(u for u in users if u["role"] == "PHYSICIAN" and u["specialty"] == "Cardiology")
    csv = ("MRN,Patient Name,Room,Assigned Doctor,Specialty\n"
           "9300301,Test Decision,230,Dr. Ahmed Samy,Internal Medicine\n")
    st, data = call("POST", "/api/patients", {"csv": csv, "userId": admin["id"]})
    check("import decision patient 200", st == 200 and data.get("created") == 1, st)
    pat = next(p for p in data["patients"] if p["mrn"] == "9300301")

    # direct MEDICAL_READY is gone from the API surface (auto-confirmed only)
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_READY"})
    check("direct MEDICAL_READY rejected 400", st == 400, st)

    # wrong-specialty physician cannot decide
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_cardio["id"], "type": "MEDICAL_DECIDED_DISCHARGE"})
    check("wrong-specialty decide 403", st == 403, st)
    # nurses cannot decide either
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": nurse2["id"], "type": "MEDICAL_DECIDED_NO"})
    check("nurse decide 403", st == 403, st)
    # nothing to undo yet
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_UNDO"})
    check("undo without a decision 403", st == 403 and "no pending" in data.get("error", "").lower(),
          data.get("error"))

    # widen the window so the undo test cannot race the promotion
    st, data = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 30})
    check("admin widens the window to 30s", st == 200 and data.get("decisionWindowSec") == 30, st)

    # decide DISCHARGE -> pending (patient still stage 1)
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_DECIDED_DISCHARGE"})
    check("decide discharge 200", st == 200, st)
    check("decision recorded, patient not moved yet",
          data["patient"]["medicalDecision"] == "DISCHARGE" and not data["patient"]["medicalReadyAt"],
          data["patient"].get("medicalDecision"))
    check("decision action logged with the physician",
          data.get("action", {}).get("type") == "MEDICAL_DECIDED_DISCHARGE" and
          data["action"].get("userName") == physician_im["name"], data.get("action"))

    # undo inside the window clears the decision
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_UNDO"})
    check("undo inside the window 200",
          st == 200 and data["patient"]["medicalDecision"] is None, st)

    # decide NO -> patient held in stage 1
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_DECIDED_NO"})
    check("decide no-discharge 200",
          st == 200 and data["patient"]["medicalDecision"] == "NO_DISCHARGE", st)
    check("no-discharge patient still stage 1", not data["patient"]["medicalReadyAt"])

    # change NO -> DISCHARGE, shrink the window, board load promotes
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_DECIDED_DISCHARGE"})
    check("change to discharge 200", st == 200, st)
    st, data = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 1})
    check("shrink the window to 1s", st == 200 and data.get("decisionWindowSec") == 1, st)
    time.sleep(2)
    st, data = call("GET", "/api/patients")
    promoted = next(p for p in data.get("patients", []) if p["mrn"] == "9300301")
    check("changed decision auto-confirms to stage 2",
          promoted["medicalReadyAt"] is not None, promoted.get("medicalReadyAt"))

    # undo after the window closed: rejected, patient unaffected
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "MEDICAL_UNDO"})
    check("undo after the window closed 403", st == 403, st)
    st, data = call("GET", "/api/patients")
    after_undo = next(p for p in data.get("patients", []) if p["mrn"] == "9300301")
    check("late undo leaves the patient in stage 2",
          after_undo["medicalReadyAt"] is not None and after_undo["medicalDecision"] == "DISCHARGE",
          after_undo.get("medicalReadyAt"))

    # audit trail shows the undo + decision history
    st, data = call("GET", f"/api/audit?userId={admin['id']}&limit=120")
    types_seen = [a["type"] for a in data.get("actions", []) if a.get("patientName") == "Test Decision"]
    check("audit logs decision + undo history",
          "MEDICAL_DECIDED_DISCHARGE" in types_seen and "MEDICAL_UNDO" in types_seen and
          "MEDICAL_DECIDED_NO" in types_seen, types_seen)

    # --------------------------------------------------- stage-2 cancel
    print("\n== Stage-2 cancel flow (update 0.3) ==")
    # nurse copies the cancellation template (audit-logged)
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": nurse2["id"], "type": "COPY_CANCEL_TEMPLATE"})
    check("nurse copies the cancellation template 200",
          st == 200 and data.get("action", {}).get("type") == "COPY_CANCEL_TEMPLATE", st)
    # physicians cannot cancel
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": physician_im["id"], "type": "CANCEL_DISCHARGE"})
    check("physician cancel 403", st == 403, st)
    # off-floor nurse cannot cancel
    nurse_other = next(u for u in users if u["role"] == "NURSE" and 2 not in u["floors"])
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": nurse_other["id"], "type": "CANCEL_DISCHARGE"})
    check("off-floor nurse cancel 403", st == 403, st)

    # cancel: patient returns to stage 1 with stage-2 artifacts reset
    st, data = call("POST", "/api/actions",
                    {"patientId": pat["id"], "userId": nurse2["id"], "type": "CANCEL_DISCHARGE"})
    check("nurse cancels the discharge 200", st == 200, st)
    cancelled = data["patient"]
    check("patient returned to stage 1, fields reset",
          not cancelled["medicalReadyAt"] and not cancelled["templateCopiedAt"] and
          cancelled["medicalDecision"] is None, cancelled.get("medicalReadyAt"))
    check("cancel action logged with note",
          data.get("action", {}).get("type") == "CANCEL_DISCHARGE" and
          "returned to Medical Clearance" in (data.get("action", {}).get("note") or ""),
          data.get("action", {}).get("note"))

    # the specialty physician learns the patient is back awaiting a decision
    st, data = call("GET", f"/api/notifications?userId={physician_im['id']}")
    returns = [n for n in data.get("notifications", [])
               if n["type"] == "HANDOFF" and n["patientMrn"] == "9300301" and
               "cancelled" in n["title"].lower()]
    check("physician notified of the return", len(returns) >= 1, len(returns))

    # cancel only applies at stage 2 — a stage-3 patient is rejected
    st, data = call("GET", "/api/patients")
    board_patients = data.get("patients", [])
    stage3p = next(p for p in board_patients if p["financeNotifiedAt"] and not p["financeClearedAt"])
    stage3nurse = next(u for u in users if u["role"] == "NURSE" and stage3p["floor"] in u["floors"])
    st, data = call("POST", "/api/actions",
                    {"patientId": stage3p["id"], "userId": stage3nurse["id"], "type": "CANCEL_DISCHARGE"})
    check("cancel on a stage-3 patient 403", st == 403, st)

    # ------------------------------------------------- decision window
    print("\n== Decision window setting (admin) ==")
    st, data = call("GET", f"/api/settings?userId={admin['id']}")
    check("admin reads settings 200", st == 200 and data.get("decisionWindowSec") == 1, data)
    check("settings carry min/max/default",
          data.get("min") == 1 and data.get("max") == 600 and data.get("default") == 60, data)
    st, _ = call("GET", f"/api/settings?userId={nurse2['id']}")
    check("non-admin settings read 403", st == 403, st)
    st, _ = call("POST", "/api/settings", {"userId": nurse2["id"], "decisionWindowSec": 30})
    check("non-admin settings write 403", st == 403, st)
    st, _ = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 0})
    check("window below range 400", st == 400, st)
    st, _ = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 601})
    check("window above range 400", st == 400, st)
    st, _ = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 12.5})
    check("non-integer window 400", st == 400, st)

    # ------------------------------------------------------------- audit
    print("\n== Audit trail ==")
    st, data = call("GET", f"/api/audit?userId={nurse2['id']}")
    check("non-admin audit 403", st == 403, st)
    st, data = call("GET", f"/api/audit?userId={admin['id']}&limit=80")
    check("admin audit 200 with names", st == 200 and
          all(a.get("patientName") for a in data.get("actions", [])) and
          len(data.get("actions", [])) > 0, st)

    # ------------------------------------------------------------- users
    print("\n== Add & delete users ==")
    st, data = call("POST", "/api/users",
                    {"userId": admin["id"], "name": "Test Quality 2", "role": "UNIVERSAL",
                     "subcategory": "QUALITY"})
    check("create universal user 200", st == 200, st)
    new_id = data.get("user", {}).get("id")
    st, data = call("POST", "/api/users", {"userId": admin["id"], "name": "Bad", "role": "WIZARD"})
    check("create invalid role 400", st == 400, st)

    # nurse with multiple floors (multi-select)
    st, data = call("POST", "/api/users",
                    {"userId": admin["id"], "name": "Test Float Nurse", "role": "NURSE",
                     "floors": [2, 3]})
    check("create multi-floor nurse 200", st == 200 and
          data.get("user", {}).get("floors") == [2, 3], st)
    float_id = data.get("user", {}).get("id")
    st, data = call("POST", "/api/users",
                    {"userId": admin["id"], "name": "Bad Floors", "role": "NURSE", "floors": []})
    check("create nurse without floors 400", st == 400, st)

    # admin re-assigns an existing nurse's floors (multi-select)
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": float_id, "floors": [3, 4]})
    check("reassign nurse floors 200", st == 200 and
          any(u["id"] == float_id and u["floors"] == [3, 4] for u in data.get("users", [])), st)
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": float_id, "floors": []})
    check("clear nurse floors rejected 400", st == 400, st)
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "userId": physician_im["id"], "floors": [1]})
    check("floors on non-nurse rejected 400", st == 400, st)

    # reception category privileges can be bulk-managed too
    st, data = call("PATCH", "/api/users",
                    {"actingUserId": admin["id"], "scope": {"role": "RECEPTION"},
                     "canEdit": True, "canView": True})
    check("reception category bulk privileges 200", st == 200, st)

    # delete guards
    st, _ = call("DELETE", f"/api/users?id={other_admin['id']}&actingUserId={admin['id']}")
    check("delete admin blocked 400", st == 400, st)
    st, _ = call("DELETE", f"/api/users?id={admin['id']}&actingUserId={admin['id']}")
    check("delete self blocked 400", st == 400, st)
    # a nurse that acted in this suite owns audit actions -> blocked
    st, data = call("DELETE", f"/api/users?id={nurse2['id']}&actingUserId={admin['id']}")
    check("delete action-owning user blocked 400", st == 400, st)
    # the fresh account has no actions -> deletable
    st, data = call("DELETE", f"/api/users?id={new_id}&actingUserId={admin['id']}")
    check("delete fresh user 200", st == 200, st)
    # non-admin delete
    st, _ = call("DELETE", f"/api/users?id={new_id}&actingUserId={nurse2['id']}")
    check("non-admin delete 403", st == 403, st)
    # purge any leftover test accounts from earlier runs
    st, data = call("GET", "/api/users")
    for u in data.get("users", []):
        if u["name"] in ("Test Quality 2", "Test Float Nurse"):
            call("DELETE", f"/api/users?id={u['id']}&actingUserId={admin['id']}")

    # ----------------------------------------------------------- cleanup
    print("\n== Cleanup ==")
    st, data = call("DELETE", f"/api/patients?userId={admin['id']}")
    check("admin clear all 200", st == 200, st)
    st, data = call("DELETE", f"/api/patients?userId={nurse2['id']}")
    check("non-admin clear all 403", st == 403, st)
    st, data = call("POST", f"/api/patients/demo?userId={admin['id']}")
    check("reload demo dataset for browsing", st == 200, st)
    # restore the default decision window (was shrunk to 1s for the tests)
    st, data = call("POST", "/api/settings", {"userId": admin["id"], "decisionWindowSec": 60})
    check("decision window restored to 60", st == 200 and data.get("decisionWindowSec") == 60, st)
    # clear the localhost test URL saved above: with no saved value the
    # hardcoded Discord testing default becomes effective again, so live
    # app browsing routes alarms to Discord (intended while testing).
    call("POST", "/api/alarm-rules", {"userId": admin["id"], "action": "setGlobalWebhook", "url": ""})

    print(f"\n{'='*50}\nTOTAL: {passed} passed, {failed} failed\n{'='*50}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
