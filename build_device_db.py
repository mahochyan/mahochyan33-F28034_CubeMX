"""
build_device_db.py
------------------
Generates all device JSON data files from the official PN80 pinout CSV.
Source: SPRS584Q, TMS320F28034PNT, Figure 5-3 / Table 5-1.
Run once: python build_device_db.py
"""

import csv, json, os, pathlib, textwrap

BASE = pathlib.Path(__file__).parent
CSV_SRC = pathlib.Path(r"D:\1POWERlearning\references\TMS320F28034_PN80_pinout.csv")

FAMILY_DIR  = BASE / "devices/ti/c2000/f2803x"
PART_DIR    = BASE / "devices/ti/c2000/parts/tms320f28034"
PKG_DIR     = PART_DIR / "packages"

# ── MUX value map: (primary_signal → gpio_num) and alternates → mux index ──
# Power/ground/fixed pins never get MUX entries
FIXED_GROUPS = {"Power", "Ground", "Analog reference", "Reset", "JTAG", "Reserved",
                "Clock", "Power control"}

# ── Non-MUX alternates ───────────────────────────────────────────────────────
# Functions NOT selected via GPxMUX. Evidence: DSP2803x_SysCtrl.h line 60
# XCLKINSEL (SysCtrlRegs.XCLK.bit.XCLKINSEL, 0=GPIO19, 1=GPIO38) — XCLKIN is a
# system-control register source, it does NOT occupy a GPAMUX slot.
NON_MUX_FUNCTIONS = {
    "XCLKIN": {
        "selector": "SysCtrlRegs.XCLK.bit.XCLKINSEL",
        "source_document": "DSP2803x_SysCtrl.h",
        "source_section": "XCLK_BITS.XCLKINSEL",
    }
}

# Build warnings collector (written to docs/build_warnings.json at end)
WARNINGS: list = []

# ── Parse CSV ────────────────────────────────────────────────────────────────
def parse_csv(path: pathlib.Path) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows

# ── Determine pin type ───────────────────────────────────────────────────────
def pin_type(row: dict) -> str:
    g = row.get("pin_group", "")
    sig = row.get("primary_signal", "")
    if g == "Power":        return "power"
    if g == "Ground":       return "ground"
    if g == "Analog reference": return "analog_ref"
    if g == "Reset":        return "reset"
    if g == "JTAG":         return "jtag"
    if g == "Reserved":     return "reserved"
    if g == "Clock":        return "crystal"
    if g == "Power control": return "power_ctrl"
    if sig.startswith("ADCIN"):  return "analog_gpio"
    if sig.startswith("GPIO"):   return "digital_gpio"
    return "unknown"

def gpio_num(primary: str) -> int | None:
    """Extract GPIO number from 'GPIOnn' string, else None."""
    if primary.startswith("GPIO"):
        try:
            return int(primary[4:])
        except ValueError:
            pass
    return None

def aio_info(alts: list[str]) -> str | None:
    """Return AIOxx string if any alternate is an AIO signal."""
    for a in alts:
        if a.startswith("AIO"):
            return a
    return None

