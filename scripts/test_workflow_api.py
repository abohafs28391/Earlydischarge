#!/usr/bin/env python3
"""E2E API test for the role-based discharge workflow."""
import json
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
        with urllib.request.urlopen(req, data, timeout=30) as res:
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
    # --- users ---
    st, data = call("GET", "/api/users")
    users = data.get("users", [])
    check("users seeded", st == 200 and len(users) >= 19, f"st={st} n={len(users)}")
    by_name = {u["name"]: u for u in users}
    dr_im = by_name.get("Dr. Ahmed Samy")
    dr_cardio = by_name.get("Dr. Layla Nasser")
    nurse_f2 = by_name.get("Nour El-Din")
    nurse_f1 = by_name.get("Aya Hassan")
    finance = by_name.get("Maya Aslam")
    assert dr_im and dr_cardio and nurse_f2 and nurse_f1 and finance, "missing seed users"

    # --- fresh state, then demo data ---
    call("DELETE", "/api/patients")
    st, data = call("POST", "/api/patients/demo")
    check("demo loaded", st == 200 and data.get("created", 0) >= 20, f"st={st}")
    patients = data.get("patients", [])

    def stage(p):
        if p["physicalDischargedAt"]: return 5
        if p["financeClearedAt"]: return 4
        if p["financeNotifiedAt"]: return 3
        if p["medicalReadyAt"]: return 2
        return 1

    # --- 1. physician clears matching specialty ---
    target = next(p for p in patients if stage(p) == 1 and p["doctorSpecialty"] == "Internal Medicine" and p["floor"] == 2)
    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": dr_im["id"], "type": "MEDICAL_READY"})
    check("IM physician clears IM patient -> 200", st == 200 and data["patient"]["medicalReadyAt"], f"st={st}")
    check("audit action logged w/ user", data.get("action", {}).get("userName") == "Dr. Ahmed Samy")

    # --- 2. same patient again (now stage 2) -> 403 ---
    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": dr_im["id"], "type": "MEDICAL_READY"})
    check("repeat medical clear -> 403", st == 403, f"st={st}")

    # --- 3. wrong-specialty physician -> 403 ---
    other = next(p for p in patients if stage(p) == 1 and p["doctorSpecialty"] != "Internal Medicine")
    st, data = call("POST", "/api/actions", {"patientId": other["id"], "userId": dr_im["id"], "type": "MEDICAL_READY"})
    check("IM physician cannot clear non-IM -> 403", st == 403, f"st={st}")

    # --- 4. nurse template flow on the cleared patient (floor 2) ---
    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "FINANCE_NOTIFIED"})
    check("mark notified before copy -> 403", st == 403, f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f1["id"], "type": "COPY_TEMPLATE"})
    check("floor-1 nurse cannot copy for floor-2 patient -> 403", st == 403, f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "COPY_TEMPLATE", "templateBody": "revised body"})
    check("floor nurse copies template -> 200 + time logged", st == 200 and data["patient"]["templateCopiedAt"], f"st={st}")
    check("revised template saved", data["patient"]["templateBody"] == "revised body")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "FINANCE_NOTIFIED"})
    check("mark notification completed -> 200", st == 200 and data["patient"]["financeNotifiedAt"], f"st={st}")

    # --- 5. finance clearance ---
    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "FINANCE_CLEARED"})
    check("nurse cannot financially clear -> 403", st == 403, f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": finance["id"], "type": "FINANCE_CLEARED"})
    check("finance clears -> 200 + logged", st == 200 and data["patient"]["financeClearedAt"], f"st={st}")

    # --- 6. physical discharge two-step gating ---
    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "PHYSICAL_DISCHARGED"})
    check("physical discharge before reception reminder -> 403", st == 403, f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "REMIND_RECEPTION"})
    check("remind reception -> 200 + logged", st == 200 and data["patient"]["receptionRemindedAt"], f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": finance["id"], "type": "PHYSICAL_DISCHARGED"})
    check("finance cannot mark physical discharge -> 403", st == 403, f"st={st}")

    st, data = call("POST", "/api/actions", {"patientId": target["id"], "userId": nurse_f2["id"], "type": "PHYSICAL_DISCHARGED"})
    check("physical discharge after reminder -> 200", st == 200 and data["patient"]["physicalDischargedAt"], f"st={st}")

    # --- 7. import ---
    csv = "MRN,Patient Name,Room,Assigned Doctor,Specialty\n7001001,Test Patient A,501,Dr. Hossam Farid,Emergency Medicine\n7001002,Test Patient B,502,Dr. Nobody Yet,Dermatology\nBADROW,noroom\n"
    st, data = call("POST", "/api/patients", {"csv": csv, "userId": nurse_f1["id"]})
    check("import creates 2 valid rows", st == 200 and data.get("created") == 2, f"st={st} created={data.get('created')}")
    check("import skips bad row w/ error", any("noroom" in e or "BADROW" in e or "missing" in e for e in data.get("errors", [])), str(data.get("errors"))[:120])
    check("unknown specialty warning", any("Dermatology" in w for w in data.get("warnings", [])), str(data.get("warnings"))[:160])

    st, data = call("POST", "/api/patients", {"csv": csv, "userId": nurse_f1["id"]})
    check("re-import skips duplicate MRNs", st == 200 and data.get("created") == 0 and any("already exists" in w for w in data.get("warnings", [])))

    st, data = call("GET", "/api/patients")
    imported = [p for p in data["patients"] if p["mrn"] == "7001001"]
    check("imported patient floor derived (501 -> 5)", imported and imported[0]["floor"] == 5, f"floor={imported[0]['floor'] if imported else None}")
    imp_action = [a for a in data["actions"] if a["patientId"] == imported[0]["id"] and a["type"] == "IMPORTED"]
    check("import audit attributed to importer", imp_action and imp_action[0]["userName"] == "Aya Hassan")

    # --- 8. TSV / Excel paste ---
    tsv = "Patient Name\tRoom\tDoctor\tSpecialty\nTest Patient C\t603\tDr. Karim Fouad\tGeneral Surgery"
    st, data = call("POST", "/api/patients", {"csv": tsv, "userId": nurse_f1["id"]})
    check("Excel-paste TSV import works", st == 200 and data.get("created") == 1, f"st={st} created={data.get('created')}")

    # --- 9. export ---
    st = call("GET", "/api/export")[0]
    check("CSV export 200", st == 200)

    # --- 10. clear demo only ---
    st, data = call("DELETE", "/api/patients/demo")
    remaining = [p for p in data.get("patients", []) if p["isDemo"]]
    imported_left = [p for p in data.get("patients", []) if p["mrn"] in ("7001001", "7001002")]
    check("clear demo removes demo, keeps imports", st == 200 and not remaining and len(imported_left) == 2)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
