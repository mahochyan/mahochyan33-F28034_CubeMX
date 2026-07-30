import json
import pathlib
import unittest

from generator.codegen import generate_project

BASE = pathlib.Path(__file__).resolve().parents[1]
PINMUX = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json")
                    .read_text(encoding="utf-8"))
FAMILY = json.loads((BASE / "devices/ti/c2000/f2803x/family.json")
                    .read_text(encoding="utf-8"))


def empty():
    return {
        "schema_version": 3, "device": "TMS320F28034", "package": "PNT80",
        "system_clock": None, "pins": {}, "pwm_modules": {},
        "adc": None, "timers": {}, "protection": None,
    }


def epwm_pin(pin, function, module, derived=False):
    pdef = PINMUX["pins"][str(pin)]
    option = next(item for item in pdef["mux_options"] if item["function"] == function)
    return {
        "physical_pin": pin, "signal": pdef["primary_signal"],
        "gpio_num": pdef["gpio_num"], "mux": option["mux"],
        "function": function, "type": "epwm", "module": module,
        "derived": derived, "electrical_profile": "epwm_output",
    }


class TestCodegenSemantics(unittest.TestCase):
    def test_unconfigured_modules_emit_no_module_files(self):
        result = generate_project("TMS320F28034", empty(), PINMUX, FAMILY)
        files = result["files"]
        self.assertNotIn("adc_init.c", files)
        self.assertNotIn("timer_interrupt_init.c", files)
        self.assertNotIn("pwm_init.c", files)
        self.assertNotIn("system_clock_init.c", files)
        self.assertNotIn("protection_init.c", files)
        self.assertNotIn("ADCINA0", "\n".join(files.values()))
        self.assertNotIn("CpuTimer0Regs", "\n".join(files.values()))

    def test_epwm_up_down_duty_and_complementary_semantics(self):
        cfg = empty()
        cfg["pins"] = {
            "69": epwm_pin(69, "EPWM1A", "EPWM1"),
            "68": epwm_pin(68, "EPWM1B", "EPWM1", True),
        }
        cfg["pwm_modules"]["EPWM1"] = {
            "mode": "complementary", "pin_a": 69, "pin_b": 68,
            "source_channel": "A", "derived_channel": "B",
            "count_mode": "up_down", "frequency_hz": 100000, "duty": 0.25,
            "aq_profile": "set_cau_clear_cad",
            "deadband": {"enabled": True, "red_ns": 200, "fed_ns": 200},
            "trip": {"enabled": False},
        }
        result = generate_project("TMS320F28034", cfg, PINMUX, FAMILY, "EPWM1")
        code = result["files"]["pwm_init.c"]
        self.assertEqual(result["recommended_file"], "pwm_init.c")
        self.assertIn("TBPRD = 300U", code)
        self.assertIn("CMPA.half.CMPA = 225U", code)
        self.assertIn("AQCTLA.bit.CAU = 2U", code)
        self.assertIn("AQCTLA.bit.CAD = 1U", code)
        self.assertIn("DBCTL.bit.IN_MODE = 0U", code)
        self.assertIn("TZCTL.bit.TZA = 2U", code)
        self.assertIn("TZCTL.bit.TZB = 2U", code)

    def test_multiple_pwm_modules_are_all_generated(self):
        cfg = empty()
        cfg["pins"] = {
            "69": epwm_pin(69, "EPWM1A", "EPWM1"),
            "67": epwm_pin(67, "EPWM2A", "EPWM2"),
        }
        for name, pin in (("EPWM1", 69), ("EPWM2", 67)):
            cfg["pwm_modules"][name] = {
                "mode": "single", "pin_a": pin, "pin_b": None,
                "count_mode": "up", "frequency_hz": 100000, "duty": 0.5,
                "aq_profile": "set_zro_clear_cau",
                "deadband": {"enabled": False}, "trip": {"enabled": False},
            }
        code = generate_project("TMS320F28034", cfg, PINMUX, FAMILY)["files"]["pwm_init.c"]
        self.assertIn("EPwm1Regs", code)
        self.assertIn("EPwm2Regs", code)
        self.assertIn("EPWM1_ReleaseClamp", code)
        self.assertIn("EPWM2_ReleaseClamp", code)

    def test_scla_uses_gpio29_mux2_and_i2c_profile(self):
        cfg = empty()
        cfg["pins"]["34"] = {
            "physical_pin": 34, "signal": "GPIO29", "gpio_num": 29,
            "mux": 2, "function": "SCLA", "type": "i2c",
            "electrical_profile": "i2c_scla",
        }
        code = generate_project("TMS320F28034", cfg, PINMUX, FAMILY)["files"]["pinmux_init.c"]
        self.assertIn("GPAMUX2.bit.GPIO29 = 2U", code)
        self.assertIn("GPAPUD.bit.GPIO29 = 0U", code)
        self.assertIn("GPAQSEL2.bit.GPIO29 = 3U", code)
        self.assertIn("external pull-up resistors are required", code)


if __name__ == "__main__":
    unittest.main()