# ── Build pinmux.json entries ────────────────────────────────────────────────
def build_pinmux(rows: list[dict]) -> dict:
    pins = {}
    for row in rows:
        pnum = int(row["physical_pin"])
        primary = row["primary_signal"]
        alts_raw = row.get("alternate_functions", "")
        alts = [a.strip() for a in alts_raw.split(";") if a.strip()] if alts_raw else []
        ptype = pin_type(row)
        gnum  = gpio_num(primary)

        entry = {
            "physical_pin": pnum,
            "primary_signal": primary,
            "pin_type": ptype,
            "pin_group": row.get("pin_group", ""),
            "notes": row.get("notes", ""),
            "configurable": ptype in ("digital_gpio", "analog_gpio"),
        }

        if ptype in ("digital_gpio", "analog_gpio") and gnum is not None:
            # Split non-MUX functions (e.g. XCLKIN via SysCtrlRegs.XCLK.bit.XCLKINSEL)
            non_mux = [a for a in alts if a in NON_MUX_FUNCTIONS]
            mux_alts = [a for a in alts if a not in NON_MUX_FUNCTIONS]
            # MUX=0 is always GPIO; alternates fill MUX 1,2,3
            mux_options = [
                {"mux": 0, "function": primary, "type": "gpio",
                 "source_verified": True,
                 "source_document": "SPRS584Q",
                 "source_section": "Table 5-1"}
            ]
            for i, alt in enumerate(mux_alts[:3]):   # max 3 alternates (MUX 1-3)
                mux_options.append({
                    "mux": i + 1,
                    "function": alt,
                    "type": classify_alt(alt),
                    "source_verified": False,
                    "source_document": "SPRS584Q",
                    "source_section": "Table 5-1"
                })
            if len(mux_alts) > 3:
                WARNINGS.append(
                    f"pin {pnum} GPIO{gnum}: {len(mux_alts)} MUX alternates exceed "
                    f"2-bit MUX field; kept first 3 ({mux_alts[:3]}), verify order "
                    f"against SPRS584Q Table 5-1")
            if non_mux:
                entry["alt_non_mux"] = [{
                    "function": fn,
                    "selector": NON_MUX_FUNCTIONS[fn]["selector"],
                    "source_verified": False,
                    "source_document": NON_MUX_FUNCTIONS[fn]["source_document"],
                    "source_section": NON_MUX_FUNCTIONS[fn]["source_section"],
                } for fn in non_mux]
            entry["gpio_num"] = gnum
            entry["mux_options"] = mux_options
            entry["aio"] = aio_info(alts)
            entry["port"] = "A" if gnum <= 31 else "B"
            entry["bit_in_port"] = gnum % 32
            # Register symbols (confirmed from DSP2803x_Gpio.h)
            port = entry["port"]
            # Exact TI symbol names, verified against DSP2803x_Gpio.h
            #   GPAMUX1 -> GPIO0-15, GPAMUX2 -> GPIO16-31, GPBMUX1 -> GPIO32-44
            #   GPAQSEL1 -> GPIO0-15, GPAQSEL2 -> GPIO16-31, GPBQSEL1 -> GPIO32-44
            if port == "A":
                entry["mux_reg"]  = "GPAMUX1" if gnum <= 15 else "GPAMUX2"
                entry["qsel_reg"] = "GPAQSEL1" if gnum <= 15 else "GPAQSEL2"
                entry["dir_reg"]  = "GPADIR"
                entry["set_reg"]  = "GPASET"
                entry["clr_reg"]  = "GPACLEAR"
                entry["tog_reg"]  = "GPATOGGLE"
                entry["dat_reg"]  = "GPADAT"
                entry["pud_reg"]  = "GPAPUD"
            else:
                entry["mux_reg"]  = "GPBMUX1"
                entry["qsel_reg"] = "GPBQSEL1"
                entry["dir_reg"]  = "GPBDIR"
                entry["set_reg"]  = "GPBSET"
                entry["clr_reg"]  = "GPBCLEAR"
                entry["tog_reg"]  = "GPBTOGGLE"
                entry["dat_reg"]  = "GPBDAT"
                entry["pud_reg"]  = "GPBPUD"
            # Bit field accessor used in generated C, e.g. GpioCtrlRegs.GPAMUX1.bit.GPIO0
            entry["mux_field"]  = f"GpioCtrlRegs.{entry['mux_reg']}.bit.GPIO{gnum}"
            entry["qsel_field"] = f"GpioCtrlRegs.{entry['qsel_reg']}.bit.GPIO{gnum}"
            entry["dir_field"]  = f"GpioCtrlRegs.{entry['dir_reg']}.bit.GPIO{gnum}"
            entry["pud_field"]  = f"GpioCtrlRegs.{entry['pud_reg']}.bit.GPIO{gnum}"
            entry["set_field"]  = f"GpioDataRegs.{entry['set_reg']}.bit.GPIO{gnum}"
            entry["clr_field"]  = f"GpioDataRegs.{entry['clr_reg']}.bit.GPIO{gnum}"
            entry["tog_field"]  = f"GpioDataRegs.{entry['tog_reg']}.bit.GPIO{gnum}"
            entry["dat_field"]  = f"GpioDataRegs.{entry['dat_reg']}.bit.GPIO{gnum}"

        elif ptype == "analog_gpio":
            # ADCIN pins — AIO dual use if listed
            entry["adc_channel"] = primary  # e.g. "ADCINA7"
            entry["aio"] = aio_info(alts)

        pins[str(pnum)] = entry
    return {"device": "TMS320F28034PNT", "package": "PN80",
            "source": "SPRS584Q Table 5-1", "pins": pins}


