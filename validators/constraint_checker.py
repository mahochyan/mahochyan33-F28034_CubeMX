"""
constraint_checker.py — static validation of a configuration against the
device database and the constraints table.

check(config, pinmux, constraints) -> list[findings]
Each finding: {severity, rule, message, pin?, function?}
ERROR findings block export; WARNING findings are advisory.
"""

from __future__ import annotations

VALID_AIO = {"AIO2", "AIO4", "AIO6", "AIO10", "AIO12", "AIO14"}
FIXED_TYPES = {"power", "ground", "analog_ref", "reset", "jtag", "reserved",
               "crystal", "power_ctrl"}
MAX_SYSCLK = 60_000_000  # 60 MHz
TBPRD_MAX = 0xFFFF
DB_MAX = 1023  # 10-bit DBRED/DBFED


def _f(sev, rule, msg, pin=None, function=None):
    d = {"severity": sev, "rule": rule, "message": msg}
    if pin is not None:
        d["pin"] = pin
    if function is not None:
        d["function"] = function
    return d


def check(config: dict, pinmux: dict, constraints: dict) -> list:
    findings: list = []
    pins_db = pinmux.get("pins", {})
    raw_pins = config.get("pins", {}) or {}
    if isinstance(raw_pins, dict):
        assigned = []
        for key, value in raw_pins.items():
            pin = dict(value or {})
            pin.setdefault("physical_pin", int(key))
            pin.setdefault("pin", pin["physical_pin"])
            assigned.append(pin)
    else:
        assigned = raw_pins
    params = config.get("params", {}) or {}
    wizard = config.get("wizard")

    # ── index assigned pins ──────────────────────────────────────────────
    seen_pin: dict[int, dict] = {}
    fn_to_pin: dict[str, int] = {}
    tz_assigned: dict[str, int] = {}

    for a in assigned:
        pnum = a.get("pin")
        fn = a.get("function")
        mux = a.get("mux")
        sig = a.get("signal")
        pdef = pins_db.get(str(pnum))

        # PIN_CONFLICT
        if pnum in seen_pin and seen_pin[pnum].get("function") != fn:
            findings.append(_f("ERROR", "PIN_CONFLICT",
                               f"引脚 {pnum} ({sig}) 同时被 "
                               f"'{seen_pin[pnum].get('function')}' 和 '{fn}' 占用",
                               pin=pnum, function=fn))
        seen_pin[pnum] = a

        if pdef is None:
            findings.append(_f("ERROR", "MUX_INVALID",
                               f"引脚 {pnum} 不在设备数据库中", pin=pnum))
            continue

        # POWER_PIN_GPIO / fixed pin
        if not pdef.get("configurable", False) or pdef.get("pin_type") in FIXED_TYPES:
            findings.append(_f("ERROR", "POWER_PIN_GPIO",
                               f"引脚 {pnum} ({pdef.get('primary_signal')}) 是固定功能脚"
                               f"（{pdef.get('pin_type')}），不能生成 GPIO/外设配置",
                               pin=pnum))
            continue

        # MUX_INVALID
        valid_mux = {m["mux"]: m for m in pdef.get("mux_options", [])}
        if mux not in valid_mux:
            findings.append(_f("ERROR", "MUX_INVALID",
                               f"引脚 {pnum} 不存在 MUX={mux}（可选：{sorted(valid_mux)}）",
                               pin=pnum))
        else:
            opt = valid_mux[mux]
            # function name mismatch
            if fn and opt["function"] != fn:
                findings.append(_f("WARNING", "MUX_INVALID",
                                   f"引脚 {pnum} MUX{mux} 的数据库功能是 "
                                   f"'{opt['function']}'，与配置 '{fn}' 不一致",
                                   pin=pnum, function=fn))
            # R3 separates the evidence questions.  source_verified remains a
            # read-only compatibility fallback for older databases.
            signal_verified = opt.get("signal_verified", opt.get("source_verified", False))
            mux_verified = opt.get("mux_value_verified", opt.get("source_verified", False))
            generator_supported = opt.get("generator_supported", mux == 0)
            if signal_verified is False:
                findings.append(_f("ERROR", "UNRESOLVED_PARAM",
                                   f"引脚 {pnum} MUX{mux}={opt['function']} 尚未由 "
                                   f"SPRS584Q Table 5-1 确认信号存在，禁止选择",
                                   pin=pnum, function=fn))
            elif mux_verified is False:
                findings.append(_f("ERROR", "MUX_VALUE_UNVERIFIED",
                                   f"引脚 {pnum} MUX{mux}={opt['function']} 的数值尚未核实，"
                                   "只阻断该项 MUX 代码生成",
                                   pin=pnum, function=fn))
            elif generator_supported is False:
                findings.append(_f(
                    "WARNING", "PINMUX_ONLY",
                    f"{opt['function']} 允许保存并生成 pinmux；当前版本不生成完整外设寄存器初始化",
                    pin=pnum, function=fn))

        if fn:
            fn_to_pin[fn] = pnum
            if fn.startswith("TZ") and fn.endswith("n"):
                base = fn  # e.g. TZ1n
                if base in tz_assigned and tz_assigned[base] != pnum:
                    findings.append(_f("ERROR", "PIN_CONFLICT",
                                       f"{base} 同时分配到引脚 {tz_assigned[base]} 和 {pnum}",
                                       pin=pnum, function=fn))
                tz_assigned[base] = pnum

    # ── ADC AIO conflict: pin used as digital GPIO but is an AIO analog pin ──
    for a in assigned:
        pnum = a.get("pin")
        pdef = pins_db.get(str(pnum), {})
        aio = pdef.get("aio")
        if aio and a.get("mux") == 0:
            findings.append(_f("ERROR", "ADC_AIO_CONFLICT",
                               f"引脚 {pnum} 是模拟/AIO 脚（{aio}），作为数字 GPIO 使用"
                               f"会与 ADC 冲突", pin=pnum))
        if aio and aio not in VALID_AIO:
            findings.append(_f("ERROR", "ADC_AIO_CONFLICT",
                               f"引脚 {pnum} 的 {aio} 不是有效数字 AIO"
                               f"（仅 AIO2/4/6/10/12/14）", pin=pnum))

    # ── wizard-specific checks ────────────────────────────────────────────
    if wizard == "epwm_complementary" or params.get("freq_hz") or params.get("dead_ns"):
        findings += _check_epwm(params, fn_to_pin)

    if wizard == "system_clock" or params.get("target_mhz"):
        findings += _check_clock(params)

    if wizard == "adc_soc" or params.get("soc") is not None:
        findings += _check_adc(params, assigned, pins_db)

    # ── R2: ePWM A/B pairing constraints ──────────────────────────────────
    findings += _check_pwm_pairs(config, pins_db)
    findings += _check_project_modules(config, assigned, pins_db)

    # unresolved marker anywhere
    if config.get("unresolved"):
        findings.append(_f("ERROR", "UNRESOLVED_PARAM",
                           "配置中仍存在 UNRESOLVED 参数，禁止导出"))

    if not findings:
        findings.append(_f("INFO", "OK", "未发现约束冲突"))
    return findings


