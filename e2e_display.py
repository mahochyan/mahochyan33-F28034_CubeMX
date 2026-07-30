#!/usr/bin/env python3
"""e2e_display.py — pin display-spec assertions (R2 display unification)."""
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

            # §8.1: every pin body shows ONLY "number + primary name"
            probe = page.evaluate("""() => {
              const out = {badId: [], fnInside: [], fourSidesOk: true, sample: {}};
              document.querySelectorAll('g.pin').forEach(g => {
                const p = g.getAttribute('data-pin');
                const sig = g.getAttribute('data-signal');
                const id = g.querySelector('text.id');
                const fn = g.querySelector('text.fn');
                // identity must contain number + primary name only
                if (!id) { out.badId.push(p + ':no-id'); return; }
                const txt = id.textContent.trim();
                if (!(txt.includes(p) && txt.includes(sig))) out.badId.push(p + ':' + txt);
                // identity must NOT contain any alternate function token
                if (fn && id.textContent.includes(fn.textContent) && fn.textContent.length>0) {
                  out.fnInside.push(p);
                }
                if (['69','7','9','68'].includes(p)) out.sample[p] = {id: txt, fn: fn?fn.textContent:''};
              });
              return out;
            }""")
            rec("任意引脚内部只出现 序号+主名称", len(probe["badId"]) == 0,
                ",".join(probe["badId"][:5]))
            rec("复用功能不在引脚内部 (id 与 fn 分离)", len(probe["fnInside"]) == 0,
                ",".join(probe["fnInside"][:5]))
            print("  [sample]", probe["sample"])

            # §8.2: function list lives OUTSIDE the pin body (fn text present for mux pins)
            fnCount = page.eval_on_selector_all("g.pin text.fn", "e=>e.length")
            rec("复用功能显示在引脚外侧 (有 .fn 外侧标签)", fnCount > 0, f"fn labels={fnCount}")

            # §8.3: four sides consistent — each side has id inside + fn outside
            sides = page.evaluate("""() => {
              const res = {left:{id:0,fn:0}, right:{id:0,fn:0}, top:{id:0,fn:0}, bottom:{id:0,fn:0}};
              document.querySelectorAll('g.pin').forEach(g => {
                const p = parseInt(g.getAttribute('data-pin'),10);
                const side = p<=20?'left':(p<=40?'bottom':(p<=60?'right':'top'));
                if (g.querySelector('text.id')) res[side].id++;
                if (g.querySelector('text.fn')) res[side].fn++;
              });
              return res;
            }""")
            all_id = all(sides[s]["id"] == 20 for s in sides)
            rec("四边布局一致：每边20个 identity 标签", all_id, json.dumps(sides))

            # §8.4: select a pin -> detail shows id/primary/mux/selected + code
            page.click('g.pin[data-pin="69"]')
            page.wait_for_timeout(400)
            detail = page.inner_text("#detailPanel")
            rec("选 pin 后右侧展示 主名称+复用功能",
                "GPIO0" in detail and "EPWM1A" in detail)
            page.click('.mux-opt[data-fn="GPIO0"]'); page.wait_for_timeout(500)
            code = page.inner_text("#codePanel")
            rec("选功能后能继续生成代码", "GPAMUX1" in code or "Generated" in code)
            page.screenshot(path=str(OUT / "display_spec.png"))

            # corner geometry still correct after redraw
            corners = page.evaluate("""() => {
              const pins = {};
              document.querySelectorAll('g.pin').forEach(g => {
                pins[parseInt(g.getAttribute('data-pin'),10)] = g.getAttribute('data-signal');
              });
              return {p1: pins[1], p20: pins[20], p40: pins[40], p41: pins[41],
                      p60: pins[60], p61: pins[61], p80: pins[80]};
            }""")
            rec("几何映射保持 (1=GPIO22,80=GPIO24)",
                corners["p1"] == "GPIO22" and corners["p80"] == "GPIO24")
            b.close()
    finally:
        try:
            srv.terminate(); srv.wait(timeout=5)
        except Exception:
            srv.kill()
    print("=" * 50)
    ok = all(RESULTS)
    print(f"  display-spec E2E: {sum(RESULTS)}/{len(RESULTS)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