def classify_alt(fn: str) -> str:
    fn = fn.upper()
    if fn.startswith("EPWM"):  return "epwm"
    if fn.startswith("TZ"):    return "tripzone"
    if fn.startswith("SPI"):   return "spi"
    if fn.startswith("SCI"):   return "sci"
    if fn.startswith("LIN"):   return "lin"
    if fn.startswith("ADC"):   return "adc"
    if fn.startswith("ECAP"):  return "ecap"
    if fn.startswith("EQEP"):  return "eqep"
    if fn.startswith("CAN"):   return "can"
    if fn.startswith("COMP"):  return "comparator"
    if fn.startswith("HRCAP"): return "hrcap"
    if fn.startswith("I2C") or fn in ("SDAA","SCLA"): return "i2c"
    if fn in ("XCLKIN","XCLKOUT","EPWMSYNCI","EPWMSYNCO"): return "clock"
    return "other"

# ── family.json ──────────────────────────────────────────────────────────────
FAMILY_JSON = {
    "family": "f2803x",
    "vendor": "ti",
    "product_line": "c2000",
    "description": "TMS320F2803x Real-Time Microcontrollers",
    "source_datasheet": "SPRS584Q",
    "max_sysclk_mhz": 60,
    "gpio_ports": {
        "A": {"gpio_range": [0, 31], "mux_reg1": "GPAMUX1", "mux_reg2": "GPAMUX2",
              "dir_reg": "GPADIR", "set_reg": "GPASET", "clr_reg": "GPACLEAR",
              "pud_reg": "GPAPUD", "dat_reg": "GPADAT", "qsel_reg1": "GPAQSEL1",
              "qsel_reg2": "GPAQSEL2"},
        "B": {"gpio_range": [32, 44], "mux_reg1": "GPBMUX1",
              "dir_reg": "GPBDIR", "set_reg": "GPBSET", "clr_reg": "GPBCLEAR",
              "pud_reg": "GPBPUD", "dat_reg": "GPBDAT", "qsel_reg1": "GPBQSEL1"}
    },
    "aio_pins": ["AIO2","AIO4","AIO6","AIO10","AIO12","AIO14"],
    "aio_mux_reg": "AIOMUX1",
    "adc_channels": {
        "A": ["ADCINA0","ADCINA1","ADCINA2","ADCINA3","ADCINA4","ADCINA5","ADCINA6","ADCINA7"],
        "B": ["ADCINB0","ADCINB1","ADCINB2","ADCINB3","ADCINB4","ADCINB5","ADCINB6","ADCINB7"]
    },
    "epwm_modules": ["EPWM1","EPWM2","EPWM3","EPWM4","EPWM5","EPWM6","EPWM7"],
    "pclkcr": {
        "EPWM1": {"reg": "PCLKCR1", "bit": "EPWM1ENCLK"},
        "EPWM2": {"reg": "PCLKCR1", "bit": "EPWM2ENCLK"},
        "EPWM3": {"reg": "PCLKCR1", "bit": "EPWM3ENCLK"},
        "EPWM4": {"reg": "PCLKCR1", "bit": "EPWM4ENCLK"},
        "EPWM5": {"reg": "PCLKCR1", "bit": "EPWM5ENCLK"},
        "EPWM6": {"reg": "PCLKCR1", "bit": "EPWM6ENCLK"},
        "EPWM7": {"reg": "PCLKCR1", "bit": "EPWM7ENCLK"},
        "ADC":   {"reg": "PCLKCR0", "bit": "ADCENCLK"},
        "SPI_A": {"reg": "PCLKCR0", "bit": "SPIAENCLK"},
        "SPI_B": {"reg": "PCLKCR0", "bit": "SPIBENCLK"},
        "SCI_A": {"reg": "PCLKCR0", "bit": "SCIAENCLK"},
        "I2C_A": {"reg": "PCLKCR0", "bit": "I2CAENCLK"},
        "HRPWM": {"reg": "PCLKCR0", "bit": "HRPWMENCLK"},
        "ECAP1": {"reg": "PCLKCR1", "bit": "ECAP1ENCLK"},
        "EQEP1": {"reg": "PCLKCR1", "bit": "EQEP1ENCLK"},
        "ECAN_A":{"reg": "PCLKCR0", "bit": "ECANAENCLK"},
        "COMP1": {"reg": "PCLKCR3", "bit": "COMP1ENCLK"},
        "COMP2": {"reg": "PCLKCR3", "bit": "COMP2ENCLK"},
        "COMP3": {"reg": "PCLKCR3", "bit": "COMP3ENCLK"},
        "TIMER0":{"reg": "PCLKCR3", "bit": "CPUTIMER0ENCLK"},
        "TIMER1":{"reg": "PCLKCR3", "bit": "CPUTIMER1ENCLK"},
        "TIMER2":{"reg": "PCLKCR3", "bit": "CPUTIMER2ENCLK"},
        "CLA1":  {"reg": "PCLKCR3", "bit": "CLA1ENCLK"},
        "LIN_A": {"reg": "PCLKCR0", "bit": "LINAENCLK"},
        "HRCAP1":{"reg": "PCLKCR2", "bit": "HRCAP1ENCLK"},
        "HRCAP2":{"reg": "PCLKCR2", "bit": "HRCAP2ENCLK"}
    },
    "tbclksync_bit": {"reg": "PCLKCR0", "bit": "TBCLKSYNC"},
    "header_files": [
        "DSP2803x_Device.h", "DSP2803x_Gpio.h", "DSP2803x_SysCtrl.h",
        "DSP2803x_EPwm.h", "DSP2803x_Adc.h", "DSP2803x_CpuTimers.h",
        "DSP2803x_PieCtrl.h", "DSP2803x_PieVect.h", "DSP28x_Project.h"
    ]
}

