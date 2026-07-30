from __future__ import annotations

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEVICE = ROOT / "devices" / "ti" / "c2000" / "parts" / "tms320f28034"


class TestR32MuxGolden(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pinmux = json.loads((DEVICE / "pinmux.json").read_text(encoding="utf-8"))
        cls.golden = json.loads(
            (DEVICE / "pinmux_golden.json").read_text(encoding="utf-8")
        )

    def effective(self):
        result = set()
        for pin in self.pinmux["pins"].values():
            gpio = pin.get("gpio_num")
            for option in pin.get("mux_options", []):
                result.add((int(gpio), int(option["mux"]), option["function"]))
        return result

    def test_exact_golden_match(self):
        actual = self.effective()
        expected = {
            (entry["gpio"], entry["mux"], entry["function"])
            for entry in self.golden["options"]
        }
        self.assertEqual(127, len(actual))
        self.assertEqual(set(), actual - expected, "extra must be zero")
        self.assertEqual(set(), expected - actual, "missing must be zero")

    def test_all_four_slots_are_preserved(self):
        for gpio, slots in self.golden["gpio_slots"].items():
            self.assertEqual({"0", "1", "2", "3"}, set(slots), gpio)

    def test_known_mux3_corrections(self):
        required = {
            (1, "COMP1OUT"), (8, "ADCSOCAO"), (10, "ADCSOCBO"),
            (13, "SPISOMIB"), (16, "TZ2n"), (17, "TZ3n"),
            (20, "COMP1OUT"), (21, "COMP2OUT"), (22, "LINTXA"),
            (23, "LINRXA"), (24, "SPISIMOB"), (25, "SPISOMIB"),
            (26, "SPICLKB"), (27, "SPISTEBn"), (34, "COMP3OUT"),
            (42, "COMP1OUT"), (43, "COMP2OUT"),
        }
        actual = self.effective()
        for gpio, function in required:
            self.assertIn((gpio, 3, function), actual)

    def test_jtag_is_not_a_normal_mux_candidate(self):
        forbidden = {
            (35, "TDI"), (36, "TMS"), (37, "TDO"), (38, "TCK")
        }
        for gpio, _mux, function in self.effective():
            self.assertNotIn((gpio, function), forbidden)

    def test_support_capabilities_are_split(self):
        for pin in self.pinmux["pins"].values():
            for option in pin.get("mux_options", []):
                self.assertIn("pin_config_supported", option)
                self.assertIn("peripheral_init_supported", option)
                self.assertTrue(option["signal_verified"])
                self.assertTrue(option["mux_value_verified"])


if __name__ == "__main__":
    unittest.main()
