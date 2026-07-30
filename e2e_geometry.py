#!/usr/bin/env python3
"""e2e_geometry.py — PNT80 corner-pin geometry assertions (R2 geometry fix)."""
import json
import os
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


def wait_health(port, timeout=12):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://{HOST}:{port}/api/health", timeout=1.5) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def main():
    from playwright.sync_api import sync_playwright
    port = free_port()
    env = dict(os.environ)
    env["CONFIG_STUDIO_NO_BROWSER"] = "1"
    env["CONFIG_STUDIO_PORT"] = str(port)
    srv = subprocess.Popen([sys.executable, "app.py"], cwd=str(BASE),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    results = []
    try:
        if not wait_health(port):
            print("FATAL: server not healthy")
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            page = b.new_page(viewport={"width": 1400, "height": 900})
            page.goto(f"http://{HOST}:{port}/", wait_until="networkidle")
            page.wait_for_timeout(1200)

            # For each corner, assert the pin at the geometric extreme of its side.
            # Strategy: compute each side's pin positions from the DOM (rect.pad
            # bounding boxes in SVG coords), find the extreme pin, compare signal.
            corners = page.evaluate("""() => {
              const NS = 'http://www.w3.org/2000/svg';
              const pins = {};
              document.querySelectorAll('g.pin').forEach(g => {
                const p = parseInt(g.getAttribute('data-pin'), 10);
                const sig = g.getAttribute('data-signal');
                const r = g.querySelector('rect.pad');
                const x = parseFloat(r.getAttribute('x'));
                const y = parseFloat(r.getAttribute('y'));
                pins[p] = { sig, x, y };
              });
              const left = [], bottom = [], right = [], top = [];
              for (let p = 1; p <= 80; p++) {
                const d = pins[p]; if (!d) continue;
                if (p <= 20) left.push([p, d]);
                else if (p <= 40) bottom.push([p, d]);
                else if (p <= 60) right.push([p, d]);
                else top.push([p, d]);
              }
              const byY = (a, b) => a[1].y - b[1].y;
              const byX = (a, b) => a[1].x - b[1].x;
              left.sort(byY); bottom.sort(byX); right.sort(byY); top.sort(byX);
              return {
                left_top: left[0], left_bottom: left[left.length-1],
                bottom_left: bottom[0], bottom_right: bottom[bottom.length-1],
                right_top: right[0], right_bottom: right[right.length-1],
                top_left: top[0], top_right: top[top.length-1],
              };
            }""")

            def sig(entry):
                return entry[1]["sig"] if entry else None

            def pinno(entry):
                return entry[0] if entry else None

            checks = [
                ("top-left side = pin1 GPIO22", sig(corners["left_top"]) == "GPIO22" and pinno(corners["left_top"]) == 1),
                ("bottom-left side = pin20 VDDA", sig(corners["left_bottom"]) == "VDDA" and pinno(corners["left_bottom"]) == 20),
                ("bottom-right bottom = pin40 GPIO28", sig(corners["bottom_right"]) == "GPIO28" and pinno(corners["bottom_right"]) == 40),
                ("bottom-right side = pin41 GPIO18", sig(corners["right_bottom"]) == "GPIO18" and pinno(corners["right_bottom"]) == 41),
                ("top-right side = pin60 GPIO36", sig(corners["right_top"]) == "GPIO36" and pinno(corners["right_top"]) == 60),
                ("top-right top = pin61 GPIO11", sig(corners["top_right"]) == "GPIO11" and pinno(corners["top_right"]) == 61),
                ("top-left top = pin80 GPIO24", sig(corners["top_left"]) == "GPIO24" and pinno(corners["top_left"]) == 80),
            ]
            for name, ok in checks:
                results.append((name, ok))
                print(f"  [{'OK ' if ok else 'FAIL'}] {name}")
            print("  [debug] corners:", {k: [v[0], v[1]["sig"]] for k, v in corners.items()})
            b.close()
    finally:
        try:
            srv.terminate(); srv.wait(timeout=5)
        except Exception:
            srv.kill()
    ok = all(r[1] for r in results)
    print("=" * 50)
    print(f"  geometry corners: {sum(1 for r in results if r[1])}/{len(results)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
