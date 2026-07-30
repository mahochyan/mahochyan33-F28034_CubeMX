import json
import pathlib
import unittest

from validators.constraint_checker import check

BASE = pathlib.Path(__file__).resolve().parents[1]
PINMUX = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json").read_text(encoding="utf-8"))
CONSTRAINTS = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/constraints.json").read_text(encoding="utf-8"))


def rules(findings):
    return {f["rule"] for f in findings}


def errors(findings):
    return [f for f in findings if f["severity"] == "ERROR"]


class TestPinChecks(unittest.TestCase):
    def test_power_pin_blocked(self):
        cfg = {"pins": [{"pin": 7, "signal": "VDD", "function": "GPIO", "mux": 0}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("POWER_PIN_GPIO", rules(f))
        self.assertTrue(errors(f))

    def test_pin_conflict(self):
        cfg = {"pins": [
            {"pin": 69, "signal": "GPIO0", "function": "EPWM1A", "mux": 1},
            {"pin": 69, "signal": "GPIO0", "function": "GPIO0", "mux": 0},
        ]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PIN_CONFLICT", rules(f))

    def test_invalid_mux(self):
        cfg = {"pins": [{"pin": 69, "signal": "GPIO0", "function": "X", "mux": 3}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("MUX_INVALID", rules(f))

    def test_unverified_mux_blocks_export(self):
        # A still-unverified peripheral MUX must block export.
        # GPIO19 MUX2=LINRXA was NOT flipped by mark_mux_verified (only LLC
        # core pins were), so it is a reliable unverified example.
        pin55 = PINMUX["pins"]["55"]
        unv = next((m for m in pin55["mux_options"]
                    if m["mux"] != 0 and m["source_verified"] is False), None)
        if unv is None:
            self.skipTest("no unverified MUX left on pin55 to test the block")
        cfg = {"pins": [{"pin": 55, "signal": "GPIO19",
                         "function": unv["function"], "mux": unv["mux"]}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("UNRESOLVED_PARAM", rules(f))
        self.assertTrue(any("SPRS584Q" in x["message"] for x in errors(f)))

    def test_epwm1a_now_verified(self):
        # After mark_mux_verified --all-epwm, EPWM1A on GPIO0 MUX1 is verified.
        cfg = {"pins": [{"pin": 69, "signal": "GPIO0", "function": "EPWM1A", "mux": 1}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertNotIn("UNRESOLVED_PARAM", rules(f))

    def test_verified_mux0_ok(self):
        cfg = {"pins": [{"pin": 69, "signal": "GPIO0", "function": "GPIO0", "mux": 0}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertFalse(errors(f), f"unexpected errors: {errors(f)}")


class TestEpwmChecks(unittest.TestCase):
    def test_deadband_zero_is_error(self):
        cfg = {"wizard": "epwm_complementary", "params": {"freq_hz": 100000, "dead_ns": 0}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PWM_DEADBAND_ZERO", rules(f))

    def test_tbprd_overflow(self):
        cfg = {"wizard": "epwm_complementary", "params": {"freq_hz": 50, "dead_ns": 200}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PWM_TBPRD_OVERFLOW", rules(f))

    def test_pwm_no_trip_warns(self):
        cfg = {"wizard": "epwm_complementary", "params": {"freq_hz": 100000, "dead_ns": 200}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PWM_NO_TRIP", rules(f))

    def test_deadband_overflow(self):
        cfg = {"wizard": "epwm_complementary", "params": {"freq_hz": 100000, "dead_ns": 50000}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PWM_DBRED_OVERFLOW", rules(f))


class TestClockAdc(unittest.TestCase):
    def test_pll_illegal(self):
        cfg = {"wizard": "system_clock", "params": {"target_mhz": 120}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("PLL_ILLEGAL", rules(f))

    def test_pll_60_ok(self):
        cfg = {"wizard": "system_clock", "params": {"target_mhz": 60}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertNotIn("PLL_ILLEGAL", rules(f))

    def test_acqps_short_warns(self):
        cfg = {"wizard": "adc_soc", "params": {"soc": 0, "acqps": 3}, "pins": []}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("ADC_ACQPS_TOO_SHORT", rules(f))


class TestAioConflict(unittest.TestCase):
    def test_aio_pin_as_gpio_blocked(self):
        # pin 16 = ADCINA2 / AIO2 ; assigning as GPIO (mux 0) must flag AIO conflict
        cfg = {"pins": [{"pin": 16, "signal": "ADCINA2", "function": "GPIO", "mux": 0}]}
        f = check(cfg, PINMUX, CONSTRAINTS)
        self.assertIn("ADC_AIO_CONFLICT", rules(f))


if __name__ == "__main__":
    unittest.main()
