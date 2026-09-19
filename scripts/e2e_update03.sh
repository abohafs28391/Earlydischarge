#!/bin/bash
# Update 0.3 browser E2E: physician decision flow (Discharge / No discharge +
# 10s undo window + auto-move), stage-2 cancel mail + typed-confirmation
# cancel, admin Workflow section (decision window), audit trail.
set -u
cd /home/z/my-project

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/api/users 2>/dev/null)
if [ "$code" != "200" ]; then
  echo "[e2e] starting dev server…"
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
  fuser -k 3000/tcp 2>/dev/null; sleep 1
  nohup bun run dev > /dev/null 2>&1 &
  for i in $(seq 1 90); do
    sleep 3
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/users 2>/dev/null)
    [ "$code" = "200" ] && break
  done
fi
echo "[e2e] /api/users -> $code"
[ "$code" != "200" ] && { echo "[e2e] server down"; exit 1; }

# --- resolve acting users ---------------------------------------------------
read -r ADMIN_ID DR_SAMY NOUR <<<"$(python3 - <<'PY'
import json, urllib.request
users = json.load(urllib.request.urlopen("http://127.0.0.1:3000/api/users", timeout=30))["users"]
admin = next(u["id"] for u in users if u["role"] == "ADMIN")
sam = next(u["id"] for u in users if u["name"] == "Dr. Ahmed Samy")
nour = next(u["id"] for u in users if u["name"] == "Nour El-Din")
print(admin, sam, nour)
PY
)"
echo "[e2e] admin=$ADMIN_ID samy=$DR_SAMY nour=$NOUR"

# --- deterministic demo state: window 60, fresh demo dataset ----------------
curl -s -X POST http://127.0.0.1:3000/api/settings -H "Content-Type: application/json" \
     -d "{\"userId\":\"$ADMIN_ID\",\"decisionWindowSec\":60}" > /dev/null
curl -s -X DELETE "http://127.0.0.1:3000/api/patients?userId=$ADMIN_ID" > /dev/null
curl -s -X POST "http://127.0.0.1:3000/api/patients/demo?userId=$ADMIN_ID" > /dev/null
echo "[e2e] demo dataset reloaded (fresh decisions on the board)"

ab() { agent-browser "$@"; }

echo "[e2e] --- 1) admin sets the decision window via Workflow section -------"
ab open http://127.0.0.1:3000
ab wait --text "DischargeFlow"
ab find role tab click --name "Admin" 2>/dev/null || ab eval '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Admin"); if(b){b.click();return "ok"} return "missing" })()'
ab wait --text "Admin console"
ab eval '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("Workflow")); if(b){b.click();return "ok"} return "missing" })()'
ab wait --text "Physician decision window"
ab wait --text "live: 60s"
ab fill "#decision-window-input" "10"
ab eval '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("Save window")); if(b){b.click();return "ok"} return "missing" })()'
ab wait --text "Decision window set to 10s"
ab wait --text "live: 10s"
ab screenshot scripts/e2e03_admin_workflow.png
echo "[e2e] admin workflow section OK"

echo "[e2e] --- 2) physician: decide / undo / no-discharge / change ----------"
ab storage local set dischargeflow.currentUserId "$DR_SAMY"
ab reload
ab wait --text "Medical Clearance"
ab wait 3000
# physicians see ONLY their specialty's patients (Hoda = Cardiology, hidden)
ab eval 'document.body.textContent.includes("Hoda Kamel") ? "FAIL-specialty-leak" : "OK-im-only"'
# Adel Mansour (IM, stage 1, no decision yet) shows the two options
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); if(!c) return "missing-card"; const names=[...c.querySelectorAll("button")].map(b=>b.textContent.trim()); return names.join("|") })()'
# click Discharge -> pending countdown + Undo / No discharge
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.trim()==="Discharge"); b.click(); return "clicked-discharge" })()'
ab wait --text "moves on in"
ab screenshot scripts/e2e03_physician_pending.png
# undo inside the window
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.trim()==="Undo"); b.click(); return "clicked-undo" })()'
ab wait 1500
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const pending=c.textContent.includes("moves on in"); const twoOpt=[...c.querySelectorAll("button")].some(b=>b.textContent.trim()==="Discharge") && [...c.querySelectorAll("button")].some(b=>b.textContent.trim()==="No discharge"); return pending ? "FAIL-still-pending" : (twoOpt ? "OK-undone" : "FAIL-no-options") })()'
# decide No discharge -> held with badge + change button
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.trim()==="No discharge"); b.click(); return "clicked-no" })()'
ab wait --text "Physician decision: No discharge"
ab screenshot scripts/e2e03_physician_nodecision.png
# change the decision to Discharge -> countdown again
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.includes("Change decision")); b.click(); return "clicked-change" })()'
ab wait --text "moves on in"
echo "[e2e] decision recorded; waiting out the 10s window…"
ab wait 12500
# the card should have moved to Notify Financial Team (expiry refresh)
ab eval '(() => { const s=[...document.querySelectorAll("section")].find(x=>(x.getAttribute("aria-label")||"").includes("Notify Financial Team")); return s && s.textContent.includes("Adel Mansour") ? "OK-moved-to-stage2" : "FAIL-not-moved" })()'
ab screenshot scripts/e2e03_physician_moved.png

