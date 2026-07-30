import json
import pathlib
import unittest

BASE = pathlib.Path(__file__).resolve().parents[1]
PINMUX = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json")
                    .read_text(encoding="utf-8"))
GOLDEN = json.loads(
    (BASE / "devices/ti/c2000/parts/tms320f28034/official_pin_golden.json")
    .read_text(encoding="utf-8")
)


class TestPinmuxEvidence(unittest.TestCase):
    def test_every_option_has_split_evidence(self):
        count = 0
        for physical, pin in PINMUX["pins"].items():
            for option in pin.get("mux_options", []):
                count += 1
                self.assertIs(option["signal_verified"], True)
                self.assertIs(option["mux_value_verified"], True)
                self.assertIsInstance(option["generator_supported"], bool)
                self.assertEqual(len(option["evidence"]), 1)
                evidence = option["evidence"][0]
                self.assertEqual(evidence["document"], "SPRS584Q")
                self.assertIn(evidence["section"], ("Table 7-40", "Table 7-41"))
                self.assertEqual(evidence["gpio"], pin["gpio_num"])
                self.assertEqual(evidence["mux"], option["mux"])
        # R3.2 removes GPIO35..38 JTAG choices from the normal MUX candidate
        # set; the effective non-reserved golden option count is therefore 127.
        self.assertEqual(count, 127)

    def test_evidence_keys_are_per_option_and_unique(self):
        rows = GOLDEN["options"]
        keys = [
            f"{row['physical_pin']}:{row['gpio']}:{row['mux']}:{row['function']}"
            for row in rows
        ]
        self.assertEqual(len(keys), 127)
        self.assertEqual(len(set(keys)), 127)
        self.assertIn("34:29:2:SCLA", keys)
        self.assertIn("69:0:1:EPWM1A", keys)
        self.assertIn("68:1:1:EPWM1B", keys)


if __name__ == "__main__":
    unittest.main()
