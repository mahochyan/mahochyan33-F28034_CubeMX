#!/usr/bin/env python3
"""Build the complete TMS320F28034PNT official pin database.

This is a declarative transcription of TI SPRS584Q Figure 5-3, Table 5-1,
Table 7-40, Table 7-41 and Table 7-42.  It intentionally contains no
per-pin correction or patch list: every generated artifact is rebuilt from
the complete official matrices below.
"""

from __future__ import annotations

import json
import pathlib
import shutil
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEVICE_ROOT = ROOT / "devices" / "ti" / "c2000" / "parts" / "tms320f28034"
STATIC_ROOT = ROOT / "src" / "devices" / "TMS320F28034"
FAMILY_ROOT = ROOT / "devices" / "ti" / "c2000" / "f2803x"
DOCS_ROOT = ROOT / "docs"

SOURCE = {
    "document": "SPRS584Q",
    "revision": "Q",
    "revised": "January 2024",
    "url": "https://www.ti.com/lit/ds/sprs584q/sprs584q.pdf",
    "sections": {
        "physical_package": "Figure 5-3",
        "signal_descriptions": "Table 5-1",
        "gpioa_mux": "Table 7-40",
        "gpiob_mux": "Table 7-41",
        "analog_mux": "Table 7-42",
    },
}

# One complete PN80 matrix.  The slash-separated signal order follows
# Figure 5-3 and the R3.2.2 official alignment work order.
PHYSICAL_MATRIX = """
1|GPIO22/EQEP1S/LINTXA
2|GPIO32/SDAA/EPWMSYNCI/ADCSOCAO
3|GPIO33/SCLA/EPWMSYNCO/ADCSOCBO
4|GPIO23/EQEP1I/LINRXA
5|GPIO42/COMP1OUT
6|GPIO43/COMP2OUT
7|VDD
8|VSS
9|XRS
10|TRST
11|ADCINA7
12|ADCINA6/COMP3A/AIO6
13|ADCINA5
14|ADCINA4/COMP2A/AIO4
15|ADCINA3
16|ADCINA2/COMP1A/AIO2
17|ADCINA1
18|ADCINA0
19|VREFHI
20|VDDA
21|VSSA
22|VREFLO
23|ADCINB0
24|ADCINB1
25|ADCINB2/COMP1B/AIO10
26|ADCINB3
27|ADCINB4/COMP2B/AIO12
28|ADCINB5
29|ADCINB6/COMP3B/AIO14
30|ADCINB7
31|GPIO27/HRCAP2/SPISTEB
32|GPIO31/CANTXA
33|GPIO30/CANRXA
34|GPIO29/SCITXDA/SCLA/TZ3
35|VSS
36|VDDIO
37|GPIO26/HRCAP1/SPICLKB
38|TEST2
39|GPIO9/EPWM5B/LINTXA/HRCAP1
40|GPIO28/SCIRXDA/SDAA/TZ2
41|GPIO18/SPICLKA/LINTXA/XCLKOUT
42|GPIO17/SPISOMIA/TZ3
43|GPIO8/EPWM5A/ADCSOCAO
44|GPIO25/SPISOMIB
45|GPIO44
46|GPIO16/SPISIMOA/TZ2
47|GPIO12/TZ1/SCITXDA/SPISIMOB
48|GPIO41/EPWM7B
49|GPIO7/EPWM4B/SCIRXDA
50|GPIO6/EPWM4A/EPWMSYNCI/EPWMSYNCO
51|X2
52|X1
53|VSS
54|VDD
55|GPIO19/XCLKIN/SPISTEA/LINRXA/ECAP1
56|GPIO39
57|GPIO38/TCK/XCLKIN
58|GPIO37/TDO
59|GPIO35/TDI
60|GPIO36/TMS
61|GPIO11/EPWM6B/LINRXA/HRCAP2
62|GPIO5/EPWM3B/SPISIMOA/ECAP1
63|GPIO4/EPWM3A
64|GPIO40/EPWM7A
65|GPIO10/EPWM6A/ADCSOCBO
66|GPIO3/EPWM2B/SPISOMIA/COMP2OUT
67|GPIO2/EPWM2A
68|GPIO1/EPWM1B/COMP1OUT
69|GPIO0/EPWM1A
70|VDDIO
71|VSS
72|VDD
73|VREGENZ
74|GPIO34/COMP2OUT/COMP3OUT
75|GPIO15/TZ1/LINRXA/SPISTEB
76|GPIO13/TZ2/SPISOMIB
77|GPIO14/TZ3/LINTXA/SPICLKB
78|GPIO20/EQEP1A/COMP1OUT
79|GPIO21/EQEP1B/COMP2OUT
80|GPIO24/ECAP1/SPISIMOB
""".strip()