def _epwm_of(fn):
    import re
    m = re.match(r"^(EPWM\d+)([AB])$", (fn or "").upper())
    return (m.group(1), m.group(2)) if m else (None, None)


def _check_pwm_pairs(config, pins_db):
    """R2 §6: complementary-pair validation driven by pwm_modules (explicit)."""
    out = []
    mods = config.get("pwm_modules", {}) or {}
    raw = config.get("pins", {}) or {}
    pin_list = list(raw.values()) if isinstance(raw, dict) else raw
    pins = {p.get("function"): p for p in pin_list}

    # 1) cross-module A/B assignment (EPWM1A + EPWM2B) -> ERROR
    by_group: dict[str, list] = {}
    for p in pin_list:
        mod, ch = _epwm_of(p.get("function"))
        if mod and p.get("pair_mode") == "complementary":
            by_group.setdefault(p.get("group") or mod, []).append((mod, ch, p))
    for gid, members in by_group.items():
        mods_in_group = {m[0] for m in members}
        if len(mods_in_group) > 1:
            out.append(_f("ERROR", "EPWM_PAIR_CROSS_MODULE",
                          f"互补组 {gid} 内出现不同模块：{sorted(mods_in_group)}"
                          f"（A/B 必须同属一个 EPWM 模块）", function=gid))
        # 2) complementary group missing A or B -> ERROR
        chs = {m[1] for m in members}
        if "A" not in chs or "B" not in chs:
            out.append(_f("ERROR", "EPWM_PAIR_INCOMPLETE",
                          f"互补组 {gid} 缺少 {'A' if 'A' not in chs else 'B'} 通道",
                          function=gid))
        # 3) dead-band zero in complementary -> ERROR
        for mod, ch, p in members:
            if p.get("dead_ns") is not None and float(p.get("dead_ns", 0)) <= 0:
                out.append(_f("ERROR", "PWM_DEADBAND_ZERO",
                              f"互补组 {gid} 死区为 0 — 直通短路风险", function=gid))
                break
        # 4) Trip action inconsistent across A/B -> ERROR
        trips = {m[2].get("trip") for m in members if m[2].get("trip") is not None}
        if len(trips) > 1:
            out.append(_f("ERROR", "EPWM_TRIP_MISMATCH",
                          f"互补组 {gid} 的 A/B Trip 动作不一致：{sorted(trips)}", function=gid))

    # 5) module declared complementary but only one channel present -> ERROR
    for name, m in mods.items():
        mode = m.get("mode", m.get("pair_mode"))
        if mode == "complementary":
            have = set((m.get("pins") or {}).keys())
            if m.get("pin_a") is not None:
                have.add("A")
            if m.get("pin_b") is not None:
                have.add("B")
            if "A" not in have or "B" not in have:
                out.append(_f("ERROR", "EPWM_PAIR_INCOMPLETE",
                              f"{name} 声明为互补输出但只配置了 "
                              f"{'、'.join(sorted(have)) or '无'} 通道", function=name))
    return out