# ── device.json ──────────────────────────────────────────────────────────────
DEVICE_JSON = {
    "device": "TMS320F28034",
    "part_number": "TMS320F28034PNT",
    "family": "f2803x",
    "status": "SUPPORTED",
    "source_datasheet": "SPRS584Q",
    "source_verified": True,
    "last_verified": "2026-07-30",
    "packages": ["PN80"],
    "default_package": "PN80",
    "max_sysclk_mhz": 60,
    "flash_kb": 128,
    "ram_kb": 20,
    "epwm_count": 7,
    "adc_channels_total": 16,
    "comparators": 3,
    "device_header_path": "D:\\CCS21_workspace\\LLC_100W_F28034\\device",
    "include_path": "D:\\CCS21_workspace\\LLC_100W_F28034\\device\\include",
    "source_path": "D:\\CCS21_workspace\\LLC_100W_F28034\\device\\source",
    "safety_rules": {
        "no_jtag": True,
        "no_flash_write": True,
        "no_auto_pwm_enable": True,
        "no_modify_live_project": True,
        "pwm_default_clamped": True,
        "unresolved_marker": "UNRESOLVED"
    }
}

# ── pnt80.json (package pinout summary) ─────────────────────────────────────
def build_pnt80(rows: list[dict]) -> dict:
    pin_list = []
    for row in rows:
        pin_list.append({
            "pin": int(row["physical_pin"]),
            "signal": row["primary_signal"],
            "group": row["pin_group"],
            "notes": row.get("notes","")
        })
    return {
        "package": "PN80",
        "description": "80-pin LQFP",
        "total_pins": 80,
        "pin_spacing_mm": 0.5,
        "body_mm": "12x12",
        "source": "SPRS584Q Figure 5-3",
        "sides": {
            "bottom": list(range(1,21)),
            "left":   list(range(21,41)),
            "top":    list(range(41,61)),
            "right":  list(range(61,81))
        },
        "pins": pin_list
    }