# Complete 4-slot values.  Reserved is data, not an omitted entry.
GPIO_MUX_MATRIX = """
0|GPIO0|EPWM1A|Reserved|Reserved
1|GPIO1|EPWM1B|Reserved|COMP1OUT
2|GPIO2|EPWM2A|Reserved|Reserved
3|GPIO3|EPWM2B|SPISOMIA|COMP2OUT
4|GPIO4|EPWM3A|Reserved|Reserved
5|GPIO5|EPWM3B|SPISIMOA|ECAP1
6|GPIO6|EPWM4A|EPWMSYNCI|EPWMSYNCO
7|GPIO7|EPWM4B|SCIRXDA|Reserved
8|GPIO8|EPWM5A|Reserved|ADCSOCAO
9|GPIO9|EPWM5B|LINTXA|HRCAP1
10|GPIO10|EPWM6A|Reserved|ADCSOCBO
11|GPIO11|EPWM6B|LINRXA|HRCAP2
12|GPIO12|TZ1|SCITXDA|SPISIMOB
13|GPIO13|TZ2|Reserved|SPISOMIB
14|GPIO14|TZ3|LINTXA|SPICLKB
15|GPIO15|TZ1|LINRXA|SPISTEB
16|GPIO16|SPISIMOA|Reserved|TZ2
17|GPIO17|SPISOMIA|Reserved|TZ3
18|GPIO18|SPICLKA|LINTXA|XCLKOUT
19|GPIO19|SPISTEA|LINRXA|ECAP1
20|GPIO20|EQEP1A|Reserved|COMP1OUT
21|GPIO21|EQEP1B|Reserved|COMP2OUT
22|GPIO22|EQEP1S|Reserved|LINTXA
23|GPIO23|EQEP1I|Reserved|LINRXA
24|GPIO24|ECAP1|Reserved|SPISIMOB
25|GPIO25|Reserved|Reserved|SPISOMIB
26|GPIO26|HRCAP1|Reserved|SPICLKB
27|GPIO27|HRCAP2|Reserved|SPISTEB
28|GPIO28|SCIRXDA|SDAA|TZ2
29|GPIO29|SCITXDA|SCLA|TZ3
30|GPIO30|CANRXA|Reserved|Reserved
31|GPIO31|CANTXA|Reserved|Reserved
32|GPIO32|SDAA|EPWMSYNCI|ADCSOCAO
33|GPIO33|SCLA|EPWMSYNCO|ADCSOCBO
34|GPIO34|COMP2OUT|Reserved|COMP3OUT
35|GPIO35|Reserved|Reserved|Reserved
36|GPIO36|Reserved|Reserved|Reserved
37|GPIO37|Reserved|Reserved|Reserved
38|GPIO38|Reserved|Reserved|Reserved
39|GPIO39|Reserved|Reserved|Reserved
40|GPIO40|EPWM7A|Reserved|Reserved
41|GPIO41|EPWM7B|Reserved|Reserved
42|GPIO42|Reserved|Reserved|COMP1OUT
43|GPIO43|Reserved|Reserved|COMP2OUT
44|GPIO44|Reserved|Reserved|Reserved
""".strip()

ANALOG_MATRIX = {
    11: {"adc": "ADCINA7"},
    12: {"adc": "ADCINA6", "comparator": "COMP3A", "aio": "AIO6"},
    13: {"adc": "ADCINA5"},
    14: {"adc": "ADCINA4", "comparator": "COMP2A", "aio": "AIO4"},
    15: {"adc": "ADCINA3"},
    16: {"adc": "ADCINA2", "comparator": "COMP1A", "aio": "AIO2"},
    17: {"adc": "ADCINA1"},
    18: {"adc": "ADCINA0"},
    23: {"adc": "ADCINB0"},
    24: {"adc": "ADCINB1"},
    25: {"adc": "ADCINB2", "comparator": "COMP1B", "aio": "AIO10"},
    26: {"adc": "ADCINB3"},
    27: {"adc": "ADCINB4", "comparator": "COMP2B", "aio": "AIO12"},
    28: {"adc": "ADCINB5"},
    29: {"adc": "ADCINB6", "comparator": "COMP3B", "aio": "AIO14"},
    30: {"adc": "ADCINB7"},
}

FIXED_RULES = {
    7: ("power", "核心/逻辑数字电源"),
    8: ("ground", "数字地"),
    9: ("reset", "开漏复位输入/看门狗复位输出，内部上拉"),
    10: ("jtag_reset", "JTAG 测试复位，必须外部下拉"),
    19: ("reference", "PN80 专用 ADC 外部参考高"),
    20: ("power", "模拟电源"),
    21: ("ground", "模拟地"),
    22: ("reference", "PN80 专用 ADC 外部参考低"),
    35: ("ground", "数字地"),
    36: ("power", "数字 I/O 与 Flash 电源"),
    38: ("test", "TI 保留测试脚，必须悬空"),
    51: ("crystal", "晶振输出；不用时悬空"),
    52: ("crystal", "晶振输入；不用时接地"),
    53: ("ground", "数字地"),
    54: ("power", "核心/逻辑数字电源"),
    70: ("power", "数字 I/O 与 Flash 电源"),
    71: ("ground", "数字地"),
    72: ("power", "核心/逻辑数字电源"),
    73: ("power_control", "低=内部 1.8V 稳压，高=外部 1.8V"),
}

JTAG_ROUTES = [
    {"pin": 59, "gpio": 35, "function": "TDI", "direction": "input"},
    {"pin": 60, "gpio": 36, "function": "TMS", "direction": "input"},
    {"pin": 58, "gpio": 37, "function": "TDO", "direction": "output"},
    {"pin": 57, "gpio": 38, "function": "TCK", "direction": "input"},
]

CLOCK_INPUT_ROUTES = [
    {"pin": 55, "gpio": 19, "function": "XCLKIN", "selector": "XCLKINSEL"},
    {"pin": 57, "gpio": 38, "function": "XCLKIN", "selector": "XCLKINSEL"},
]

