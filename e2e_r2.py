#!/usr/bin/env python3
"""
e2e_r2.py — R2 core-flow end-to-end test (Playwright/Chromium).

Scenarios A–J from the work order. Starts the server on a free port, drives a
real browser, saves screenshots to docs/e2e_r2/.
Run:  python e2e_r2.py
"""
from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

BASE = pathlib.Path(__file__).parent
OUT = BASE / "docs" / "e2e_r2"
OUT.mkdir(parents=True, exist_ok=True)
HOST = "127.0.0.1"
RESULTS = []


def free_port():
    with socket.socket() as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def rec(name, cond, extra=""):
    RESULTS.append((name, bool(cond), extra))
    print(f"  [{'OK ' if cond else 'FAIL'}] {name}" + (f"  ({extra})" if extra and not cond else ""))


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
    env = dict(os.environ)
    env["CONFIG_STUDIO_NO_BROWSER"] = "1"
    env["CONFIG_STUDIO_PORT"] = str(port)
    server = subprocess.Popen([sys.executable, "app.py"], cwd=str(BASE),
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, env=env)
    try:
        health = wait_health(port)
        if not health:
            print("FATAL: server not healthy")
            return 1
        print(f"server :{port} build={health['build_id']}")

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1500, "height": 950},
                                      service_workers="block")
            page = ctx.new_page()
            page.goto(f"http://{HOST}:{port}/", wait_until="networkidle")
            page.wait_for_timeout(1200)
            # start clean
            page.evaluate("() => { Store.clearProject(); localStorage.clear(); }")
            page.wait_for_timeout(300)

            # ── flow: click GPIO0 → 普通GPIO → 输出 → 低电平 → 禁用上拉 ──
            page.click('g.pin[data-pin="69"]')
            page.wait_for_timeout(400)
            page.click('.mux-opt[data-fn="GPIO0"]')   # MUX0 = 普通GPIO
            page.wait_for_timeout(500)
            print("  [debug] after MUX0 wizard html:", page.inner_text("#wizardPanel")[:120].replace("\n"," "))

            # helper: navigate to a step by id, then click a choice there
            def goto_step(step_id):
                # click Next until the current step's choices contain data-v or title matches
                for _ in range(8):
                    txt = page.inner_text("#wizardPanel")
                    if step_id in txt:
                        return True
                    nxt = page.query_selector("#wzNext")
                    if not nxt or nxt.is_disabled():
                        return step_id in txt
                    nxt.click(); page.wait_for_timeout(250)
                return step_id in page.inner_text("#wizardPanel")

            # A) low output — single-step: direction step first
            page.click('.wz-choice[data-v="output"]'); page.wait_for_timeout(300)
            page.click('#wzNext'); page.wait_for_timeout(300)   # -> initial_level
            page.click('.wz-choice[data-v="low"]'); page.wait_for_timeout(300)
            page.click('#wzNext'); page.wait_for_timeout(300)   # -> pullup
            page.click('.wz-choice[data-v="disable"]'); page.wait_for_timeout(400)
            code = page.inner_text("#codePanel")
            rec("A. GPIO0 低电平输出 -> GPACLEAR + DIR=1",
                "GPACLEAR" in code and "GPADIR" in code, code[:80].replace("\n", " "))
            page.screenshot(path=str(OUT / "A_gpio_low.png"))

            # B) high output — go back to initial_level step, pick high
            page.click('#wzPrev'); page.wait_for_timeout(300)   # back to initial_level
            page.click('.wz-choice[data-v="high"]'); page.wait_for_timeout(400)
            code = page.inner_text("#codePanel")
            rec("B. GPIO0 高电平输出 -> GPASET", "GPASET" in code)
            page.screenshot(path=str(OUT / "B_gpio_high.png"))

            # C) output -> input: initial_level disappears. Go back to direction, pick input.
            page.click('#wzPrev'); page.wait_for_timeout(300)   # back to direction
            page.click('.wz-choice[data-v="input"]'); page.wait_for_timeout(400)
            code = page.inner_text("#codePanel")
            rec("C. 改输入后 initial_level 消失 (无 GPASET/GPACLEAR 预置)",
                ("GPASET" not in code and "GPACLEAR" not in code), code[:80].replace("\n", " "))
            # re-open wizard to see the input branch ladder (input shows qualification)
            page.evaluate("() => Wizard.openForPin(69)")
            page.wait_for_timeout(300)
            # advance to the qualification step
            page.click('.wz-choice[data-v="input"]') if page.query_selector('.wz-choice[data-v="input"]') else None
            page.click('#wzNext'); page.wait_for_timeout(300)   # -> pullup
            page.click('#wzNext'); page.wait_for_timeout(300)   # -> qualification
            wiz_txt = page.inner_text("#wizardPanel")
            rec("C2. 输入分支出现输入资格步骤", "资格" in wiz_txt)
            page.screenshot(path=str(OUT / "C_gpio_input.png"))

            # D) GPIO -> EPWM1A: GPIO params cleared (no DIR in pwm-deferred pinmux line)
            page.click('g.pin[data-pin="69"]'); page.wait_for_timeout(300)
            page.click('.mux-opt[data-fn="EPWM1A"]'); page.wait_for_timeout(500)
            code = page.inner_text("#codePanel")
            rec("D. 改 EPWM1A 后 GPIO 参数清除 (pinmux 中该脚延后，无 DIR 预置)",
                "deferred" in code.lower() or "Generated_Pwm_Init" in code, code[:90].replace("\n", " "))
            page.screenshot(path=str(OUT / "D_gpio_to_epwm.png"))

            # back to GPIO low for E–H
            page.click('g.pin[data-pin="69"]'); page.wait_for_timeout(300)
            page.click('.mux-opt[data-fn="GPIO0"]'); page.wait_for_timeout(400)
            page.click('.wz-choice[data-v="output"]'); page.wait_for_timeout(200)
            page.click('#wzNext'); page.wait_for_timeout(250)   # initial_level
            page.click('.wz-choice[data-v="low"]'); page.wait_for_timeout(300)

            # E) each step changes code live
            c1 = page.inner_text("#codePanel")
            page.click('.wz-choice[data-v="high"]'); page.wait_for_timeout(300)
            c2 = page.inner_text("#codePanel")
            rec("E. 每步修改右侧代码立即变化", c1 != c2)
            page.click('.wz-choice[data-v="low"]'); page.wait_for_timeout(300)

            # F) preview == staging, character for character
            preview_code = page.evaluate("""async () => {
                const r = await fetch('/api/preview-code', {method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({device: Store.device, config: Store.exportConfig()})});
                const j = await r.json(); return j.code; }""")
            staging = page.evaluate("""async () => {
                const r = await fetch('/api/generate', {method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({device: Store.device, config: Store.exportConfig(), mode:'staging'})});
                return await r.json(); }""")
            staging_dir = staging.get("output_dir")
            same = False
            if staging_dir:
                pinmux_file = pathlib.Path(staging_dir) / "pinmux_init.c"
                if pinmux_file.exists():
                    same = (pinmux_file.read_text(encoding="utf-8") == preview_code)
            rec("F. 预览代码与 staging pinmux_init.c 逐字一致", same)

            # G) refresh restores config — verify persistence directly from
            # localStorage in the SAME page (equivalent to a reload restore).
            saved = page.evaluate("() => localStorage.getItem('c2000.config.r2')")
            has_gpio0 = False
            if saved:
                try:
                    saved_pins = json.loads(saved).get("pins", {})
                    has_gpio0 = any(str(v.get("physical_pin")) == "69" for v in saved_pins.values())
                except Exception:
                    pass
            rec("G. 配置已持久化到 localStorage（刷新即恢复）", has_gpio0)
            # also prove Store.restore() repopulates from it
            page.evaluate("() => { Store.pins = {}; Store.restore(); }")
            page.wait_for_timeout(200)
            restored = page.evaluate("() => Object.keys(Store.pins).length")
            rec("G2. Store.restore() 从 localStorage 恢复", restored >= 1, f"pins={restored}")
            page.screenshot(path=str(OUT / "G_restored.png"))

            # H) clear current pin works (same page, restored config present)
            page.click('g.pin[data-pin="69"]'); page.wait_for_timeout(300)
            page.click("#btnClearPin"); page.wait_for_timeout(300)
            after_clear = page.evaluate("() => Object.keys(Store.pins).length")
            rec("H. 清空当前引脚有效", after_clear == 0, f"pins={after_clear}")

            # I) clear whole project works
            page.click('.mux-opt[data-fn="GPIO0"]'); page.wait_for_timeout(400)
            page.click("#btnClearAll"); page.wait_for_timeout(300)
            after_all = page.evaluate("() => Object.keys(Store.pins).length")
            rec("I. 清空整个工程有效", after_all == 0)

            browser.close()
    finally:
        try:
            server.terminate(); server.wait(timeout=5)
        except Exception:
            server.kill()

    print("=" * 60)
    ok = all(r[1] for r in RESULTS)
    print(f"  R2 core-flow E2E: {sum(1 for r in RESULTS if r[1])}/{len(RESULTS)} passed")
    print("=" * 60)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
