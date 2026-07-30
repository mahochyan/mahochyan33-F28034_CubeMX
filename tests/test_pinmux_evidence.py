import json
import pathlib
import unittest

BASE = pathlib.Path(__file__).resolve().parents[1]
PINMUX = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json")
                    .read_text(encoding="utf-8"))
EVIDENCE = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/pinmux_evidence.json")
                      .read_text(encoding="utf-8"))


class TestPinmuxEvidence(unittest.TestCase):
    def test_every_option_has_split_evidence(self):
        count = 0
        for physical, pin in PINMUX["pins"].items():
            for option in pin.get("mux_options", []):
                count += 1
                self.assertIs(option["signal_verified"], True)
                self.assertIs(option["mux_value_verified"], True)
                self.assertIsInstance(option["generator_supported"], bool)
                purposes = {item["purpose"] for item in option["evidence"]}
                self.assertIn("signal availability on physical pin", purposes)
                self.assertIn("numeric mux value", purposes)
        self.assertEqual(count, 131)

    def test_evidence_keys_are_per_option_and_unique(self):
        rows = EVIDENCE["rows"]
        keys = [row["key"] for row in rows]
        self.assertEqual(len(keys), 131)
        self.assertEqual(len(set(keys)), 131)
        self.assertIn("34:29:2:SCLA", keys)
        self.assertIn("69:0:1:EPWM1A", keys)
        self.assertIn("68:1:1:EPWM1B", keys)


if __name__ == "__main__":
    unittest.main()
