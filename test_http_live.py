#!/usr/bin/env python3
"""
test_http_live.py — real HTTP tests against a RUNNING server (not test_client).
Work-order §3: verify endpoints on an actual socket, including wizards=8.
"""
import json
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

BASE = pathlib.Path(__file__).parent
HOST = "127.0.0.1"


def free_port():
    with socket.socket() as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def get(port, path):
    with urllib.request.urlopen(f"http://{HOST}:{port}{path}", timeout=5) as r:
        return r.status, json.loads(r.read().decode())


def post(port, path, payload):
    req = urllib.request.Request(f"http://{HOST}:{port}{path}",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main():
    import os
    port = free_port()
    env = dict(os.environ)
    env["CONFIG_STUDIO_NO_BROWSER"] = "1"
    env["CONFIG_STUDIO_PORT"] = str(port)
    srv = subprocess.Popen([sys.executable, "app.py"], cwd=str(BASE),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    # wait for health
    ok = False
    for _ in range(40):
        try:
            s, b = get(port, "/api/health")
            if s == 200:
                ok = True
                break
        except Exception:
            time.sleep(0.3)
    results = []
    try:
        def rec(name, cond, extra=""):
            results.append((name, cond, extra))

        s, b = get(port, "/api/health")
        rec("GET /api/health 200 + build_id + sha256 + started_at",
            s == 200 and b.get("build_id") and b.get("source_sha256") and b.get("started_at"),
            f"build={b.get('build_id')}")

        s, b = get(port, "/api/config")
        rec("GET /api/config 200 + 2 devices",
            s == 200 and len(b.get("devices", [])) == 2,
            ",".join(d["device"] for d in b.get("devices", [])))

        s, b = get(port, "/api/device/TMS320F28034/wizards")
        rec("GET wizards 200 + 8 items",
            s == 200 and len(b.get("wizards", {})) == 8,
            f"count={len(b.get('wizards', {}))}")

        s, b = get(port, "/api/device/TMS320F28034/pinmux")
        rec("GET pinmux 200 + 80 pins", s == 200 and len(b.get("pins", {})) == 80)

        s, b = get(port, "/api/device/TMS320F28034/index")
        rec("GET index 200 + EPWM1A->pin69",
            s == 200 and any(e["physical_pin"] == 69 for e in b.get("EPWM1A", [])))

        # generate: unverified-free GPIO config -> 200
        good = {"device": "TMS320F28034", "mode": "preview", "config": {
            "wizard": "gpio_output", "params": {"target_mhz": 60},
            "pins": [{"pin": 78, "signal": "GPIO20", "function": "GPIO20", "mux": 0,
                      "level": "low", "direction": "output", "pullup": "disable"}]}}
        s, b = post(port, "/api/generate", good)
        rec("POST /api/generate GPIO-only 200 + files",
            s == 200 and b.get("ok") and len(b.get("files", {})) > 0)

        # generate: deadband=0 -> 422
        bad = {"device": "TMS320F28034", "mode": "preview", "config": {
            "wizard": "epwm_complementary",
            "params": {"freq_hz": 100000, "dead_ns": 0}, "pins": []}}
        s, b = post(port, "/api/generate", bad)
        rec("POST /api/generate deadband=0 -> 422 + PWM_DEADBAND_ZERO",
            s == 422 and any(f["rule"] == "PWM_DEADBAND_ZERO" for f in b.get("findings", [])))

        # generate: power pin -> 422
        bad2 = {"device": "TMS320F28034", "mode": "preview", "config": {
            "pins": [{"pin": 7, "signal": "VDD", "function": "GPIO", "mux": 0}]}}
        s, b = post(port, "/api/generate", bad2)
        rec("POST /api/generate power pin -> 422 + POWER_PIN_GPIO",
            s == 422 and any(f["rule"] == "POWER_PIN_GPIO" for f in b.get("findings", [])))

        # generate: mode=live -> 400 (refused)
        s, b = post(port, "/api/generate", {"device": "TMS320F28034", "mode": "live", "config": {}})
        rec("POST /api/generate mode=live -> 400 refused", s == 400)

        # search
        s, b = get(port, "/api/search?q=TZ1&device=TMS320F28034")
        pins = {r["physical_pin"] for r in b.get("results", [])}
        rec("GET /api/search TZ1 -> pin47 & pin75", s == 200 and 47 in pins and 75 in pins)
    finally:
        try:
            srv.terminate(); srv.wait(timeout=5)
        except Exception:
            srv.kill()

    print("=" * 60)
    print("  Live HTTP tests (real socket, not test_client)")
    print("=" * 60)
    allok = True
    for name, ok, extra in results:
        print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f"  ({extra})" if extra else ""))
        allok = allok and ok
    print("=" * 60)
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