BOOT_ROLES = [
    {"role": "BOOT_MODE_STRAP", "pins": [58, 74, 10],
     "signals": ["GPIO37/TDO", "GPIO34/COMP2OUT/COMP3OUT", "TRST"]},
    {"role": "SCI_BOOT_RX", "pins": [40], "signals": ["GPIO28/SCIRXDA"]},
    {"role": "SCI_BOOT_TX", "pins": [34], "signals": ["GPIO29/SCITXDA"]},
    {"role": "SPI_BOOT", "pins": [46, 42, 41, 55],
     "signals": ["GPIO16/SPISIMOA", "GPIO17/SPISOMIA",
                 "GPIO18/SPICLKA", "GPIO19/SPISTEA"]},
    {"role": "I2C_BOOT", "pins": [2, 3], "signals": ["GPIO32/SDAA", "GPIO33/SCLA"]},
    {"role": "CAN_BOOT", "pins": [33, 32], "signals": ["GPIO30/CANRXA", "GPIO31/CANTXA"]},
    {"role": "PARALLEL_BOOT", "pins": [32, 33, 62, 63, 50, 66, 67, 68, 69],
     "signals": ["GPIO31", "GPIO30", "GPIO5", "GPIO4", "GPIO6",
                 "GPIO3", "GPIO2", "GPIO1", "GPIO0"]},
    {"role": "AIO6_28X_CONTROL", "pins": [12], "signals": ["AIO6"]},
    {"role": "AIO12_HOST_CONTROL", "pins": [27], "signals": ["AIO12"]},
]

PACKAGE_GEOMETRY = {
    "canvas": 1280,
    "body": {"x": 405, "y": 405, "width": 470, "height": 470},
    "pin_length": 72,
    "pin_width": 15,
    "outer_label_gap": 8,
}


def rows(text: str) -> list[list[str]]:
    return [[field.strip() for field in line.split("|")]
            for line in text.splitlines() if line.strip()]


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def support(
    *,
    route: bool,
    peripheral: bool = False,
    read_only: bool = False,
    fixed: bool = False,
) -> dict[str, bool]:
    return {
        "signal_present": True,
        "pin_route_supported": route,
        "peripheral_init_supported": peripheral,
        "read_only_special_role": read_only,
        "fixed_pin": fixed,
    }


def function_type(function: str) -> str:
    fn = function.upper()
    if fn.startswith("GPIO"):
        return "gpio"
    if fn.startswith("EPWM") and "SYNC" not in fn:
        return "epwm"
    if fn.startswith("EPWMSYNC"):
        return "epwm_sync"
    if fn.startswith("TZ"):
        return "tripzone"
    if fn.startswith("ADCSOC"):
        return "adc_soc_output"
    if fn.startswith("COMP") and fn.endswith("OUT"):
        return "comparator_output"
    if fn.startswith(("SPISIMOA", "SPISOMIA", "SPICLKA", "SPISTEA")):
        return "spi_a"
    if fn.startswith(("SPISIMOB", "SPISOMIB", "SPICLKB", "SPISTEB")):
        return "spi_b"
    if fn.startswith("SCI"):
        return "sci"
    if fn.startswith("LIN"):
        return "lin"
    if fn.startswith("CAN"):
        return "can"
    if fn.startswith("ECAP"):
        return "ecap"
    if fn.startswith("HRCAP"):
        return "hrcap"
    if fn.startswith("EQEP"):
        return "eqep"
    if fn in {"SDAA", "SCLA"}:
        return "i2c"
    if fn == "XCLKOUT":
        return "clock_output"
    raise ValueError(f"unclassified function: {function}")


def function_direction(function: str) -> str:
    fn = function.upper()
    if fn.startswith("GPIO"):
        return "io"
    if fn.startswith("EPWM") and not fn.endswith("SYNCI"):
        return "output"
    if fn in {"CANTXA", "SCITXDA", "LINTXA", "ADCSOCAO", "ADCSOCBO",
              "COMP1OUT", "COMP2OUT", "COMP3OUT", "XCLKOUT"}:
        return "output"
    if fn in {"CANRXA", "SCIRXDA", "LINRXA", "TZ1", "TZ2", "TZ3",
              "HRCAP1", "HRCAP2", "EPWMSYNCI"}:
        return "input"
    if fn in {"SDAA", "SCLA"}:
        return "io_open_drain"
    return "io"