def _check_project_modules(config, assigned, pins_db):
    """R3 module-level semantic checks; errors stay local to their module."""
    out = []
    clock = config.get("system_clock")
    sysclk = MAX_SYSCLK
    if clock:
        try:
            sysclk = int(clock.get("sysclk_hz", float(clock.get("target_mhz", 60)) * 1e6))
            if sysclk > MAX_SYSCLK:
                out.append(_f("ERROR", "PLL_ILLEGAL",
                              f"系统时钟 {sysclk}Hz 超过 F28034 上限 {MAX_SYSCLK}Hz"))
        except (TypeError, ValueError):
            out.append(_f("ERROR", "UNRESOLVED_PARAM", "system_clock 数值非法"))

    for name, module in (config.get("pwm_modules", {}) or {}).items():
        try:
            freq = float(module.get("frequency_hz"))
            mode = module.get("count_mode", "up_down")
            tbprd = sysclk / ((2.0 if mode == "up_down" else 1.0) * freq)
            if not 1 <= tbprd <= TBPRD_MAX:
                out.append(_f("ERROR", "PWM_TBPRD_OVERFLOW",
                              f"{name} 的 TBPRD={tbprd:.0f} 超出 1..{TBPRD_MAX}",
                              function=name))
        except (TypeError, ValueError, ZeroDivisionError):
            out.append(_f("ERROR", "UNRESOLVED_PARAM",
                          f"{name} frequency_hz 非法", function=name))
        try:
            duty = float(module.get("duty", 0.5))
            if not 0 < duty < 1:
                out.append(_f("ERROR", "PWM_DUTY_ILLEGAL",
                              f"{name} duty 必须在 0 和 1 之间", function=name))
        except (TypeError, ValueError):
            out.append(_f("ERROR", "PWM_DUTY_ILLEGAL",
                          f"{name} duty 非法", function=name))
        if module.get("mode") == "complementary":
            db = module.get("deadband") or {}
            if not db.get("enabled", True) or float(db.get("red_ns", 0)) <= 0 or \
                    float(db.get("fed_ns", 0)) <= 0:
                out.append(_f("ERROR", "PWM_DEADBAND_ZERO",
                              f"{name} 互补输出必须配置非零 RED/FED 死区", function=name))
        trip = module.get("trip") or {}
        if trip.get("enabled"):
            source = str(trip.get("source", "")).upper().rstrip("N")
            trip_pin = next((p for p in assigned
                             if str(p.get("function", "")).upper().rstrip("N") == source), None)
            if trip_pin is None:
                out.append(_f("ERROR", "PWM_TRIP_PIN_MISSING",
                              f"{name} 选择了 {source}，但 ProjectConfig 没有对应 TZ 物理脚",
                              function=name))

    adc = config.get("adc")
    if adc:
        try:
            if int(adc.get("acqps")) < 7:
                out.append(_f("WARNING", "ADC_ACQPS_TOO_SHORT",
                              f"ACQPS={adc.get('acqps')} 采样窗过短（<7 周期）"))
        except (TypeError, ValueError):
            out.append(_f("ERROR", "UNRESOLVED_PARAM", "ADC ACQPS 非法"))
    return out


