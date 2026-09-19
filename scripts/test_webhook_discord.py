#!/usr/bin/env python3
"""Task 6 E2E: webhook channel adapters.

Reproduces the reported Discord 400 against a local mock that enforces
Discord's real API contract (400 {"message": "Cannot send an empty message",
"code": 50006} unless `content` / `embeds` is present; 204 on success), then
proves the channel-adapter fix and generic-receiver backward compatibility.

Run: python3 scripts/test_webhook_discord.py   (dev server on :3000)
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.request

BASE = "http://localhost:3000"
MOCK_HOST, MOCK_PORT = "127.0.0.1", 4788
received = []  # (path, headers-dict, body-dict)

passed, failed = 0, 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name} {extra}")


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


class MockIM(BaseHTTPRequestHandler):
    """Emulates Discord's webhook API contract on /discord/*, and a plain
    JSON-accepting receiver on anything else."""

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode() if length else ""
        try:
            body = json.loads(raw)
        except Exception:
            body = {"_raw": raw}
        received.append((self.path, dict(self.headers), body))

        if self.path.startswith("/discord"):
            # Real Discord behaviour: reject payloads without content/embeds/files
            if not ("content" in body or "embeds" in body or "files" in body):
                err = json.dumps(
                    {"message": "Cannot send an empty message", "code": 50006}
                ).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
                return
            self.send_response(204)  # Discord: 204 No Content on success
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        ok = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(ok)))
        self.end_headers()
        self.wfile.write(ok)

    def log_message(self, *args):
        pass


def main():
    server = HTTPServer((MOCK_HOST, MOCK_PORT), MockIM)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    st, data = call("GET", "/api/users")
    check("app is up (users 200)", st == 200, st)
    admin = next(u for u in data["users"] if u["role"] == "ADMIN")
    mock = f"http://{MOCK_HOST}:{MOCK_PORT}/discord/webhook-id/token"

    # Route the global webhook at the local mock for the whole suite: without
    # a saved URL the app now falls back to a HARDCODED LIVE Discord webhook
    # (lib/alarms.ts TEST_WEBHOOK_URL) and evaluateAlarms below would post real
    # alarm messages to it. Pointing the saved value at the mock keeps this
    # suite deterministic and side-effect free.
    st, _ = call("POST", "/api/alarm-rules",
                 {"userId": admin["id"], "action": "setGlobalWebhook",
                  "url": f"http://{MOCK_HOST}:{MOCK_PORT}/generic"})

    print("\n== Reproduce the reported bug (old generic JSON -> Discord) ==")
    st, data = call(
        "POST",
        "/api/alarm-rules",
        {"action": "test", "userId": admin["id"], "url": mock, "channel": "generic"},
    )
    check("test action 200", st == 200, st)
    check(
        "generic payload -> Discord contract 400 (bug reproduced)",
        data.get("outcome", {}).get("ok") is False,
        data.get("outcome"),
    )
    check(
        "receiver error body surfaced in status (root cause visible in log)",
        "Cannot send an empty message" in data.get("outcome", {}).get("status", ""),
        data.get("outcome", {}).get("status"),
    )
    body = received[-1][2]
    check("old-style payload had no content field", "content" not in body, list(body.keys()))
    check(
        "POST carries JSON content-type",
        "application/json" in received[-1][1].get("Content-Type", ""),
    )

    print("\n== Fix: Discord-shaped payload ==")
    st, data = call(
        "POST",
        "/api/alarm-rules",
        {"action": "test", "userId": admin["id"], "url": mock, "channel": "discord"},
    )
    check("test action 200", st == 200, st)
    check(
        "discord payload delivered (204)",
        data.get("outcome", {}).get("ok") is True,
        data.get("outcome"),
    )
    check("response reports channel=discord", data.get("channel") == "discord", data.get("channel"))
    body = received[-1][2]
    check("payload has content field", "content" in body, list(body.keys()))
    check(
        "content is the formatted test message",
        "DischargeFlow webhook test" in body.get("content", ""),
        body.get("content", "")[:80],
    )
    check("username set to DischargeFlow", body.get("username") == "DischargeFlow")
    check("mentions disabled", body.get("allowed_mentions", {}).get("parse") == [])

    print("\n== Auto-detection is hostname-based (sanity) ==")
    st, data = call(
        "POST", "/api/alarm-rules", {"action": "test", "userId": admin["id"], "url": mock}
    )
    check("localhost URL detected as generic (no override)", data.get("channel") == "generic")
    check(
        "strict mock still 400 for generic shape (detection not fooled by path)",
        data.get("outcome", {}).get("ok") is False,
    )

    print("\n== Alarm path: generic receiver keeps full JSON (backward compat) ==")
    call("POST", f"/api/patients/demo?userId={admin['id']}")  # ensure active patients
    st, data = call(
        "POST",
        "/api/alarm-rules",
        {
            "action": "create",
            "userId": admin["id"],
            "name": "T6 stage1 over 1min",
            "stage": 1,
            "level": "WARN",
            "thresholdMin": 1,
            "webhookUrl": f"http://{MOCK_HOST}:{MOCK_PORT}/generic",
        },
    )
    check("rule created", st == 200 and data.get("rule", {}).get("id"), st)
    rule_id = data.get("rule", {}).get("id")

    n1 = len(received)
    call("GET", f"/api/notifications?userId={admin['id']}")  # triggers evaluateAlarms
    fired = [r for r in received[n1:] if r[0] == "/generic"]
    check("alarm webhooks fired to generic receiver", len(fired) > 0, len(fired))
    if fired:
        body = fired[0][2]
        check("payload keeps event=alarm", body.get("event") == "alarm", body.keys())
        check("payload keeps rule block", "rule" in body and "thresholdMin" in body["rule"])
        check("payload keeps patient block", "patient" in body and "room" in body["patient"])
        check(
            "payload keeps minutesInStage + taskOwners",
            "minutesInStage" in body and "taskOwners" in body,
        )
        check(
            "payload carries readable title + message",
            bool(body.get("title")) and isinstance(body.get("message"), str),
        )

    if rule_id:
        st, _ = call("DELETE", f"/api/alarm-rules?id={rule_id}&userId={admin['id']}")
        check("test rule cleaned up", st == 200, st)

    # Drop the saved mock URL so the hardcoded Discord testing default becomes
    # effective again for live app browsing (intended while testing).
    call("POST", "/api/alarm-rules", {"userId": admin["id"], "action": "setGlobalWebhook", "url": ""})

    server.shutdown()
    print(f"\n{'ALL PASS' if failed == 0 else f'{failed} FAILED'} ({passed} checks)")
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
