#!/usr/bin/env python3
"""
ccs_build_check.py — compile every generated .c with the TI C2000 compiler
(cl2000.exe) across the 6 work-order scenarios, and report errors.

This is a fast pre-CCS gate. The authoritative CCS21 `buildProject` log is
produced separately (needs the CCS project). This script catches syntax /
symbol errors immediately and is fully offline.

Usage:  python ccs_build_check.py
Exit 0 only if every scenario's sources compile with 0 errors.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

BASE = pathlib.Path(__file__).parent
CG = pathlib.Path(r"C:\ti\ccs2100\ccs\tools\compiler\ti-cgt-c2000_25.11.1.LTS")
CL2000 = CG / "bin" / "cl2000.exe"
NM2000 = CG / "bin" / "nm2000.exe"
TI_INC = pathlib.Path(r"D:\CCS21_workspace\LLC_100W_F28034\device\include")
TI_SRC = pathlib.Path(r"D:\CCS21_workspace\LLC_100W_F28034\device\source")
# The working project links TI-COFF (its Debug/*.obj are TI-COFF), so the
# generated code is compiled with --abi=coffabi to match the project's ABI.
ABI = "--abi=coffabi"
LINK_CMDS = [
    pathlib.Path(r"D:\CCS21_workspace\LLC_100W_F28034\28034_RAM_lnk.cmd"),
    pathlib.Path(r"D:\CCS21_workspace\LLC_100W_F28034\DSP2803x_Headers_nonBIOS.cmd"),
]
TI_SUPPORT_C = [
    "DSP2803x_SysCtrl.c", "DSP2803x_Gpio.c", "DSP2803x_EPwm.c",
    "DSP2803x_Adc.c", "DSP2803x_PieCtrl.c", "DSP2803x_PieVect.c",
    "DSP2803x_GlobalVariableDefs.c",
]
TI_SUPPORT_ASM = ["DSP2803x_usDelay.asm", "DSP2803x_DefaultIsr.asm"]
CPUTIMERS = pathlib.Path(
    r"D:\1POWERlearning\program_LLC\CSS024DV2.1_2Z2P\common\source\DSP2803x_CpuTimers.c")
WORK = pathlib.Path.home() / "AppData/Local/Temp/opencode/ccsbuild"

def base_project():
    return {
        "schema_version": 3,
        "device": "TMS320F28034",
        "package": "PNT80",
        "system_clock": None,
        "pins": {},
        "pwm_modules": {},
        "adc": None,
        "timers": {},
        "protection": None,
    }


GPIO_ONLY = base_project()
GPIO_ONLY["pins"] = {
    "78": {"physical_pin": 78, "signal": "GPIO20", "gpio_num": 20,
           "function": "GPIO20", "mux": 0, "direction": "output",
           "initial_level": "low", "pullup": "disable"},
    "79": {"physical_pin": 79, "signal": "GPIO21", "gpio_num": 21,
           "function": "GPIO21", "mux": 0, "direction": "output",
           "initial_level": "high", "pullup": "disable"},
}

CLOCK_60 = base_project()
CLOCK_60["system_clock"] = {"mode": "configure", "target_mhz": 60, "sysclk_hz": 60_000_000}

EPWM_COMPLEMENTARY = base_project()
EPWM_COMPLEMENTARY["pins"] = {
    "69": {"physical_pin": 69, "signal": "GPIO0", "gpio_num": 0,
           "function": "EPWM1A", "mux": 1, "module": "EPWM1"},
    "68": {"physical_pin": 68, "signal": "GPIO1", "gpio_num": 1,
           "function": "EPWM1B", "mux": 1, "module": "EPWM1", "derived": True},
    "47": {"physical_pin": 47, "signal": "GPIO12", "gpio_num": 12,
           "function": "TZ1n", "mux": 1, "electrical_profile": "trip_async_input"},
}
EPWM_COMPLEMENTARY["pwm_modules"] = {
    "EPWM1": {
        "mode": "complementary", "pin_a": 69, "pin_b": 68,
        "source_channel": "A", "derived_channel": "B",
        "count_mode": "up_down", "frequency_hz": 100000, "duty": 0.5,
        "aq_profile": "set_cau_clear_cad",
        "deadband": {"enabled": True, "red_ns": 200, "fed_ns": 200},
        "trip": {"enabled": True, "source": "TZ1", "mode": "one_shot"},
    }
}

ADC_SOC = base_project()
ADC_SOC["adc"] = {
    "soc": 0, "acqps": 14, "channel": "ADCINA0", "trigger": "epwm1_soca",
}

TIMER_20US = base_project()
TIMER_20US["timers"] = {
    "TIMER0": {"period_us": 20, "isr": "cpu_timer0_isr",
               "enable_global_interrupt": False}
}

FULL_INIT = base_project()
FULL_INIT["system_clock"] = {"mode": "configure", "target_mhz": 60, "sysclk_hz": 60_000_000}
FULL_INIT["pins"] = {
    **EPWM_COMPLEMENTARY["pins"],
    "78": {"physical_pin": 78, "signal": "GPIO20", "gpio_num": 20,
           "function": "GPIO20", "mux": 0, "direction": "output",
           "initial_level": "low", "pullup": "disable"},
}
FULL_INIT["pwm_modules"] = EPWM_COMPLEMENTARY["pwm_modules"]
FULL_INIT["adc"] = ADC_SOC["adc"]
FULL_INIT["timers"] = TIMER_20US["timers"]

SCENARIOS = {
    "gpio_only": GPIO_ONLY,
    "clock_60mhz": CLOCK_60,
    "epwm_complementary": EPWM_COMPLEMENTARY,
    "adc_soc": ADC_SOC,
    "timer_20us": TIMER_20US,
    "full_init": FULL_INIT,
}


def load_db():
    import json
    part = BASE / "devices/ti/c2000/parts/tms320f28034"
    pinmux = json.loads((part / "pinmux.json").read_text(encoding="utf-8"))
    constraints = json.loads((part / "constraints.json").read_text(encoding="utf-8"))
    family = json.loads((BASE / "devices/ti/c2000/f2803x/family.json").read_text(encoding="utf-8"))
    return pinmux, constraints, family


def _run(cmd, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=str(cwd) if cwd else None)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def compile_file(src: pathlib.Path, work: pathlib.Path) -> tuple[int, str]:
    obj = work / (src.stem + ".obj")
    cmd = [
        str(CL2000), "-v28", "-ml", "-mt", "--float_support=fpu32", ABI,
        "-O0", "-g",
        f"--include_path={TI_INC}", f"--include_path={work}", "--include_path=.",
        "--compile_only", "--display_error_number",
        src.name, f"--output_file={obj.name}",
    ]
    rc, out = _run(cmd, cwd=work)
    nerr = 0
    for ln in out.splitlines():
        low = ln.lower()
        if "error" in low and ("#" in low or "error:" in low):
            nerr += 1
    if rc != 0 and nerr == 0:
        nerr = 1
        out += f"\n[exit code {rc}]"
    return nerr, out


def compile_file_ti(src: pathlib.Path, work: pathlib.Path) -> tuple[int, str]:
    """Compile a TI support .c (absolute path) into the scenario dir."""
    obj = work / (src.stem + ".obj")
    cmd = [str(CL2000), "-v28", "-ml", "-mt", "--float_support=fpu32", ABI,
           "-O0", f"--include_path={TI_INC}", "--compile_only",
           str(src), f"--output_file={obj}"]
    rc, out = _run(cmd, cwd=work)
    nerr = sum(1 for ln in out.splitlines()
               if "error" in ln.lower() and ("#" in ln.lower() or "error:" in ln.lower()))
    if rc != 0 and nerr == 0:
        nerr = 1
    return nerr, out


def assemble_file(src: pathlib.Path, work: pathlib.Path) -> tuple[int, str]:
    obj = work / (src.stem + ".obj")
    cmd = [str(CL2000), "-v28", "-ml", "-mt", "--float_support=fpu32", ABI,
           f"--include_path={TI_INC}", f"--include_path={TI_SRC}",
           str(src), f"--output_file={obj}"]
    rc, out = _run(cmd, cwd=work)
    nerr = sum(1 for ln in out.splitlines()
               if "error" in ln.lower() and ("#" in ln.lower() or "error:" in ln.lower()))
    if rc != 0 and nerr == 0:
        nerr = 1
    return nerr, out


def link_scenario(work: pathlib.Path, name: str) -> tuple[int, str]:
    """Full link of a scenario -> name.out. Returns (nerr, output)."""
    # tiny main that calls Generated_InitAll
    main_c = work / "main_gen.c"
    main_c.write_text(
        '#include "DSP2803x_Device.h"\n#include "generated_init_all.h"\n'
        'void main(void){ if (Generated_InitAll() != 0U){ for(;;){ __asm(" ESTOP0"); } } for(;;){} }\n',
        encoding="ascii")
    nerr, out = compile_file(main_c, work)
    if nerr:
        return nerr, out

    objs = sorted(str(p) for p in work.glob("*.obj"))
    cmd = [str(CL2000), "-v28", "-ml", "-mt", "--float_support=fpu32", ABI, "-z",
           "--entry_point=_main", "--stack_size=0x400", "--heap_size=0x200"]
    for lc in LINK_CMDS:
        cmd.append(f"--library={lc}")
    cmd += objs
    cmd += [f"--output_file={work / (name + '.out')}", f"--map_file={work / (name + '.map')}"]
    rc, lout = _run(cmd, cwd=work)
    lerr = sum(1 for ln in lout.splitlines()
               if "error" in ln.lower() and ("error:" in ln.lower() or "unresolved" in ln.lower()))
    if rc != 0 and lerr == 0:
        lerr = 1
    return lerr, lout


def main():
    if not CL2000.exists():
        print(f"[skip] TI compiler not found at {CL2000}")
        return 2
    from generator.codegen import generate
    from validators.constraint_checker import check
    pinmux, constraints, family = load_db()

    WORK.mkdir(parents=True, exist_ok=True)
    # Stage TI support sources needed for a full compile pass.
    if CPUTIMERS.exists():
        shutil.copy(CPUTIMERS, WORK / "DSP2803x_CpuTimers.c")

    total_err = 0
    summary = []
    for name, cfg in SCENARIOS.items():
        config = dict(cfg)
        config["device"] = "TMS320F28034"
        # 1) constraint check (must pass)
        findings = check(config, pinmux, constraints)
        errs = [f for f in findings if f["severity"] == "ERROR"]
        if errs:
            summary.append((name, "CONSTRAINT-FAIL", [f["rule"] for f in errs]))
            total_err += len(errs)
            continue
        # 2) generate
        try:
            files = generate(device="TMS320F28034", config=config,
                             pinmux=pinmux, family=family)
        except Exception as exc:  # noqa: BLE001
            summary.append((name, "GEN-FAIL", [str(exc)]))
            total_err += 1
            continue
        # 3) compile every generated .c
        scen_dir = WORK / name
        if scen_dir.exists():
            shutil.rmtree(scen_dir)
        scen_dir.mkdir(parents=True)
        # generated sources must see the TI CpuTimers support file's headers too;
        # copy it in so a full link-pass is possible and its include resolves.
        if CPUTIMERS.exists():
            shutil.copy(CPUTIMERS, scen_dir / "DSP2803x_CpuTimers.c")
        scen_err = 0
        bad = []
        details = []
        # Pass 1: write ALL files (so generated .h exist before any .c compiles).
        for rel, content in files.items():
            (scen_dir / rel).write_text(content, encoding="utf-8")
        # Pass 2: compile the generated .c files.
        for rel in files:
            if rel.endswith(".c"):
                nerr, out = compile_file(scen_dir / rel, scen_dir)
                scen_err += nerr
                if nerr:
                    bad.append(rel)
                    details.append(f"----- {rel} -----\n{out}")
        # TI support C sources (needed for a real link).
        for c in TI_SUPPORT_C:
            src = TI_SRC / c
            if src.exists():
                nerr, out = compile_file_ti(src, scen_dir)
                scen_err += nerr
                if nerr:
                    bad.append(c)
                    details.append(f"----- {c} -----\n{out}")
        if CPUTIMERS.exists():
            nerr, out = compile_file(scen_dir / "DSP2803x_CpuTimers.c", scen_dir)
            scen_err += nerr
            if nerr:
                bad.append("DSP2803x_CpuTimers.c")
                details.append("----- CpuTimers -----\n" + out)
        # TI support asm.
        for a in TI_SUPPORT_ASM:
            src = TI_SRC / a
            if src.exists():
                nerr, out = assemble_file(src, scen_dir)
                scen_err += nerr
                if nerr:
                    bad.append(a)
                    details.append(f"----- {a} -----\n{out}")
        # Full link.
        if scen_err == 0:
            lerr, lout = link_scenario(scen_dir, name)
            scen_err += lerr
            if lerr:
                bad.append("LINK")
                details.append("----- LINK -----\n" + lout)
        summary.append((name, f"{scen_err} errors", bad))
        if details:
            (scen_dir / "_errors.txt").write_text("\n\n".join(details), encoding="utf-8")
        total_err += scen_err

    print("=" * 64)
    print("  CCS C2000 compile check (cl2000.exe) — 6 scenarios")
    print("=" * 64)
    for name, status, bad in summary:
        mark = "OK " if status == "0 errors" else "FAIL"
        print(f"  [{mark}] {name:22s} {status}" + (f"  <- {bad}" if bad else ""))
    print("=" * 64)
    print(f"  TOTAL errors: {total_err}")
    return 0 if total_err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