# ── constraints.json ─────────────────────────────────────────────────────────
CONSTRAINTS_JSON = {
    "device": "TMS320F28034",
    "rules": [
        {"id": "PIN_CONFLICT", "severity": "ERROR",
         "description": "Same physical pin assigned to multiple functions"},
        {"id": "MUX_INVALID", "severity": "ERROR",
         "description": "MUX value not in device pinmux table"},
        {"id": "POWER_PIN_GPIO", "severity": "ERROR",
         "description": "Power/ground/fixed pin cannot generate GPIO code"},
        {"id": "PWM_NO_TRIP", "severity": "WARNING",
         "description": "ePWM enabled without Trip Zone OST — no hardware protection"},
        {"id": "PWM_DEADBAND_ZERO", "severity": "ERROR",
         "description": "Complementary ePWM with zero dead band — shoot-through risk"},
        {"id": "PWM_TBPRD_OVERFLOW", "severity": "ERROR",
         "description": "TBPRD value exceeds 0xFFFF for requested frequency/divider"},
        {"id": "PWM_DBRED_OVERFLOW", "severity": "ERROR",
         "description": "DBRED/DBFED value exceeds 10-bit limit (1023)"},
        {"id": "ADC_CHANNEL_MISMATCH", "severity": "ERROR",
         "description": "SOC CHSEL does not match physical ADCIN pin"},
        {"id": "ADC_SOC_CONFLICT", "severity": "ERROR",
         "description": "Same SOC number used by more than one channel"},
        {"id": "ADC_AIO_CONFLICT", "severity": "ERROR",
         "description": "AIO pin used as digital GPIO while also mapped to ADC"},
        {"id": "ADC_ACQPS_TOO_SHORT", "severity": "WARNING",
         "description": "ADC acquisition window < 7 cycles — may cause inaccurate results"},
        {"id": "PLL_ILLEGAL", "severity": "ERROR",
         "description": "PLL DIV/DIVSEL combination exceeds 60 MHz SYSCLK limit"},
        {"id": "IRQ_VECTOR_CONFLICT", "severity": "ERROR",
         "description": "Same PIE interrupt vector assigned to multiple sources"},
        {"id": "TBCLKSYNC_NOT_RESTORED", "severity": "WARNING",
         "description": "TBCLKSYNC cleared but never re-enabled — all ePWM counters frozen"},
        {"id": "UNRESOLVED_PARAM", "severity": "ERROR",
         "description": "Configuration parameter still UNRESOLVED — cannot export"},
        {"id": "PWM_RELEASE_ORDER", "severity": "ERROR",
         "description": "PWM output released before Trip Zone, AQ, and Dead Band configured"}
    ]
}

# ── Write helpers ─────────────────────────────────────────────────────────────
def jwrite(path: pathlib.Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {path.relative_to(BASE)}")

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Building device database from", CSV_SRC)
    rows = parse_csv(CSV_SRC)
    print(f"  {len(rows)} pins parsed")

    pinmux = build_pinmux(rows)
    pnt80  = build_pnt80(rows)

    jwrite(FAMILY_DIR / "family.json",              FAMILY_JSON)
    jwrite(PART_DIR / "device.json",                DEVICE_JSON)
    jwrite(PART_DIR / "pinmux.json",                pinmux)
    jwrite(PKG_DIR  / "pnt80.json",                 pnt80)
    jwrite(PART_DIR / "constraints.json",           CONSTRAINTS_JSON)

    # Validate AIO: only AIO2/4/6/10/12/14 are real digital-capable (others are rsvd bits)
    valid_aio = {"AIO2", "AIO4", "AIO6", "AIO10", "AIO12", "AIO14"}
    for e in pinmux["pins"].values():
        if e.get("aio") and e["aio"] not in valid_aio:
            WARNINGS.append(
                f"pin {e['physical_pin']} {e['primary_signal']}: {e['aio']} is not a "
                f"valid digital AIO (only AIO2/4/6/10/12/14 exist)")

    # Persist build warnings
    docs = BASE / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "build_warnings.json").write_text(
        json.dumps(WARNINGS, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(WARNINGS)} warnings -> docs/build_warnings.json")

    # Quick validation
    gpio_pins = [p for p in pinmux["pins"].values() if "gpio_num" in p]
    gpio_nums = [p["gpio_num"] for p in gpio_pins]
    assert len(gpio_nums) == len(set(gpio_nums)), "DUPLICATE GPIO numbers!"
    print(f"  {len(gpio_pins)} GPIO pins, no duplicates — OK")
    print("Done.")
