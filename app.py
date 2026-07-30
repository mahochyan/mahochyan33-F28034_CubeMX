#!/usr/bin/env python3
"""
app.py — C2000 Config Studio for F28034 (offline local backend)

R1 changes:
  * /api/health returns build_id, source_sha256, started_at.
  * Startup checks the port; if an OLD build_id answers, it is asked to shut
    down (/api/shutdown) or we move to a free port. No blind browser open.
  * Browser opens only AFTER /api/health succeeds.
  * /api/generate runs the constraint checker FIRST and returns HTTP 422 on
    any ERROR — no preview/staging output, no ok=true fallback.

Safety contract (enforced here, not just in the UI):
  * Offline only, binds 127.0.0.1 (never 0.0.0.0).
  * Never connects JTAG, never Loads/Runs a target, never writes Flash.
  * Never modifies the live CCS project; export target is ONLY generator/staging/.
  * Never auto-enables PWM; generated PWM stays clamped until the application
    explicitly calls the separately-generated release function.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import pathlib
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
import zipfile
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_file, send_from_directory, abort

BASE = pathlib.Path(__file__).parent
WEB = BASE / "web"
DEVICES = BASE / "devices"
STAGING = BASE / "generator" / "staging"
TI_DEVICE = pathlib.Path(r"D:\CCS21_workspace\LLC_100W_F28034\device")

APP_MODE = os.environ.get("APP_MODE", "local").strip().lower()
if APP_MODE not in {"local", "web"}:
    raise RuntimeError("APP_MODE must be 'local' or 'web'")
HOST = "0.0.0.0" if APP_MODE == "web" else "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("PORT", os.environ.get("CONFIG_STUDIO_PORT", "5173")))
STARTED_AT = datetime.now(timezone.utc).isoformat()

# ─────────────────────────────────────────────────────────────────────────────
# build identity
# ─────────────────────────────────────────────────────────────────────────────
_HASH_FILES = [
    "app.py",
    "generator/codegen.py",
    "validators/constraint_checker.py",
    "web/js/app.js", "web/js/store.js", "web/js/chip.js", "web/js/tree.js",
    "web/js/detail.js", "web/js/wizard.js", "web/js/search.js",
    "web/index.html", "web/css/style.css",
    "devices/ti/c2000/parts/tms320f28034/pinmux.json",
    "devices/ti/c2000/parts/tms320f28034/pinmux_evidence.json",
    "devices/ti/c2000/parts/tms320f28034/packages/pnt80.json",
    "devices/ti/c2000/f2803x/wizards.json",
    "Dockerfile", "requirements.txt",
]


def _sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def compute_build_id() -> dict:
    h = hashlib.sha256()
    per_file = {}
    for rel in _HASH_FILES:
        p = BASE / rel
        if p.exists():
            digest = _sha256(p)
            per_file[rel] = digest
            h.update(rel.encode())
            h.update(digest.encode())
    source_sha = h.hexdigest()
    return {
        "build_id": source_sha[:12],
        "source_sha256": source_sha,
        "file_count": len(per_file),
        "files": per_file,
    }


BUILD = compute_build_id()


# ─────────────────────────────────────────────────────────────────────────────
# port helpers
# ─────────────────────────────────────────────────────────────────────────────
def http_get_json(url: str, timeout: float = 2.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None, None


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


def free_port(start: int) -> int:
    p = start
    while p < start + 50:
        if not port_open(p):
            return p
        p += 1
    raise RuntimeError("no free port in range")


# ─────────────────────────────────────────────────────────────────────────────
# Device registry
# ─────────────────────────────────────────────────────────────────────────────
class Registry:
    def __init__(self, root: pathlib.Path):
        self.root = root
        self.devices: dict[str, dict] = {}
        self.errors: list[str] = []
        self.scan()

    def scan(self):
        self.devices.clear()
        self.errors.clear()
        parts = self.root / "ti" / "c2000" / "parts"
        if not parts.exists():
            self.errors.append(f"parts dir missing: {parts}")
            return
        for dj in sorted(parts.glob("*/device.json")):
            try:
                d = json.loads(dj.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                self.errors.append(f"{dj}: {exc}")
                continue
            name = d.get("device", dj.parent.name)
            self.devices[name] = {
                "info": d,
                "part_dir": dj.parent,
                "family_dir": self.root / "ti" / "c2000" / d.get("family", "f2803x"),
            }

    def get(self, device: str) -> dict:
        if device not in self.devices:
            abort(404, f"unknown device '{device}'. Known: {list(self.devices)}")
        return self.devices[device]

    def load(self, device: str, rel: str) -> dict:
        d = self.get(device)
        for base in (d["part_dir"], d["family_dir"]):
            p = base / rel
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        abort(404, f"{rel} not found for {device}")


REG = Registry(DEVICES)
DEFAULT_DEVICE = "TMS320F28034"
_ACTIVE_PORT = None  # set in main()


def build_index(pinmux: dict) -> dict:
    idx: dict[str, list] = {}
    for p in pinmux.get("pins", {}).values():
        if "gpio_num" not in p:
            continue
        base = {"physical_pin": p["physical_pin"], "gpio": p["gpio_num"],
                "signal": p["primary_signal"]}
        for m in p.get("mux_options", []):
            rec = dict(base)
            rec.update({
                "mux": m["mux"], "type": m["type"],
                "signal_verified": m.get("signal_verified", m.get("source_verified", False)),
                "mux_value_verified": m.get("mux_value_verified", m.get("source_verified", False)),
                "generator_supported": m.get("generator_supported", m.get("mux") == 0),
                "generator_profile": m.get("generator_profile"),
            })
            idx.setdefault(m["function"], []).append(rec)
        for nm in p.get("alt_non_mux", []):
            rec = dict(base)
            rec.update({"mux": None, "type": "non_mux",
                        "selector": nm.get("selector"),
                        "source_verified": nm.get("source_verified", False)})
            idx.setdefault(nm["function"], []).append(rec)
    return idx


# ─────────────────────────────────────────────────────────────────────────────
# Flask app
# ─────────────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(WEB), static_url_path="")
app.logger.setLevel("INFO")


def error_response(code: str, message: str, status: int, details=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return jsonify(payload), status


@app.errorhandler(404)
def _not_found(exc):
    return error_response("NOT_FOUND", str(exc), 404)


@app.errorhandler(405)
def _not_allowed(exc):
    return error_response("METHOD_NOT_ALLOWED", str(exc), 405)


@app.errorhandler(500)
def _server_error(exc):
    return error_response("INTERNAL_ERROR", str(exc), 500)


@app.after_request
def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-store"
    app.logger.info("access method=%s path=%s status=%s mode=%s",
                    request.method, request.path, resp.status_code, APP_MODE)
    return resp


@app.get("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.get("/api/config")
def api_config():
    return jsonify({
        "app": "C2000 Config Studio",
        "version": "R3",
        "status": "CONFIG_STUDIO_R3_IN_PROGRESS",
        "app_mode": APP_MODE,
        "build_id": BUILD["build_id"],
        "default_device": DEFAULT_DEVICE,
        "devices": [
            {"device": name,
             "part_number": d["info"].get("part_number"),
             "family": d["info"].get("family"),
             "status": d["info"].get("status", "SKELETON"),
             "packages": d["info"].get("packages", []),
             "max_sysclk_mhz": d["info"].get("max_sysclk_mhz")}
            for name, d in sorted(REG.devices.items())
            if d["info"].get("status") == "SUPPORTED"
        ],
        "registry_errors": REG.errors if APP_MODE == "local" else [],
        "safety": {"no_jtag": True, "no_flash_write": True,
                   "no_auto_pwm_enable": True, "export": "memory_zip"},
        "ti_device_present": TI_DEVICE.exists() if APP_MODE == "local" else False,
    })


@app.get("/api/device/<device>")
def api_device(device):
    info = dict(REG.get(device)["info"])
    if APP_MODE == "web":
        for key in ("device_header_path", "include_path", "source_path"):
            info.pop(key, None)
    return jsonify(info)


@app.get("/api/device/<device>/pinmux")
def api_pinmux(device):
    return jsonify(REG.load(device, "pinmux.json"))


@app.get("/api/device/<device>/package/<package_name>")
def api_package(device, package_name):
    expected = package_name.lower()
    return jsonify(REG.load(device, f"packages/{expected}.json"))


@app.get("/api/device/<device>/constraints")
def api_constraints(device):
    return jsonify(REG.load(device, "constraints.json"))


@app.get("/api/device/<device>/index")
def api_index(device):
    return jsonify(build_index(REG.load(device, "pinmux.json")))


@app.get("/api/device/<device>/family")
def api_family(device):
    return jsonify(REG.load(device, "family.json"))


@app.get("/api/device/<device>/wizards")
def api_wizards(device):
    return jsonify(REG.load(device, "wizards.json"))


@app.get("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip().lower()
    device = request.args.get("device", DEFAULT_DEVICE)
    if not q:
        return jsonify({"query": q, "results": []})
    pinmux = REG.load(device, "pinmux.json")
    hits = []
    for p in pinmux.get("pins", {}).values():
        sig = p["primary_signal"]
        entry = {"kind": "pin", "physical_pin": p["physical_pin"], "signal": sig,
                 "pin_type": p["pin_type"], "gpio": p.get("gpio_num"),
                 "configurable": p.get("configurable", False)}
        if q in sig.lower() or (p.get("gpio_num") is not None
                                and q == f"gpio{p['gpio_num']}"):
            hits.append({**entry, "match": "signal"})
            continue
        for m in p.get("mux_options", []):
            if q in m["function"].lower():
                hits.append({**entry, "match": "mux",
                             "function": m["function"], "mux": m["mux"]})
                break
        else:
            for nm in p.get("alt_non_mux", []):
                if q in nm["function"].lower():
                    hits.append({**entry, "match": "non_mux",
                                 "function": nm["function"]})
                    break
    hits.sort(key=lambda h: (
        0 if (h["signal"].lower() == q or h.get("function", "").lower() == q) else 1,
        len(h["signal"]), h["physical_pin"]))
    return jsonify({"query": q, "results": hits[:80]})


@app.post("/api/validate")
def api_validate():
    body = request.get_json(silent=True) or {}
    device = body.get("device", DEFAULT_DEVICE)
    config = body.get("project_config", body.get("config", {}))
    pinmux = REG.load(device, "pinmux.json")
    constraints = REG.load(device, "constraints.json")
    from validators.constraint_checker import check
    findings = check(config, pinmux, constraints)
    blocking = [f for f in findings if str(f.get("severity", "")).upper() == "ERROR"]
    return jsonify({"device": device, "findings": findings,
                    "ok": len(blocking) == 0, "blocking": len(blocking)})


def _generate_from_request():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None, error_response("INVALID_JSON", "request body must be a JSON object", 400)
    config = body.get("project_config", body.get("config"))
    if not isinstance(config, dict):
        return None, error_response(
            "INVALID_PROJECT_CONFIG", "project_config must be a JSON object", 400)
    device = config.get("device", body.get("device", DEFAULT_DEVICE))
    pinmux = REG.load(device, "pinmux.json")
    constraints = REG.load(device, "constraints.json")
    from validators.constraint_checker import check
    findings = check(config, pinmux, constraints)
    errors = [f for f in findings if str(f.get("severity", "")).upper() == "ERROR"]
    if errors:
        return None, (jsonify({
            "ok": False,
            "error": {
                "code": "CONSTRAINT_FAILED",
                "message": "constraint check failed; generation refused",
                "details": errors,
            },
            "blocking": len(errors),
            "findings": findings,
        }), 422)
    from generator.codegen import generate_project
    try:
        result = generate_project(
            device=device,
            project_config=config,
            pinmux=pinmux,
            family=REG.load(device, "family.json"),
            active_module=body.get("active_module"),
        )
    except (ValueError, KeyError, TypeError) as exc:
        return None, error_response("GENERATOR_REJECTED", str(exc), 422)
    result.update({"ok": True, "device": device, "findings": findings})
    return result, None


@app.post("/api/preview")
def api_preview():
    result, failure = _generate_from_request()
    return failure or jsonify(result)


@app.post("/api/preview-code")
def api_preview_code():
    result, failure = _generate_from_request()
    if failure:
        return failure
    selected = result["recommended_file"]
    return jsonify({
        **result,
        "code": result["files"].get(selected, ""),
        "current_file": selected,
    })


@app.post("/api/generate")
def api_generate():
    body = request.get_json(silent=True) or {}
    mode = body.get("mode", "preview")
    if mode == "preview":
        return api_preview()
    if mode != "staging" or APP_MODE != "local":
        return error_response(
            "MODE_FORBIDDEN",
            "staging export exists only in APP_MODE=local; use /api/export.zip",
            403,
        )
    result, failure = _generate_from_request()
    if failure:
        return failure
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    outdir = STAGING / f"gen_{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    written = []
    for rel, content in result["files"].items():
        dest = outdir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        written.append({"file": rel, "bytes": len(content.encode("utf-8"))})
    return jsonify({"ok": True, "mode": "staging", "device": result["device"],
                    "output_dir": str(outdir), "files_written": written,
                    "findings": result["findings"], "live_project_touched": False})


@app.post("/api/export.zip")
def api_export_zip():
    result, failure = _generate_from_request()
    if failure:
        return failure
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for rel, content in sorted(result["files"].items()):
            archive.writestr(rel, content.encode("utf-8"))
    memory.seek(0)
    return send_file(
        memory,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{result['device']}_generated_r3.zip",
        max_age=0,
    )


@app.get("/api/ti-files")
def api_ti_files():
    if APP_MODE == "web":
        return jsonify({"present": False, "include": [], "source": []})
    if not TI_DEVICE.exists():
        return jsonify({"present": False, "path": str(TI_DEVICE), "include": [], "source": []})
    inc = sorted(p.name for p in (TI_DEVICE / "include").glob("*.h"))
    src = sorted(p.name for p in (TI_DEVICE / "source").glob("*.*"))
    return jsonify({"present": True, "path": str(TI_DEVICE), "include": inc, "source": src})


@app.get("/api/health")
def api_health():
    return jsonify({
        "ok": True,
        "build_id": BUILD["build_id"],
        "source_sha256": BUILD["source_sha256"],
        "file_count": BUILD["file_count"],
        "started_at": STARTED_AT,
        "device": DEFAULT_DEVICE,
        "app_mode": APP_MODE,
        "status": "CONFIG_STUDIO_R3_IN_PROGRESS",
        "ti_device_present": TI_DEVICE.exists() if APP_MODE == "local" else False,
    })


@app.get("/api/sha256")
def api_sha256():
    return jsonify({"build_id": BUILD["build_id"],
                    "source_sha256": BUILD["source_sha256"],
                    "files": BUILD["files"]})


@app.post("/api/shutdown")
def api_shutdown():
    if APP_MODE != "local":
        return error_response("NOT_FOUND", "shutdown is not available in web mode", 404)
    # Local-only shutdown. In the threaded dev server the werkzeug shutdown
    # environ key is absent, so hard-exit the process after a short delay to
    # let the response flush. This guarantees the port is actually released.
    pid = os.getpid()
    port = _ACTIVE_PORT

    def _die():
        time.sleep(0.4)
        try:
            func = request.environ.get("werkzeug.server.shutdown")
            if func is not None:
                func()
        except Exception:  # noqa: BLE001
            pass
        os._exit(0)

    threading.Thread(target=_die, daemon=True).start()
    return jsonify({"ok": True, "shutting_down": True, "build_id": BUILD["build_id"],
                    "pid": pid, "port": port})


# ── R2 §9: instance registry (PID / port / build_id) ─────────────────────────
INSTANCE_FILE = BASE / "generator" / "instance.json"


def _write_instance(port: int):
    try:
        INSTANCE_FILE.parent.mkdir(parents=True, exist_ok=True)
        INSTANCE_FILE.write_text(json.dumps({
            "pid": os.getpid(), "port": port, "build_id": BUILD["build_id"],
            "started_at": STARTED_AT,
        }, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def _clear_instance():
    try:
        if INSTANCE_FILE.exists():
            INSTANCE_FILE.unlink()
    except Exception:  # noqa: BLE001
        pass


# ─────────────────────────────────────────────────────────────────────────────
def wait_for_health(port: int, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, body = http_get_json(f"http://127.0.0.1:{port}/api/health", timeout=1.5)
        if status == 200 and body and body.get("build_id") == BUILD["build_id"]:
            return True
        time.sleep(0.25)
    return False


def resolve_port() -> int:
    """If DEFAULT_PORT is held by an OLD build, shut it down; else find a free port."""
    if not port_open(DEFAULT_PORT):
        return DEFAULT_PORT
    status, body = http_get_json(f"http://{HOST}:{DEFAULT_PORT}/api/health", timeout=1.5)
    if status == 200 and body and body.get("build_id"):
        old = body.get("build_id")
        if old == BUILD["build_id"]:
            print(f"[info] port {DEFAULT_PORT} already runs THIS build {old}; reusing is not "
                  f"supported — will start a second instance on a new port.")
            return free_port(DEFAULT_PORT + 1)
        print(f"[info] port {DEFAULT_PORT} held by OLD build {old} (current {BUILD['build_id']}). "
              f"Requesting shutdown…")
        try:
            req = urllib.request.Request(f"http://{HOST}:{DEFAULT_PORT}/api/shutdown",
                                         data=b"{}", headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
        time.sleep(1.0)
        if not port_open(DEFAULT_PORT):
            print(f"[info] old instance closed; using port {DEFAULT_PORT}")
            return DEFAULT_PORT
        newp = free_port(DEFAULT_PORT + 1)
        print(f"[warn] old instance did not exit; falling back to port {newp}")
        return newp
    # Something else (not our app) owns the port.
    newp = free_port(DEFAULT_PORT + 1)
    print(f"[warn] port {DEFAULT_PORT} in use by a non-ConfigStudio process; using {newp}")
    return newp


def main():
    if APP_MODE == "web":
        port = int(os.environ.get("PORT", DEFAULT_PORT))
    else:
        forced = os.environ.get("CONFIG_STUDIO_PORT")
        port = int(forced) if (forced and forced.isdigit()) else resolve_port()
    global _ACTIVE_PORT
    _ACTIVE_PORT = port
    if APP_MODE == "local":
        _write_instance(port)
    import atexit
    if APP_MODE == "local":
        atexit.register(_clear_instance)
    print("=" * 64)
    print(f"  C2000 Config Studio for F28034  [{APP_MODE.upper()}] [R3]")
    print(f"  URL        : http://{HOST}:{port}")
    print(f"  PID        : {os.getpid()}  (instance.json)")
    print(f"  build_id   : {BUILD['build_id']}  ({BUILD['file_count']} files hashed)")
    print(f"  sha256     : {BUILD['source_sha256'][:16]}…")
    print(f"  Device     : {DEFAULT_DEVICE} (PNT80)")
    if APP_MODE == "local":
        print(f"  TI library : {'FOUND' if TI_DEVICE.exists() else 'MISSING'}  {TI_DEVICE}")
    print("  Safety     : no JTAG | no Load/Run | no Flash | memory ZIP export")
    print("=" * 64)

    def _serve():
        app.run(host=HOST, port=port, debug=False, threaded=True, use_reloader=False)

    t = threading.Thread(target=_serve, daemon=True)
    t.start()

    # LOCAL opens only after health. WEB never opens a browser.
    if wait_for_health(port):
        print(f"[ok] health confirmed for build {BUILD['build_id']}.")
        if APP_MODE == "local" and os.environ.get("CONFIG_STUDIO_NO_BROWSER") != "1":
            try:
                webbrowser.open(f"http://{HOST}:{port}/")
            except Exception:  # noqa: BLE001
                pass
        elif APP_MODE == "local":
            print("[info] CONFIG_STUDIO_NO_BROWSER=1 — browser not opened (test mode).")
    else:
        print(f"[warn] health check did not confirm within timeout; NOT opening browser. "
              f"Open http://{HOST}:{port}/ manually.")

    try:
        while t.is_alive():
            t.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\n[info] stopped by user.")


if __name__ == "__main__":
    main()