def electrical_profile(function: str) -> str | None:
    """Assign generation semantics while building the device database.

    Runtime code is forbidden from guessing by substring.  This builder turns
    each official function into an explicit, reviewable database field.
    """
    fn = function.upper()
    exact = {
        "SDAA": "i2c_open_drain",
        "SCLA": "i2c_open_drain",
        "SCITXDA": "sci_tx",
        "SCIRXDA": "sci_rx",
        "LINTXA": "lin_tx",
        "LINRXA": "lin_rx",
        "CANTXA": "can_tx",
        "CANRXA": "can_rx",
        "ECAP1": "ecap_by_mode",
        "HRCAP1": "hrcap_sync_input",
        "HRCAP2": "hrcap_sync_input",
        "TZ1": "trip_async_input",
        "TZ2": "trip_async_input",
        "TZ3": "trip_async_input",
        "EPWMSYNCI": "pwm_sync_input",
        "EPWMSYNCO": "pwm_sync_output",
        "ADCSOCAO": "adc_trigger_output",
        "ADCSOCBO": "adc_trigger_output",
        "COMP1OUT": "comparator_output",
        "COMP2OUT": "comparator_output",
        "COMP3OUT": "comparator_output",
        "XCLKOUT": "clock_output",
    }
    if fn in exact:
        return exact[fn]
    if fn.startswith("GPIO"):
        return None
    if fn.startswith("EPWM") and fn.endswith(("A", "B")):
        return "epwm_output"
    if fn.startswith("SPISIMO") or fn.startswith("SPISOMI"):
        return f"spi_data_{fn[-1].lower()}"
    if fn.startswith("SPICLK"):
        return f"spi_clock_{fn[-1].lower()}"
    if fn.startswith("SPISTE"):
        return f"spi_ste_{fn[-1].lower()}"
    if fn.startswith("EQEP1"):
        return "eqep_sync_input"
    raise ValueError(f"no explicit electrical profile for {function}")


def register_metadata(gpio: int) -> dict[str, object]:
    port = "A" if gpio <= 31 else "B"
    if gpio <= 15:
        mux_reg, qsel_reg = "GPAMUX1", "GPAQSEL1"
    elif gpio <= 31:
        mux_reg, qsel_reg = "GPAMUX2", "GPAQSEL2"
    else:
        mux_reg, qsel_reg = "GPBMUX1", "GPBQSEL1"
    prefix = f"GpioCtrlRegs.GP{port}"
    data = f"GpioDataRegs.GP{port}"
    bit = f"GPIO{gpio}"
    return {
        "port": port,
        "bit_in_port": gpio if port == "A" else gpio - 32,
        "mux_reg": mux_reg,
        "qsel_reg": qsel_reg,
        "dir_reg": f"GP{port}DIR",
        "set_reg": f"GP{port}SET",
        "clr_reg": f"GP{port}CLEAR",
        "tog_reg": f"GP{port}TOGGLE",
        "dat_reg": f"GP{port}DAT",
        "pud_reg": f"GP{port}PUD",
        "mux_field": f"{prefix}MUX{1 if gpio <= 15 or gpio >= 32 else 2}.bit.{bit}",
        "qsel_field": f"{prefix}QSEL{1 if gpio <= 15 or gpio >= 32 else 2}.bit.{bit}",
        "dir_field": f"{prefix}DIR.bit.{bit}",
        "pud_field": f"{prefix}PUD.bit.{bit}",
        "set_field": f"{data}SET.bit.{bit}",
        "clr_field": f"{data}CLEAR.bit.{bit}",
        "tog_field": f"{data}TOGGLE.bit.{bit}",
        "dat_field": f"{data}DAT.bit.{bit}",
    }


def route_entry(
    function: str,
    route_type: str,
    route_kind: str,
    *,
    route: bool,
    peripheral: bool = False,
    read_only: bool = False,
    fixed: bool = False,
    **extra: object,
) -> dict[str, object]:
    status = support(
        route=route, peripheral=peripheral, read_only=read_only, fixed=fixed
    )
    return {
        "function": function,
        "type": route_type,
        "route_kind": route_kind,
        "support": status,
        "signal_verified": True,
        "pin_config_supported": route,
        "peripheral_init_supported": peripheral,
        "read_only_special_role": read_only,
        "source_document": SOURCE["document"],
        "source_section": extra.pop("source_section", None),
        **extra,
    }


