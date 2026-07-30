#!/usr/bin/env python3
"""R3 real-browser acceptance gate against Waitress web mode."""

from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "r3_e2e"
OUT.mkdir(parents=True, exist_ok=True)
HOST = "127.0.0.1"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_health(port: int, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://{HOST}:{port}/api/health", timeout=1.0
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and payload.get("ok"):
                    return payload
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Waitress health check timed out")


def next_step(page) -> None:
    page.locator('.inline-wizard [data-action="next"]').click()


def configure_epwm(page) -> None:
    page.locator(
        'details.function-group:has(.function-node[data-function="EPWM1A"]) > summary'
    ).click()
    page.locator('.function-node[data-function="EPWM1A"] .function-row').click()
    page.locator('.inline-wizard select[data-field="selectedPin"]').select_option("69")
    next_step(page)
    next_step(page)  # complementary
    page.locator('.inline-wizard input[data-field="frequency_hz"]').fill("120000")
    next_step(page)
    next_step(page)  # up/down
    page.locator('.inline-wizard input[data-field="duty"]').fill("0.45")
    next_step(page)
    next_step(page)  # AQ
    page.locator('.inline-wizard input[data-field="red_ns"]').fill("180")
    next_step(page)
    page.locator('.inline-wizard input[data-field="fed_ns"]').fill("220")
    next_step(page)
    next_step(page)  # Trip enabled
    next_step(page)  # TZ1
    next_step(page)  # one-shot
    expect(page.locator(".draft-ok")).to_contain_text("草稿可以提交")
    page.locator('.inline-wizard [data-action="finish"]').click()
    expect(page.locator("#statusText")).to_contain_text("原子提交")


def configure_scla(page) -> None:
    page.locator(
        'details.function-group:has(.function-node[data-function="SCLA"]) > summary'
    ).click()
    page.locator('.function-node[data-function="SCLA"] .function-row').click()
    page.locator('.inline-wizard select[data-field="selectedPin"]').select_option("34")
    next_step(page)
    expect(page.locator(".draft-summary")).to_contain_text("板上必须有外部上拉电阻")
    page.locator('.inline-wizard [data-action="finish"]').click()


def assert_geometry(page) -> None:
    result = page.evaluate(
        """() => {
          const svg = document.querySelector('#chip-svg');
          const body = document.querySelector('#chip-body').getBBox();
          const pins = [...document.querySelectorAll('g.pin')];
          const sb = svg.getBoundingClientRect();
          const errors = [];
          const outerBySide = {left: [], right: [], top: [], bottom: []};
          for (const pin of pins) {
            const r = pin.getBoundingClientRect();
            if (r.left < sb.left - 1 || r.right > sb.right + 1 ||
                r.top < sb.top - 1 || r.bottom > sb.bottom + 1) {
              errors.push(`Pin${pin.dataset.pin}:outside-svg`);
            }
            const padSvg = pin.querySelector('.pad').getBBox();
            const side = pin.dataset.side;
            const edgeError = side === 'left' ? Math.abs(padSvg.x + padSvg.width - body.x)
              : side === 'right' ? Math.abs(padSvg.x - (body.x + body.width))
              : side === 'top' ? Math.abs(padSvg.y + padSvg.height - body.y)
              : Math.abs(padSvg.y - (body.y + body.height));
            if (edgeError > 0.5) errors.push(`Pin${pin.dataset.pin}:body-gap=${edgeError}`);
            const inner = pin.querySelector('.identity');
            if (inner) {
              const i = inner.getBoundingClientRect();
              const pad = pin.querySelector('.pad').getBoundingClientRect();
              if (i.left < pad.left - 1 || i.right > pad.right + 1 ||
                  i.top < pad.top - 1 || i.bottom > pad.bottom + 1) {
                errors.push(`Pin${pin.dataset.pin}:identity-outside-pad`);
              }
            }
            const outer = pin.querySelector('.outer-function');
            if (outer) {
              const o = outer.getBoundingClientRect();
              const pad = pin.querySelector('.pad').getBoundingClientRect();
              const wrongSide = side === 'left' ? o.right > pad.left + 1
                : side === 'right' ? o.left < pad.right - 1
                : side === 'top' ? o.bottom > pad.top + 1
                : o.top < pad.bottom - 1;
              if (wrongSide) errors.push(`Pin${pin.dataset.pin}:outer-wrong-side`);
              outerBySide[side].push({pin: pin.dataset.pin, ...o.toJSON()});
            }
          }
          for (const entries of Object.values(outerBySide)) {
            for (let a = 0; a < entries.length; a++) {
              for (let b = a + 1; b < entries.length; b++) {
                const x = entries[a], y = entries[b];
                const overlap = Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 &&
                  Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5;
                if (overlap) errors.push(`Pin${x.pin}/Pin${y.pin}:outer-overlap`);
              }
            }
          }
          return {count: pins.length, errors};
        }"""
    )
    assert result["count"] == 80, result
    assert not result["errors"], result


def main() -> int:
    port = free_port()
    env = dict(os.environ)
    env.update({"APP_MODE": "web", "PORT": str(port)})
    server_log = OUT / "e2e_web_waitress.log"
    network: list[dict] = []
    console: list[dict] = []
    with server_log.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "waitress",
                f"--listen={HOST}:{port}",
                "--threads=4",
                "app:app",
            ],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            health = wait_health(port)
            assert health["app_mode"] == "web"
            assert health["status"] == "CONFIG_STUDIO_R3_IN_PROGRESS"
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                context = browser.new_context(
                    viewport={"width": 1920, "height": 1080},
                    accept_downloads=True,
                )
                page = context.new_page()
                page.on(
                    "console",
                    lambda msg: console.append({"type": msg.type, "text": msg.text}),
                )
                page.on(
                    "response",
                    lambda response: network.append(
                        {"status": response.status, "url": response.url}
                    ),
                )
                page.goto(f"http://{HOST}:{port}/", wait_until="networkidle")
                page.evaluate("localStorage.clear()")
                page.reload(wait_until="networkidle")

                expect(page.locator("#statusText")).to_contain_text("WEB 模式")
                assert page.locator("g.pin").count() == 80
                corners = page.evaluate(
                    """() => Object.fromEntries(
                      [1,20,21,40,41,60,61,80].map(n => {
                        const p = document.querySelector(`g.pin[data-pin="${n}"]`);
                        return [n, [p.dataset.side, p.dataset.signal]];
                      }))"""
                )
                assert corners == {
                    "1": ["left", "GPIO22"],
                    "20": ["left", "VDDA"],
                    "21": ["bottom", "VSSA"],
                    "40": ["bottom", "GPIO28"],
                    "41": ["right", "GPIO18"],
                    "60": ["right", "GPIO36"],
                    "61": ["top", "GPIO11"],
                    "80": ["top", "GPIO24"],
                }, corners
                for width, height, filename in (
                    (1920, 1080, "13_geometry_1920x1080.png"),
                    (1366, 768, "14_geometry_1366x768.png"),
                    (2560, 1440, "15_geometry_2560x1440.png"),
                ):
                    page.set_viewport_size({"width": width, "height": height})
                    assert_geometry(page)
                    page.screenshot(path=OUT / filename)
                page.set_viewport_size({"width": 1920, "height": 1080})

                configure_epwm(page)
                page.locator('#rightTabs [data-tab="code"]').click()
                expect(page.locator("#currentCodeFile")).to_have_text("pwm_init.c")
                code = page.locator("#codePanel").inner_text()
                for needle in (
                    "TBPRD = 250U",
                    "CMPA.half.CMPA = 138U",
                    "DBRED = 11U",
                    "DBFED = 13U",
                    "OSHT1 = 1U",
                    "TZCTL.bit.TZA = 2U",
                    "TZCTL.bit.TZB = 2U",
                ):
                    assert needle in code, needle
                (OUT / "generated_epwm_pwm_init.c").write_text(
                    code.rstrip() + "\n", encoding="utf-8"
                )
                page.screenshot(path=OUT / "16_epwm_committed_code.png")

                page.reload(wait_until="networkidle")
                page.locator('#midTabs [data-tab="assigned"]').click()
                assigned = page.locator("#assignedPanel").inner_text()
                for needle in ("Pin47", "Pin68", "Pin69"):
                    assert needle in assigned, assigned
                page.screenshot(path=OUT / "17_epwm_persisted_assigned.png")

                # Edit a committed module, change only the draft, then cancel.
                page.locator('.assigned-item[data-pin="69"] > summary').click()
                page.locator('.assigned-item[data-pin="69"] [data-action="edit"]').click()
                while (
                    page.locator(
                        '.inline-wizard input[data-field="frequency_hz"]'
                    ).count()
                    == 0
                ):
                    next_step(page)
                page.locator(
                    '.inline-wizard input[data-field="frequency_hz"]'
                ).fill("130000")
                page.locator('.inline-wizard [data-action="cancel"]').click()
                expect(page.locator("#statusText")).to_contain_text(
                    "committed ProjectConfig 未改变"
                )
                page.screenshot(path=OUT / "18_epwm_cancel_preserved.png")

                page.on("dialog", lambda dialog: dialog.accept())
                page.locator("#btnClearAll").click()
                page.reload(wait_until="networkidle")
                configure_scla(page)
                page.locator('#rightTabs [data-tab="code"]').click()
                expect(page.locator("#currentCodeFile")).to_have_text("pinmux_init.c")
                expect(page.locator("#codePanel")).to_contain_text(
                    "GPAMUX2.bit.GPIO29 = 2U"
                )
                pinmux_code = page.locator("#codePanel").inner_text()
                for needle in (
                    "GPAMUX2.bit.GPIO29 = 2U",
                    "GPAPUD.bit.GPIO29 = 0U",
                    "GPAQSEL2.bit.GPIO29 = 3U",
                    "external pull-up resistors are required",
                ):
                    assert needle in pinmux_code, needle
                page.screenshot(path=OUT / "19_scla_generated_code.png")

                page.locator("#btnValidate").click()
                expect(page.locator("#statusText")).to_have_text("校验通过")
                expect(page.locator("#checkPanel")).to_contain_text("未发现阻断项")
                page.screenshot(path=OUT / "20_validation_pass.png")

                with page.expect_download() as download_info:
                    page.locator("#btnExport").click()
                download = download_info.value
                with tempfile.TemporaryDirectory() as temp_dir:
                    zip_path = pathlib.Path(temp_dir) / download.suggested_filename
                    download.save_as(zip_path)
                    with zipfile.ZipFile(zip_path) as archive:
                        names = set(archive.namelist())
                        assert "pinmux_init.c" in names
                        assert (
                            archive.read("pinmux_init.c").decode("utf-8")
                            == pinmux_code.rstrip() + "\n"
                        )
                        evidence_dir = OUT / "generated_scla_zip"
                        evidence_dir.mkdir(exist_ok=True)
                        for name in names:
                            if name.endswith((".c", ".h", ".json", ".md")):
                                (evidence_dir / name).write_bytes(archive.read(name))
                expect(page.locator("#statusText")).to_contain_text(
                    "服务器无 staging 残留"
                )
                page.screenshot(
                    path=OUT / "06_automated_web_acceptance.png", full_page=True
                )
                context.close()
                browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()

    (OUT / "e2e_web_network.json").write_text(
        json.dumps(network, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "e2e_web_console.json").write_text(
        json.dumps(console, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    http_errors = [item for item in network if item["status"] >= 400]
    console_errors = [item for item in console if item["type"] == "error"]
    assert not http_errors, http_errors
    assert not console_errors, console_errors
    print(
        "R3 real-browser WEB flow PASS: ePWM atomic commit/cancel/persistence, "
        "SCLA, generated code, validation, ZIP download, geometry"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
