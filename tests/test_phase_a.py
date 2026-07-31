"""
test_phase_a.py — database integrity tests for the F28034 device DB.

Run:  python -m unittest discover -s tests -v
"""

import json
import pathlib
import unittest

BASE = pathlib.Path(__file__).resolve().parents[1]
PART = BASE / "devices" / "ti" / "c2000" / "parts" / "tms320f28034"

PINMUX = json.loads((PART / "pinmux.json").read_text(encoding="utf-8"))
PKG = json.loads((PART / "packages" / "pnt80.json").read_text(encoding="utf-8"))
FAMILY = json.loads((BASE / "devices/ti/c2000/f2803x/family.json").read_text(encoding="utf-8"))
DEVICE = json.loads((PART / "device.json").read_text(encoding="utf-8"))
CONSTRAINTS = json.loads((PART / "constraints.json").read_text(encoding="utf-8"))

CTRL_REGS = {"GPAMUX1", "GPAMUX2", "GPBMUX1", "GPAQSEL1", "GPAQSEL2", "GPBQSEL1",
             "GPADIR", "GPBDIR", "GPAPUD", "GPBPUD"}
DATA_REGS = {"GPASET", "GPACLEAR", "GPATOGGLE", "GPADAT",
             "GPBSET", "GPBCLEAR", "GPBTOGGLE", "GPBDAT"}
VALID_AIO = {"AIO2", "AIO4", "AIO6", "AIO10", "AIO12", "AIO14"}
FIXED_SIGNALS = {"VDD", "VSS", "VDDIO", "VDDA", "VSSA", "VREFHI", "VREFLO",
                 "XRS", "TRST", "X1", "X2", "VREGENZ", "TEST2"}


def pins():
    return PINMUX["pins"]


def gpio_pins():
    return [p for p in pins().values() if p.get("gpio_num") is not None]


class TestPinTable(unittest.TestCase):
    def test_exactly_80_pins(self):
        self.assertEqual(len(pins()), 80)

    def test_package_is_80(self):
        self.assertEqual(PKG["total_pins"], 80)
        self.assertEqual(len(PKG["pins"]), 80)

    def test_pin_numbers_unique_and_contiguous(self):
        nums = sorted(int(k) for k in pins().keys())
        self.assertEqual(nums, list(range(1, 81)))

    def test_gpio_count_and_uniqueness(self):
        gp = gpio_pins()
        self.assertEqual(len(gp), 45)
        nums = [p["gpio_num"] for p in gp]
        self.assertEqual(len(nums), len(set(nums)), "duplicate GPIO numbers")

    def test_gpio_numbers_valid_range(self):
        for p in gpio_pins():
            self.assertTrue(0 <= p["gpio_num"] <= 44,
                            f"GPIO{p['gpio_num']} out of range")

    def test_every_mux_option_has_source(self):
        for p in gpio_pins():
            for m in p.get("mux_options", []):
                self.assertIn("source_document", m)
                self.assertIn("source_section", m)
                self.assertEqual(m["source_document"], "SPRS584Q")

    def test_mux_zero_is_gpio(self):
        for p in gpio_pins():
            m0 = [m for m in p["mux_options"] if m["mux"] == 0]
            self.assertEqual(len(m0), 1, f"pin {p['physical_pin']} missing MUX0")
            self.assertEqual(m0[0]["function"], p["primary_signal"])

    def test_mux_values_within_0_to_3(self):
        for p in gpio_pins():
            for m in p["mux_options"]:
                self.assertIn(m["mux"], (0, 1, 2, 3))


class TestRegisterMapping(unittest.TestCase):
    def test_ctrl_regs_are_ctrl(self):
        for p in gpio_pins():
            for key in ("mux_reg", "qsel_reg", "dir_reg", "pud_reg"):
                self.assertIn(p[key], CTRL_REGS,
                              f"{key}={p[key]} not a GpioCtrlRegs member")
                self.assertTrue(p[key.replace('_reg', '_field')].startswith("GpioCtrlRegs."),
                                f"{key} field must be GpioCtrlRegs.*")

    def test_data_regs_are_data(self):
        for p in gpio_pins():
            for key in ("set_reg", "clr_reg", "tog_reg", "dat_reg"):
                self.assertIn(p[key], DATA_REGS,
                              f"{key}={p[key]} not a GpioDataRegs member")
                self.assertTrue(p[key.replace('_reg', '_field')].startswith("GpioDataRegs."),
                                f"{key} field must be GpioDataRegs.*")

    def test_mux_reg_matches_gpio_number(self):
        for p in gpio_pins():
            g = p["gpio_num"]
            if g <= 15:
                self.assertEqual(p["mux_reg"], "GPAMUX1")
            elif g <= 31:
                self.assertEqual(p["mux_reg"], "GPAMUX2")
            else:
                self.assertEqual(p["mux_reg"], "GPBMUX1")

    def test_port_and_bit(self):
        for p in gpio_pins():
            g = p["gpio_num"]
            self.assertEqual(p["port"], "A" if g <= 31 else "B")
            self.assertEqual(p["bit_in_port"], g % 32)