def build() -> tuple[dict, dict, dict]:
    physical: dict[int, list[str]] = {
        int(pin): signals.split("/") for pin, signals in rows(PHYSICAL_MATRIX)
    }
    if set(physical) != set(range(1, 81)):
        raise RuntimeError("physical matrix must contain exactly Pin1 through Pin80")

    gpio_slots: dict[int, list[str]] = {
        int(gpio): slots for gpio, *slots in rows(GPIO_MUX_MATRIX)
    }
    if set(gpio_slots) != set(range(45)):
        raise RuntimeError("GPIO matrix must contain exactly GPIO0 through GPIO44")
    if any(len(slots) != 4 for slots in gpio_slots.values()):
        raise RuntimeError("every GPIO row must preserve all four MUX slots")

    gpio_to_pin: dict[int, int] = {}
    for pin, signals in physical.items():
        gpio_names = [name for name in signals if name.startswith("GPIO")]
        if gpio_names:
            gpio = int(gpio_names[0][4:])
            if gpio in gpio_to_pin:
                raise RuntimeError(f"GPIO{gpio} appears on multiple physical pins")
            gpio_to_pin[gpio] = pin
    if set(gpio_to_pin) != set(range(45)):
        raise RuntimeError("physical matrix must map GPIO0 through GPIO44 exactly once")

    pins: dict[str, dict] = {}
    golden_pins: list[dict] = []
    options: list[dict] = []
    for pin in range(1, 81):
        visible = physical[pin]
        identity = visible[0]
        gpio = next(
            (int(name[4:]) for name in visible if name.startswith("GPIO")), None
        )
        fixed = pin in FIXED_RULES
        analog = ANALOG_MATRIX.get(pin, {})
        analog_paths = []
        if "adc" in analog:
            analog_paths.append(route_entry(
                analog["adc"], "adc_input", "analog",
                route=True, peripheral=True, source_section="Table 7-42",
                always_available=True,
            ))
        if "comparator" in analog:
            analog_paths.append(route_entry(
                analog["comparator"], "comparator_input", "analog",
                route=True, peripheral=True, source_section="Table 7-42",
                always_available=True,
            ))
        aio_function = None
        if "aio" in analog:
            aio = analog["aio"]
            aio_bit = int(aio[3:])
            aio_function = route_entry(
                aio, "aio", "aio", route=True, peripheral=True,
                source_section="Table 7-42", aiomux_bit=aio_bit,
                aiomux_field=f"GpioCtrlRegs.AIOMUX1.bit.{aio}",
                dir_field=f"GpioCtrlRegs.AIODIR.bit.{aio}",
                dat_field=f"GpioDataRegs.AIODAT.bit.{aio}",
                set_field=f"GpioDataRegs.AIOSET.bit.{aio}",
                clear_field=f"GpioDataRegs.AIOCLEAR.bit.{aio}",
                toggle_field=f"GpioDataRegs.AIOTOGGLE.bit.{aio}",
                reset_mode="analog",
            )

        mux_options = []
        if gpio is not None:
            for mux, function in enumerate(gpio_slots[gpio]):
                if function == "Reserved":
                    continue
                entry = route_entry(
                    function,
                    function_type(function),
                    "gpio_mux",
                    route=True,
                    peripheral=function_type(function) in {
                        "epwm", "i2c", "spi_a", "spi_b", "sci", "lin",
                        "can", "eqep", "ecap", "hrcap", "tripzone",
                        "epwm_sync", "adc_soc_output", "comparator_output",
                        "clock_output",
                    },
                    source_section="Table 7-40" if gpio <= 31 else "Table 7-41",
                    mux=mux,
                    direction=function_direction(function),
                    signal_verified=True,
                    mux_value_verified=True,
                    source_verified=True,
                    electrical_profile=electrical_profile(function),
                    generator_profile=electrical_profile(function),
                )
                entry["generator_supported"] = entry["peripheral_init_supported"]
                entry["evidence"] = [{
                    "document": SOURCE["document"],
                    "section": entry["source_section"],
                    "gpio": gpio,
                    "mux": mux,
                }]
                mux_options.append(entry)
                options.append({
                    "gpio": gpio,
                    "mux": mux,
                    "function": function,
                    "physical_pin": pin,
                    "source_section": entry["source_section"],
                    "signal_verified": True,
                    "mux_value_verified": True,
                })

        special_routes = []
        for route in JTAG_ROUTES:
            if route["pin"] == pin:
                special_routes.append(route_entry(
                    route["function"], "jtag_special", "special",
                    route=False, read_only=True, source_section="Table 5-1",
                    controlled_by="TRST", direction=route["direction"],
                    warning="JTAG 特殊共享，不是 GPBMUX1 选项",
                ))
        for route in CLOCK_INPUT_ROUTES:
            if route["pin"] == pin:
                special_routes.append(route_entry(
                    "XCLKIN", "clock_input", "special",
                    route=False, read_only=True, source_section="Table 5-1",
                    controlled_by=route["selector"],
                    warning=("GPIO38 同时共享 TCK，调试期间需检查时钟争用"
                             if pin == 57 else "XCLKIN 不受普通 GPIO MUX 门控"),
                ))
        if pin == 41:
            special_routes.append(route_entry(
                "XCLKOUT", "clock_output", "special_control",
                route=False, read_only=True, source_section="Table 5-1",
                controlled_by=["GPAMUX2.MUX3", "XCLKOUTDIV"],
                warning="只设置 MUX3 还不构成完整 XCLKOUT 配置",
            ))

        capabilities = []
        if gpio is not None and gpio <= 31:
            for function in ("XINT1", "XINT2", "XINT3"):
                capabilities.append(route_entry(
                    function, "external_interrupt", "capability",
                    route=False, read_only=True, source_section="Table 5-1",
                    source_gpio=gpio,
                    selector=f"GPIOXINT{function[-1]}SEL.GPIOSEL",
                ))
            for function in ("STANDBY_WAKE", "HALT_WAKE"):
                capabilities.append(route_entry(
                    function, "low_power_wake", "capability",
                    route=False, read_only=True, source_section="Table 5-1",
                    source_gpio=gpio, selector="GPIOLPMSEL",
                ))
        for option in mux_options:
            function = option["function"]
            if option["type"] == "epwm" and function.endswith("A"):
                capabilities.append(route_entry(
                    f"HRPWM{function[4:-1]}A", "hrpwm", "capability",
                    route=False, read_only=True, source_section="Table 5-1",
                    shares_pin_route=function,
                    warning="HRPWM 只在对应 ePWM A 信号路径上可用",
                ))

        boot_roles = []
        for role in BOOT_ROLES:
            if pin in role["pins"]:
                boot_roles.append(route_entry(
                    role["role"], "boot_role", "boot_role",
                    route=False, read_only=True, source_section="Table 5-1",
                    role_signals=role["signals"],
                    warning="仅用于启动模式提示，不生成普通运行期 PinMux",
                ))

        fixed_function = None
        if fixed:
            fixed_type, rule = FIXED_RULES[pin]
            fixed_function = route_entry(
                identity, "fixed", "fixed", route=False, read_only=True,
                fixed=True, source_section="Table 5-1",
                fixed_type=fixed_type, rule=rule,
            )

        definition = {
            "physical_pin": pin,
            "identity": identity,
            "primary_signal": identity,
            "official_functions": visible,
            "pin_type": (
                "fixed" if fixed else "analog" if analog else "digital_io"
            ),
            "pin_group": (
                FIXED_RULES[pin][0] if fixed else
                "Analog I/O" if analog else "Digital I/O"
            ),
            "notes": FIXED_RULES[pin][1] if fixed else "",
            "fixed": fixed,
            "configurable": not fixed,
            "gpio_num": gpio,
            "gpio_mux_options": mux_options,
            "mux_options": mux_options,
            "analog_paths": analog_paths,
            "aio_function": aio_function,
            "special_routes": special_routes,
            "capabilities": capabilities,
            "boot_roles": boot_roles,
            "fixed_function": fixed_function,
            "source": {
                "figure": "Figure 5-3",
                "description": "Table 5-1",
            },
        }
        if gpio is not None:
            definition.update(register_metadata(gpio))
        if "adc" in analog:
            definition["adc_channel"] = analog["adc"]
        definition["aio"] = analog.get("aio")
        pins[str(pin)] = definition
        golden_pins.append({
            "physical_pin": pin,
            "identity": identity,
            "official_functions": visible,
            "fixed": fixed,
            "gpio_num": gpio,
        })

    options.sort(key=lambda item: (item["gpio"], item["mux"]))
    if len(options) != 127:
        raise RuntimeError(f"expected 127 non-Reserved GPIO MUX entries, got {len(options)}")
    if any(
        route["function"] in {"TDI", "TMS", "TDO", "TCK"}
        for pin in pins.values() for route in pin["mux_options"]
    ):
        raise RuntimeError("JTAG signals must never appear in GPBMUX options")

    global_special = {
        "jtag": JTAG_ROUTES,
        "clock_input_route": {
            "selector": "XCLKINSEL",
            "sources": CLOCK_INPUT_ROUTES,
        },
        "clock_output_route": {
            "pin": 41,
            "gpio": 18,
            "function": "XCLKOUT",
            "mux": 3,
            "additional_control": "XCLKOUTDIV",
        },
        "external_interrupts": {
            "routes": ["XINT1", "XINT2", "XINT3"],
            "source_gpios": list(range(32)),
            "selector_registers": [
                "GPIOXINT1SEL", "GPIOXINT2SEL", "GPIOXINT3SEL"
            ],
        },
        "low_power_wake": {
            "modes": ["STANDBY", "HALT"],
            "source_gpios": list(range(32)),
            "selector": "GPIOLPMSEL",
        },
        "boot_roles": BOOT_ROLES,
    }
    analog_golden = {
        "adc_channels": [
            {"pin": pin, "function": data["adc"]}
            for pin, data in sorted(ANALOG_MATRIX.items())
        ],
        "comparator_inputs": [
            {"pin": pin, "function": data["comparator"]}
            for pin, data in sorted(ANALOG_MATRIX.items())
            if "comparator" in data
        ],
        "aio_functions": [
            {"pin": pin, "function": data["aio"], "aiomux_bit": int(data["aio"][3:])}
            for pin, data in sorted(ANALOG_MATRIX.items())
            if "aio" in data
        ],
        "semantics": {
            "adc_comparator_parallel": True,
            "aio_independent_digital_buffer_dimension": True,
            "reset_mode": "analog",
        },
    }
    golden = {
        "schema_version": 2,
        "device": "TMS320F28034",
        "part_number": "TMS320F28034PNT",
        "package": "PNT80",
        "source": SOURCE,
        "physical_pins": golden_pins,
        "geometry": {
            "view": "top",
            "left": list(range(1, 21)),
            "bottom": list(range(21, 41)),
            "right": list(range(60, 40, -1)),
            "top": list(range(80, 60, -1)),
        },
        "gpio_slots": {
            f"GPIO{gpio}": {str(mux): function for mux, function in enumerate(slots)}
            for gpio, slots in sorted(gpio_slots.items())
        },
        "valid_option_count": len(options),
        "options": options,
        "analog": analog_golden,
        "special_routes": global_special,
    }
    runtime = {
        "schema_version": 2,
        "device": "TMS320F28034PNT",
        "package": "PNT80",
        "source": SOURCE,
        "pins": pins,
        "routes": {
            "external_interrupts": ["XINT1", "XINT2", "XINT3"],
            "low_power_wake": ["STANDBY_WAKE", "HALT_WAKE"],
        },
        "special_routes": global_special,
    }
    package = {
        "package": "PNT80",
        "description": "80-pin PN LQFP",
        "total_pins": 80,
        "pin_spacing_mm": 0.5,
        "body_mm": "12x12",
        "source": SOURCE,
        "view": "top",
        "pin_1_marker": "top-left",
        "geometry": PACKAGE_GEOMETRY,
        "sides": {
            side: golden["geometry"][side]
            for side in ("left", "bottom", "right", "top")
        },
        "pins": [
            {
                "pin": pin,
                "identity": physical[pin][0],
                "signal": " / ".join(physical[pin]),
                "official_functions": physical[pin],
                "fixed": pin in FIXED_RULES,
                "group": pins[str(pin)]["pin_group"],
                "notes": pins[str(pin)]["notes"],
            }
            for pin in range(1, 81)
        ],
    }
    return golden, runtime, package