def _check_epwm(params, fn_to_pin):
    out = []
    freq = params.get("freq_hz")
    dead = params.get("dead_ns")
    duty = params.get("duty")

    # TBPRD overflow (assume up-down counting, no extra divider)
    if freq:
        try:
            tbprd = MAX_SYSCLK / (2.0 * float(freq))
            if tbprd > TBPRD_MAX:
                out.append(_f("ERROR", "PWM_TBPRD_OVERFLOW",
                              f"频率 {freq}Hz 需要 TBPRD={tbprd:.0f}，超过 {TBPRD_MAX}。"
                              f"请提高分频或降低目标频率"))
        except (ValueError, ZeroDivisionError):
            out.append(_f("ERROR", "UNRESOLVED_PARAM", "freq_hz 非法"))

    # dead band
    if dead is not None:
        try:
            ticks = float(dead) / (1e9 / MAX_SYSCLK)  # ns / 16.67ns
            if float(dead) <= 0:
                out.append(_f("ERROR", "PWM_DEADBAND_ZERO",
                              "互补 PWM 死区为 0 — 上下管直通短路风险", function="DeadBand"))
            elif ticks > DB_MAX:
                out.append(_f("ERROR", "PWM_DBRED_OVERFLOW",
                              f"死区 {dead}ns ≈ {ticks:.0f} tick，超过 10bit 上限 {DB_MAX}"))
        except ValueError:
            out.append(_f("ERROR", "UNRESOLVED_PARAM", "dead_ns 非法"))

    if duty is not None:
        try:
            d = float(duty)
            if not (0.0 < d < 1.0):
                out.append(_f("WARNING", "UNRESOLVED_PARAM",
                              f"占空比 {d} 超出 (0,1) 区间"))
        except ValueError:
            pass

    # PWM without Trip Zone -> warning
    has_tz = any(fn.startswith("TZ") for fn in fn_to_pin)
    if not has_tz:
        out.append(_f("WARNING", "PWM_NO_TRIP",
                      "ePWM 未配置 Trip Zone — 无硬件过流/故障保护，功率级风险高"))
    return out


def _check_clock(params):
    out = []
    mhz = params.get("target_mhz")
    if mhz is not None:
        try:
            if float(mhz) > 60:
                out.append(_f("ERROR", "PLL_ILLEGAL",
                              f"目标 SYSCLK {mhz}MHz 超过 F28034 上限 60MHz"))
        except ValueError:
            out.append(_f("ERROR", "UNRESOLVED_PARAM", "target_mhz 非法"))
    return out


def _check_adc(params, assigned, pins_db):
    out = []
    soc = params.get("soc")
    acqps = params.get("acqps")
    # SOC duplicate
    socs = [a for a in assigned if a.get("soc") is not None]
    seen = {}
    for a in socs:
        s = a["soc"]
        if s in seen:
            out.append(_f("ERROR", "ADC_SOC_CONFLICT",
                          f"SOC{s} 被多个通道占用", function="ADC"))
        seen[s] = True
    if acqps is not None:
        try:
            if int(acqps) < 7:
                out.append(_f("WARNING", "ADC_ACQPS_TOO_SHORT",
                              f"ACQPS={acqps} 采样窗过短（<7 周期），采样可能不准"))
        except (ValueError, TypeError):
            pass
    return out