echo "[e2e] --- 3) floor nurse: cancel mail + typed-confirmation cancel -------"
ab storage local set dischargeflow.currentUserId "$NOUR"
ab reload
ab wait --text "Medical Clearance"
ab wait 3000
# Adel (room 201, floor 2) is in column 2 with the two new buttons
ab eval '(() => { const s=[...document.querySelectorAll("section")].find(x=>(x.getAttribute("aria-label")||"").includes("Notify Financial Team")); const c=s && [...s.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); if(!c) return "missing-card"; const names=[...c.querySelectorAll("button")].map(b=>b.textContent.trim()); return names.join("|") })()'
# send the cancel mail (copies template + logs the action)
ab eval '(() => { const s=[...document.querySelectorAll("section")].find(x=>(x.getAttribute("aria-label")||"").includes("Notify Financial Team")); const c=[...s.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.includes("Send cancel mail")); b.click(); return "clicked-cancel-mail" })()'
ab wait 2000
# open the Cancel dialog
ab eval '(() => { const s=[...document.querySelectorAll("section")].find(x=>(x.getAttribute("aria-label")||"").includes("Notify Financial Team")); const c=[...s.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); const b=[...c.querySelectorAll("button")].find(x=>x.textContent.trim()==="Cancel"); b.click(); return "clicked-cancel" })()'
ab wait --text "Cancel this discharge?"
# confirm button locked while the typed word does not match
ab fill "#cancel-confirm-input" "cance"
ab eval '(() => { const b=[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.includes("Cancel discharge")); return b.disabled ? "OK-locked" : "FAIL-unlocked-early" })()'
ab fill "#cancel-confirm-input" "cancel"
ab eval '(() => { const b=[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.includes("Cancel discharge")); return b.disabled ? "FAIL-still-locked" : "OK-unlocked" })()'
ab screenshot scripts/e2e03_cancel_dialog.png
ab eval '(() => { const b=[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.includes("Cancel discharge")); b.click(); return "confirmed" })()'
ab wait 2500
# the card returned to Medical Clearance
ab eval '(() => { const s=[...document.querySelectorAll("section")].find(x=>(x.getAttribute("aria-label")||"").includes("Medical Clearance")); return s && s.textContent.includes("Adel Mansour") ? "OK-back-to-stage1" : "FAIL-not-returned" })()'
ab screenshot scripts/e2e03_nurse_after_cancel.png

echo "[e2e] --- 4) audit trail shows the full decision history ----------------"
ab eval '(() => { const c=[...document.querySelectorAll("article")].find(a=>a.textContent.includes("Adel Mansour")); c.click(); return "opened-drawer" })()'
ab wait --text "Audit trail"
ab eval '(() => { const t=document.body.textContent; const need=["Discharge decision recorded","Decision undone","No-discharge decision recorded","Medically cleared","Cancellation template copied","Discharge cancelled"]; const missing=need.filter(n=>!t.includes(n)); return missing.length===0 ? "OK-full-history" : "MISSING:"+missing.join(",") })()'
ab screenshot scripts/e2e03_drawer_history.png

echo "[e2e] --- 5) console / page errors ----------------------------------------"
ab errors
ab console | tail -5
ab close

echo "[e2e] dev.log errors:"
grep -iE "error|unhandled" dev.log | grep -v "prisma:query" | tail -5 || echo "(none)"
echo "[e2e] done"