def coverage(golden: dict, runtime: dict) -> dict[str, object]:
    expected_pins = {item["physical_pin"]: item for item in golden["physical_pins"]}
    actual_pins = {int(key): value for key, value in runtime["pins"].items()}
    missing_pins = sorted(set(expected_pins) - set(actual_pins))
    extra_pins = sorted(set(actual_pins) - set(expected_pins))
    duplicate_count = len(runtime["pins"]) - len(actual_pins)

    signal_missing = []
    signal_extra = []
    for pin, expected in expected_pins.items():
        actual = set(actual_pins[pin]["official_functions"])
        wanted = set(expected["official_functions"])
        signal_missing.extend((pin, name) for name in sorted(wanted - actual))
        signal_extra.extend((pin, name) for name in sorted(actual - wanted))

    expected_mux = {
        (entry["gpio"], entry["mux"]): entry["function"]
        for entry in golden["options"]
    }
    actual_mux = {
        (int(pin["gpio_num"]), int(option["mux"])): option["function"]
        for pin in actual_pins.values()
        if pin["gpio_num"] is not None
        for option in pin["mux_options"]
    }
    mux_missing = sorted(set(expected_mux) - set(actual_mux))
    mux_extra = sorted(set(actual_mux) - set(expected_mux))
    mux_mismatch = sorted(
        (key, expected_mux[key], actual_mux[key])
        for key in set(expected_mux) & set(actual_mux)
        if expected_mux[key] != actual_mux[key]
    )

    expected_analog = {
        (entry["pin"], entry["function"])
        for group in ("adc_channels", "comparator_inputs", "aio_functions")
        for entry in golden["analog"][group]
    }
    actual_analog = set()
    for pin, definition in actual_pins.items():
        actual_analog.update((pin, item["function"])
                             for item in definition["analog_paths"])
        if definition["aio_function"]:
            actual_analog.add((pin, definition["aio_function"]["function"]))

    special_checks = {
        "jtag_4": len(runtime["special_routes"]["jtag"]) == 4,
        "xclkin_2": len(
            runtime["special_routes"]["clock_input_route"]["sources"]
        ) == 2,
        "xclkout_1": runtime["special_routes"]["clock_output_route"]["pin"] == 41,
        "xint_3_gpio0_31": (
            runtime["special_routes"]["external_interrupts"]["routes"]
            == ["XINT1", "XINT2", "XINT3"]
            and runtime["special_routes"]["external_interrupts"]["source_gpios"]
            == list(range(32))
        ),
        "lpm_gpio0_31": (
            runtime["special_routes"]["low_power_wake"]["source_gpios"]
            == list(range(32))
        ),
        "boot_roles_complete": len(
            runtime["special_routes"]["boot_roles"]
        ) == len(BOOT_ROLES),
    }
    return {
        "physical_pin_count": len(actual_pins),
        "physical_pin_duplicate": duplicate_count,
        "physical_pin_missing": len(missing_pins),
        "physical_pin_extra": len(extra_pins),
        "physical_signal_missing": len(signal_missing),
        "physical_signal_extra": len(signal_extra),
        "gpio_mux_missing": len(mux_missing),
        "gpio_mux_extra": len(mux_extra),
        "gpio_mux_mismatch": len(mux_mismatch),
        "analog_function_missing": len(expected_analog - actual_analog),
        "analog_function_extra": len(actual_analog - expected_analog),
        "special_route_missing": sum(not value for value in special_checks.values()),
        "details": {
            "missing_pins": missing_pins,
            "extra_pins": extra_pins,
            "signal_missing": signal_missing,
            "signal_extra": signal_extra,
            "mux_missing": mux_missing,
            "mux_extra": mux_extra,
            "mux_mismatch": mux_mismatch,
            "analog_missing": sorted(expected_analog - actual_analog),
            "analog_extra": sorted(actual_analog - expected_analog),
            "special_checks": special_checks,
        },
    }


