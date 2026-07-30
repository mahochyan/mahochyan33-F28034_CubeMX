#!/usr/bin/env python3
"""e2e_epwm_pair.py — ePWM A/B pairing E2E (work-order A–H)."""
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
    RESULTS.append(bool(cond))
    print(f"  [{'OK ' if cond else 'FAIL'}] {name}" + (f"  ({extra})" if extra and not cond else ""))


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
    try:
        if not wait_health(port):
            print("FATAL: server not healthy")
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            page = b.new_page(viewport={"width": 1500, "height": 950})
            page.goto(f"http://{HOST}:{port}/", wait_until="networkidle")
            page.wait_for_timeout(1200)
            page.evaluate("() => { Store.clearProject(); localStorage.clear(); }")
            page.wait_for_timeout(300)

            # A) select EPWM1A on pin69 -> wizard offers pair_mode, partner highlighted
            page.click('g.pin[data-pin="69"]'); page.wait_for_timeout(400)
            page.click('.mux-opt[data-fn="EPWM1A"]'); page.wait_for_timeout(500)
            wiz = page.inner_text("#wizardPanel")
            rec("A. 选 EPWM1A 后向导提示 单路/互补", "互补" in wiz and "单路" in wiz)
            page.click('.wz-choice[data-v="complementary"]'); page.wait_for_timeout(400)
            wiz = page.inner_text("#wizardPanel")
            rec("A2. 提示配对 EPWM1B 引脚", "配对" in wiz or "EPWM1B" in wiz)

            # B) confirm (下一步) -> pin69 & pin68 both green (st-sel)
            page.click('#wzNext'); page.wait_for_timeout(500)
            cls69 = page.get_attribute('g.pin[data-pin="69"]', "class") or ""
            cls68 = page.get_attribute('g.pin[data-pin="68"]', "class") or ""
            rec("B. 确认后 pin69 和 pin68 同时变绿",
                "st-sel" in cls69 and "st-sel" in cls68,
                f"69={cls69} 68={cls68}")
            page.screenshot(path=str(OUT / "pair_formed.png"))

            # helper: navigate wizard forward until a #wzNum with a given default is shown
            def goto_number_step(default_val):
                for _ in range(10):
                    num = page.query_selector('#wzNum')
                    if num:
                        return True
                    nxt = page.query_selector('#wzNext')
                    if not nxt or nxt.is_disabled():
                        return False
                    nxt.click(); page.wait_for_timeout(250)
                return page.query_selector('#wzNum') is not None

            # C) change frequency -> both share (group param)
            goto_number_step(100000)
            page.fill('#wzNum', '120000'); page.wait_for_timeout(400)
            both = page.evaluate("""() => {
              const a = Store.getPin(69), b = Store.getPin(68);
              return {a: a && a.freq_hz, b: b && b.freq_hz, grp: a && a.group};
            }""")
            rec("C. 改频率两路共同更新", both["a"] == 120000 and both["b"] == 120000,
                str(both))

            # D) change dead-band -> both share
            # move forward to the deadband number step (skip duty/aq)
            page.click('#wzNext'); page.wait_for_timeout(250)   # duty (number) - skip
            page.click('#wzNext'); page.wait_for_timeout(250)   # aq (choice) - skip
            page.click('#wzNext'); page.wait_for_timeout(250)   # deadband (number)
            if page.query_selector('#wzNum'):
                page.fill('#wzNum', '250'); page.wait_for_timeout(400)
            db = page.evaluate("() => ({a: Store.getPin(69).dead_ns, b: Store.getPin(68).dead_ns})")
            rec("D. 改死区两路共同更新", db["a"] == 250 and db["b"] == 250, str(db))

            # E) delete A -> ask to release whole group
            page.evaluate("() => { window.__asked = false; Bus.on('pair:release-ask', () => { window.__asked = true; }); }")
            page.evaluate("() => Store.clearPin(69)")
            page.wait_for_timeout(300)
            asked = page.evaluate("() => window.__asked")
            rec("E. 删除 A 时提示解除整个互补组", asked is True)
            # actually release group
            page.evaluate("() => Store.clearGroup('G_EPWM1')")
            page.wait_for_timeout(200)
            after = page.evaluate("() => ({a: !!Store.getPin(69), b: !!Store.getPin(68)})")
            rec("E2. 解除后 A/B 均被清除", not after["a"] and not after["b"])

            # F) EPWM1A + EPWM2B complementary -> blocked (422)
            page.evaluate("""() => {
              Store.setPinField(69, {mux:1, function:'EPWM1A', mode:'epwm', pair_mode:'complementary', group:'G_X', dead_ns:200, trip:'ost_clamp'});
              Store.setPinField(67, {mux:1, function:'EPWM2A', mode:'epwm', pair_mode:'complementary', group:'G_X', dead_ns:200, trip:'ost_clamp'});
            }""")
            resp = page.evaluate("""async () => {
              const r = await fetch('/api/validate', {method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({device: Store.device, config: Store.exportConfig()})});
              return await r.json(); }""")
            rules = [f["rule"] for f in resp.get("findings", [])]
            rec("F. EPWM1A+EPWM2x 被阻止 (CROSS_MODULE)", "EPWM_PAIR_CROSS_MODULE" in rules,
                ",".join(rules))
            page.evaluate("() => Store.clearProject()"); page.wait_for_timeout(200)

            # G) export contains both GPIO0 and GPIO1 mux
            page.evaluate("""() => {
              Store.setPinField(69, {mux:1, function:'EPWM1A', mode:'epwm', pair_mode:'complementary', group:'G_EPWM1', freq_hz:100000, count_mode:'up_down', duty:0.5, aq:'set_cau_clear_cad', dead_ns:200, trip:'ost_clamp'});
              Store.setPinField(68, {mux:1, function:'EPWM1B', mode:'epwm', pair_mode:'complementary', group:'G_EPWM1', derived:true, freq_hz:100000, count_mode:'up_down', duty:0.5, aq:'set_cau_clear_cad', dead_ns:200, trip:'ost_clamp'});
            }""")
            gen = page.evaluate("""async () => {
              const r = await fetch('/api/generate', {method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({device: Store.device, config: Store.exportConfig(), mode:'preview'})});
              return await r.json(); }""")
            pwm = (gen.get("files") or {}).get("pwm_init.c", "")
            rec("G. 导出代码同时包含 GPIO0 和 GPIO1 MUX",
                "GPIO0 = 1" in pwm and "GPIO1 = 1" in pwm)

            # H) only EPwm1Regs, not a wrong module
            rec("H. 只生成 EPwm1Regs，不生成错误模块",
                "EPwm1Regs" in pwm and "EPwm2Regs" not in pwm and "EPwm3Regs" not in pwm)

            b.close()
    finally:
        try:
            srv.terminate(); srv.wait(timeout=5)
        except Exception:
            srv.kill()
    print("=" * 56)
    ok = all(RESULTS)
    print(f"  ePWM pairing E2E: {sum(RESULTS)}/{len(RESULTS)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