class TestFixedPins(unittest.TestCase):
    def test_fixed_signals_not_configurable(self):
        for p in pins().values():
            if p["primary_signal"] in FIXED_SIGNALS:
                self.assertFalse(p["configurable"],
                                 f"{p['primary_signal']} pin {p['physical_pin']} must not be configurable")
                self.assertEqual(p.get("mux_options", []), [])

    def test_power_ground_counts(self):
        from collections import Counter
        c = Counter(p["pin_group"] for p in pins().values())
        self.assertEqual(c["power"], 6)    # VDD x3 + VDDIO x2 + VDDA x1
        self.assertEqual(c["ground"], 5)   # VSS x4 + VSSA x1

    def test_expected_fixed_pins(self):
        fixed = {p["primary_signal"] for p in pins().values() if not p["configurable"]}
        for sig in ("XRS", "TRST", "X1", "X2", "VREGENZ", "TEST2",
                    "VREFHI", "VREFLO", "VDDA", "VSSA"):
            self.assertIn(sig, fixed)


class TestAioAndAnalog(unittest.TestCase):
    def test_aio_only_valid_subset(self):
        for p in pins().values():
            if p.get("aio"):
                self.assertIn(p["aio"], VALID_AIO,
                              f"{p['aio']} is not a real digital AIO")

    def test_analog_channels_present(self):
        adc = [p for p in pins().values() if p["pin_type"] == "analog"]
        self.assertEqual(len(adc), 16)
        names = {p["primary_signal"] for p in adc}
        for n in ("ADCINA0", "ADCINA7", "ADCINB0", "ADCINB7"):
            self.assertIn(n, names)


class TestGpio19NonMux(unittest.TestCase):
    def test_gpio19_xclkin_is_non_mux(self):
        p55 = pins()["55"]
        self.assertEqual(p55["primary_signal"], "GPIO19")
        mux_fns = [m["function"] for m in p55["mux_options"]]
        self.assertNotIn("XCLKIN", mux_fns, "XCLKIN must NOT occupy a GPAMUX slot")
        self.assertIn("ECAP1", mux_fns, "ECAP1 must be kept inside MUX slots")
        nm = [a["function"] for a in p55.get("special_routes", [])]
        self.assertIn("XCLKIN", nm)

    def test_xclkin_selector_symbol(self):
        p55 = pins()["55"]
        sel = next(
            item["controlled_by"] for item in p55["special_routes"]
            if item["function"] == "XCLKIN"
        )
        self.assertEqual(sel, "XCLKINSEL")


class TestReverseIndexWorthiness(unittest.TestCase):
    """Spot-check that key LLC functions resolve to the expected physical pins."""

    def _find(self, fn):
        out = []
        for p in gpio_pins():
            for m in p.get("mux_options", []):
                if m["function"] == fn:
                    out.append((p["physical_pin"], p["gpio_num"], m["mux"]))
        return out

    def test_epwm1a_only_gpio0(self):
        self.assertEqual(self._find("EPWM1A"), [(69, 0, 1)])

    def test_epwm1b_gpio1(self):
        self.assertEqual(self._find("EPWM1B"), [(68, 1, 1)])

    def test_tz1_two_pins(self):
        got = sorted(self._find("TZ1"))
        self.assertEqual(got, [(47, 12, 1), (75, 15, 1)])

    def test_ecap1_reachable(self):
        got = self._find("ECAP1")
        self.assertTrue(len(got) >= 2, "ECAP1 should be reachable via GPIO19/GPIO5/GPIO24")

    def test_epwm_all_seven_present(self):
        for n in range(1, 8):
            self.assertTrue(self._find(f"EPWM{n}A"), f"EPWM{n}A missing")
            self.assertTrue(self._find(f"EPWM{n}B"), f"EPWM{n}B missing")


class TestConstraintsTable(unittest.TestCase):
    def test_rules_have_id_and_severity(self):
        for r in CONSTRAINTS["rules"]:
            self.assertIn("id", r)
            self.assertIn(r["severity"], ("ERROR", "WARNING"))

    def test_shoot_through_rules_exist(self):
        ids = {r["id"] for r in CONSTRAINTS["rules"]}
        for needed in ("PIN_CONFLICT", "PWM_NO_TRIP", "PWM_DEADBAND_ZERO",
                       "TBCLKSYNC_NOT_RESTORED", "UNRESOLVED_PARAM"):
            self.assertIn(needed, ids)

    def test_power_pin_gpio_is_error(self):
        r = next(x for x in CONSTRAINTS["rules"] if x["id"] == "POWER_PIN_GPIO")
        self.assertEqual(r["severity"], "ERROR")


class TestDeviceInfo(unittest.TestCase):
    def test_supported_and_offline(self):
        self.assertEqual(
            DEVICE["status"],
            "CONFIG_STUDIO_R3.3_PERIPHERAL_GRAPH_INTERNAL_PASS",
        )
        self.assertEqual(DEVICE["max_sysclk_mhz"], 60)
        sr = DEVICE["safety_rules"]
        self.assertTrue(sr["no_jtag"])
        self.assertTrue(sr["no_flash_write"])
        self.assertTrue(sr["no_auto_pwm_enable"])

    def test_family_pclkcr_tbclksync_in_pclkcr0(self):
        # TBCLKSYNC lives in PCLKCR0 (verified in DSP2803x_SysCtrl.h), not PCLKCR1.
        self.assertEqual(FAMILY["tbclksync_bit"]["reg"], "PCLKCR0")
        self.assertEqual(FAMILY["tbclksync_bit"]["bit"], "TBCLKSYNC")


if __name__ == "__main__":
    unittest.main()