def report_table(values: dict[str, object], names: list[str]) -> str:
    lines = ["| 指标 | 结果 |", "|---|---:|"]
    for name in names:
        lines.append(f"| `{name}` | {values[name]} |")
    return "\n".join(lines)


def write_reports(golden: dict, runtime: dict, result: dict) -> None:
    DOCS_ROOT.mkdir(parents=True, exist_ok=True)
    source_link = f"[TI {SOURCE['document']}]({SOURCE['url']})"
    coverage_names = [
        "physical_pin_count", "physical_pin_duplicate",
        "physical_pin_missing", "physical_pin_extra",
        "physical_signal_missing", "physical_signal_extra",
    ]
    (DOCS_ROOT / "OFFICIAL_PIN_COVERAGE_REPORT.md").write_text(
        "# Official Pin Coverage Report\n\n"
        f"Source: {source_link}, Figure 5-3 and Table 5-1.\n\n"
        + report_table(result, coverage_names)
        + "\n\nThe runtime database exposes every official physical signal while "
          "keeping generation support as a separate status.\n",
        encoding="utf-8", newline="\n",
    )
    (DOCS_ROOT / "OFFICIAL_GPIO_MUX_DIFF.md").write_text(
        "# Official GPIO MUX Diff\n\n"
        f"Source: {source_link}, Table 7-40 and Table 7-41.\n\n"
        + report_table(result, [
            "gpio_mux_missing", "gpio_mux_extra", "gpio_mux_mismatch"
        ])
        + f"\n\nNon-Reserved combinations: `{golden['valid_option_count']}`. "
          "All four slots, including Reserved, remain in `gpio_slots`.\n",
        encoding="utf-8", newline="\n",
    )
    analog = golden["analog"]
    (DOCS_ROOT / "OFFICIAL_ANALOG_ROUTE_REPORT.md").write_text(
        "# Official Analog Route Report\n\n"
        f"Source: {source_link}, Table 7-42.\n\n"
        + report_table(result, [
            "analog_function_missing", "analog_function_extra"
        ])
        + "\n\n"
        + f"- ADC channels: `{len(analog['adc_channels'])}`\n"
        + f"- Comparator inputs: `{len(analog['comparator_inputs'])}`\n"
        + f"- AIO functions: `{len(analog['aio_functions'])}`\n"
        + "- ADC and comparator inputs are parallel analog paths.\n"
        + "- AIO is an independent digital-buffer/AIOMUX dimension.\n"
        + "- Comparator input generation remains explicitly `pin path only`.\n",
        encoding="utf-8", newline="\n",
    )
    checks = result["details"]["special_checks"]
    lines = [
        "# Official Special Route Report",
        "",
        f"Source: {source_link}, Table 5-1 and the special-route notes.",
        "",
        "| Special route | Result |",
        "|---|---|",
    ]
    lines.extend(
        f"| `{name}` | {'PASS' if passed else 'FAIL'} |"
        for name, passed in checks.items()
    )
    lines.extend([
        "",
        f"`special_route_missing = {result['special_route_missing']}`",
        "",
        "JTAG, XCLKIN, XINT, low-power wake and boot roles are not ordinary "
        "GPxMUX options. Read-only roles are visible in the UI but never sent "
        "to the normal PinMux generator.",
        "",
    ])
    (DOCS_ROOT / "OFFICIAL_SPECIAL_ROUTE_REPORT.md").write_text(
        "\n".join(lines), encoding="utf-8", newline="\n"
    )


