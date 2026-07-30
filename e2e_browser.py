#!/usr/bin/env python3
"""
e2e_browser.py — real-browser end-to-end test (Playwright/Chromium).

Starts the Flask server on a free port, drives a headless Chromium through the
work-order §4 scenarios, and saves screenshots + console + network logs.

Run:  python e2e_browser.py
Exit 0 only if every E2E assertion passes.
"""

from __future__ import annotations

import json
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

BASE = pathlib.Path(__file__).parent
OUT = BASE / "docs" / "e2e"
OUT.mkdir(parents=True, exist_ok=True)

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
                    return json.loads(r.read().decode())
        except Exception:
            pass
        time.sleep(0.3)
    return None


def main():
    from playwright.sync_api import sync_playwright

    port = free_port()
    import os
    env = dict(os.environ)
    env["CONFIG_STUDIO_NO_BROWSER"] = "1"
    env["CONFIG_STUDIO_PORT"] = str(port)
    server = subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=str(BASE),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env=env,
    )
    console_log, network_log = [], []
    results = []
    try:
        health = wait_health(port)
        if not health:
            print("FATAL: server did not become healthy")
            return 1
        print(f"server up on :{port} build_id={health['build_id']}")

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1500, "height": 950})

            page.on("console", lambda m: console_log.append(
                {"type": m.type, "text": m.text}))
            page.on("request", lambda r: network_log.append(
                {"phase": "request", "method": r.method, "url": r.url}))
            page.on("response", lambda r: network_log.append(
                {"phase": "response", "status": r.status, "url": r.url}))

            # 1) load home
            page.goto(f"http://{HOST}:{port}/", wait_until="networkidle")
            page.wait_for_timeout(1200)

            # 2) SVG has 80 g.pin
            n_pins = page.eval_on_selector_all("g.pin", "els => els.length")
            results.append(("SVG has 80 g.pin", n_pins == 80, f"got {n_pins}"))
            page.screenshot(path=str(OUT / "01_home.png"), full_page=True)

            # 3) click pin 69 -> detail shows GPIO0
            page.click('g.pin[data-pin="69"]')
            page.wait_for_timeout(500)
            detail = page.inner_text("#detailPanel")
            results.append(("click pin69 shows GPIO0",
                            "GPIO0" in detail, detail[:80].replace("\n", " ")))
            results.append(("pin69 detail mentions EPWM1A",
                            "EPWM1A" in detail, ""))
            page.screenshot(path=str(OUT / "02_pin69.png"))

            # 4) choose EPWM1A -> pin69 highlighted selected (st-sel)
            page.click('.mux-opt[data-fn="EPWM1A"]')
            page.wait_for_timeout(400)
            cls = page.get_attribute('g.pin[data-pin="69"]', "class")
            results.append(("EPWM1A selected -> pin69 st-sel",
                            "st-sel" in (cls or ""), f"class={cls}"))
            code = page.inner_text("#codePanel")
            results.append(("code panel shows GPAMUX1 assignment",
                            "GPAMUX1" in code, ""))
            page.screenshot(path=str(OUT / "03_epwm1a_selected.png"))

            # 5) open GPIO wizard + ePWM wizard
            page.click('#midTabs .tab[data-tab="wizard"]')
            page.wait_for_timeout(300)
            page.click('.wiz-pick[data-k="gpio_output"]')
            page.wait_for_timeout(300)
            gpio_steps = page.eval_on_selector_all("#wizardPanel .wiz-step", "e=>e.length")
            results.append(("GPIO wizard has 7 steps", gpio_steps == 7, f"got {gpio_steps}"))
            page.screenshot(path=str(OUT / "04_wizard_gpio.png"))

            page.click('.wiz-pick[data-k="epwm_complementary"]') if page.query_selector('.wiz-pick[data-k="epwm_complementary"]') else None
            # go back to list first
            back = page.query_selector("#wizBack")
            if back:
                back.click()
                page.wait_for_timeout(200)
            page.click('.wiz-pick[data-k="epwm_complementary"]')
            page.wait_for_timeout(300)
            epwm_steps = page.eval_on_selector_all("#wizardPanel .wiz-step", "e=>e.length")
            results.append(("ePWM wizard has 13 steps", epwm_steps == 13, f"got {epwm_steps}"))
            page.screenshot(path=str(OUT / "05_wizard_epwm.png"))

            # 6) search TZ1 -> pin 47 and 75
            page.fill("#globalSearch", "TZ1")
            page.wait_for_timeout(600)
            search_txt = page.inner_text("#searchPanel")
            has47 = "#47" in search_txt
            has75 = "#75" in search_txt
            results.append(("search TZ1 returns pin47", has47, ""))
            results.append(("search TZ1 returns pin75", has75, ""))
            page.screenshot(path=str(OUT / "06_search_tz1.png"))

            # 7) validate button -> check tab shows findings
            page.click("#btnValidate")
            page.wait_for_timeout(800)
            check_txt = page.inner_text("#checkPanel")
            results.append(("validate produces findings/ok",
                            len(check_txt.strip()) > 0, check_txt[:60].replace("\n", " ")))
            page.screenshot(path=str(OUT / "07_validate.png"))

            # 8) health endpoint build info present
            results.append(("health build_id present", bool(health.get("build_id")),
                            health.get("build_id", "")))

            browser.close()
    finally:
        try:
            server.terminate()
            server.wait(timeout=5)
        except Exception:
            server.kill()

    # write logs
    (OUT / "console.json").write_text(json.dumps(console_log, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / "network.json").write_text(json.dumps(network_log, indent=2, ensure_ascii=False), encoding="utf-8")

    print("=" * 64)
    print("  E2E browser test")
    print("=" * 64)
    allok = True
    for name, ok, extra in results:
        print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f"  ({extra})" if extra and not ok else ""))
        allok = allok and ok
    print("=" * 64)
    # surface console errors
    errs = [c for c in console_log if c["type"] in ("error",)]
    if errs:
        print(f"  console errors: {len(errs)}")
        for e in errs[:8]:
            print("   ", e["text"][:120])
    net_errs = [n for n in network_log if n.get("phase") == "response" and n.get("status", 200) >= 400]
    if net_errs:
        print(f"  network >=400: {len(net_errs)}")
        for n in net_errs[:8]:
            print(f"    {n['status']} {n['url']}")
    else:
        print("  no network responses >= 400")
    print("=" * 64)
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
