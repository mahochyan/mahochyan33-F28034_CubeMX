# WTOOL-C2000-CONFIG-R3-WEB-CORE Delivery Record

## Current status

`CONFIG_STUDIO_R3_IN_PROGRESS`

This status is intentionally not promoted to `R3_INTERNAL_PASS`: Docker/Compose
cannot be built on this machine because neither Docker nor Podman is installed.
User acceptance also remains a separate final gate.

Current machine handoff URL: `http://127.0.0.1:5194/`

- Runtime: Waitress WSGI
- Mode: `web`
- Build ID: `2c2eea3220e3`
- Health status: `CONFIG_STUDIO_R3_IN_PROGRESS`

## Scope discipline

- No new chip was added.
- No new peripheral was added.
- The F28035 skeleton is hidden from the selectable Web device list.
- Work was limited to ProjectConfig, generator semantics, MUX evidence,
  inline wizard, PNT80 package geometry, Web runtime and acceptance evidence.

## Implemented R3 core

1. One committed `ProjectConfig` plus a disposable draft editor.
2. Atomic complementary ePWM A/B/Trip submission.
3. One deterministic generator core for preview and ZIP.
4. Per-option MUX evidence fields and generated evidence reports.
5. Function-tree inline single-step editor; only one editor is active.
6. Package-driven top-view PNT80 drawing with 80 physical pads.
7. Waitress Web mode, health endpoint and in-memory ZIP export.
8. Local start/stop registry retains real PID, port and build identity.

## Real-browser acceptance evidence

The acceptance flow used Chromium against the running page, not an HTTP-only
test and not the historical 43 unit tests.

- ePWM1A selected from the function tree.
- Pin69 selected; complementary Pin68 and TZ1 Pin47 committed atomically.
- `120 kHz`, up/down, duty `45%`, RED/FED `180/220 ns`, one-shot TZ1 verified
  in the visible generated `pwm_init.c`.
- Browser refresh preserved the committed module.
- Editing to `130 kHz` and pressing Cancel preserved the committed `120 kHz`.
- SCLA was configured to Pin34; visible code showed GPIO29/MUX2, pull-up enabled
  and asynchronous qualification.
- Browser validation reported no blocking findings.
- Browser ZIP download succeeded and the downloaded `pinmux_init.c` matched the
  preview bytes.
- 1920×1080, 1366×768 and 2560×1440 geometry checks found 80 pads with no
  identity/body boundary or outer-text overlap errors.

Artifacts are under `docs/r3_e2e/`, including screenshots, browser network log,
browser console log and Waitress log.

The three automated geometry screenshots are:

- `13_geometry_1920x1080.png`
- `14_geometry_1366x768.png`
- `15_geometry_2560x1440.png`

The continuous workflow evidence is:

- `16_epwm_committed_code.png`
- `17_epwm_persisted_assigned.png`
- `18_epwm_cancel_preserved.png`
- `19_scla_generated_code.png`
- `20_validation_pass.png`

## Automated gates

| Gate | Result |
|---|---|
| Legacy + R3 unit/semantic suite | 50 total, 49 passed, 1 skipped |
| Bounding-box geometry tests | 2 passed |
| Preview vs ZIP byte identity | passed |
| TI cl2000 compile/link | 6 scenarios, 0 errors |
| Waitress Web boundary checks | passed |
| Real Chromium Web user flow | passed |
| Docker image build | blocked: runtime not installed |

## Remaining acceptance

1. Install/enable Docker Desktop or another OCI builder and run the commands in
   `docs/DEPLOY_WEB.md`.
2. Run one user-operated browser acceptance on the deployed URL.
3. Only after those two gates may the status be promoted.