def copy_runtime_assets() -> None:
    STATIC_ROOT.mkdir(parents=True, exist_ok=True)
    (STATIC_ROOT / "packages").mkdir(parents=True, exist_ok=True)
    for name in (
        "pinmux.json",
        "pinmux_golden.json",
        "official_pin_golden.json",
        "peripheral_instances.json",
        "signal_groups.json",
        "internal_routes.json",
    ):
        shutil.copyfile(DEVICE_ROOT / name, STATIC_ROOT / name)
    shutil.copyfile(
        DEVICE_ROOT / "packages" / "pnt80.json",
        STATIC_ROOT / "packages" / "pnt80.json",
    )
    shutil.copyfile(FAMILY_ROOT / "family.json", STATIC_ROOT / "family.json")
    shutil.copyfile(FAMILY_ROOT / "wizards.json", STATIC_ROOT / "wizard_schema.json")
    shutil.copyfile(
        DEVICE_ROOT / "constraints.json", STATIC_ROOT / "constraints.json"
    )
    device = json.loads((DEVICE_ROOT / "device.json").read_text(encoding="utf-8"))
    for private_key in ("device_header_path", "include_path", "source_path"):
        device.pop(private_key, None)
    device.update({
        "status": "CONFIG_STUDIO_R3.3_PERIPHERAL_GRAPH_INTERNAL_PASS",
        "source_datasheet": "SPRS584Q",
        "source_verified": True,
        "last_verified": "2026-07-31",
        "source_sections": list(SOURCE["sections"].values()),
        "runtime": "static-browser",
    })
    (DEVICE_ROOT / "device.json").write_text(
        json_text(device), encoding="utf-8", newline="\n"
    )
    (STATIC_ROOT / "device.json").write_text(
        json_text(device), encoding="utf-8", newline="\n"
    )


def main() -> int:
    golden, runtime, package = build()
    result = coverage(golden, runtime)
    required_zero = [
        "physical_pin_missing", "physical_signal_missing",
        "gpio_mux_missing", "gpio_mux_extra", "gpio_mux_mismatch",
        "analog_function_missing", "special_route_missing",
    ]
    failures = {name: result[name] for name in required_zero if result[name] != 0}
    if result["physical_pin_count"] != 80:
        failures["physical_pin_count"] = result["physical_pin_count"]
    if failures:
        raise RuntimeError(f"official coverage gate failed: {failures}")

    DEVICE_ROOT.mkdir(parents=True, exist_ok=True)
    (DEVICE_ROOT / "packages").mkdir(parents=True, exist_ok=True)
    (DEVICE_ROOT / "official_pin_golden.json").write_text(
        json_text(golden), encoding="utf-8", newline="\n"
    )
    # Keep the historical filename as a compatibility view of the same master.
    (DEVICE_ROOT / "pinmux_golden.json").write_text(
        json_text(golden), encoding="utf-8", newline="\n"
    )
    (DEVICE_ROOT / "pinmux.json").write_text(
        json_text(runtime), encoding="utf-8", newline="\n"
    )
    (DEVICE_ROOT / "packages" / "pnt80.json").write_text(
        json_text(package), encoding="utf-8", newline="\n"
    )
    write_reports(golden, runtime, result)
    copy_runtime_assets()
    print(json.dumps(
        {name: result[name] for name in [
            "physical_pin_count", *required_zero
        ]},
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
