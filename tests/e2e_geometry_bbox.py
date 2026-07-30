import json
import pathlib
import unittest

BASE = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = json.loads((BASE / "devices/ti/c2000/parts/tms320f28034/packages/pnt80.json")
                     .read_text(encoding="utf-8"))


class TestPackageGeometry(unittest.TestCase):
    def test_package_order_and_corner_anchors(self):
        sides = PACKAGE["sides"]
        self.assertEqual(sides["left"], list(range(1, 21)))
        self.assertEqual(sides["bottom"], list(range(21, 41)))
        self.assertEqual(sides["right"], list(range(60, 40, -1)))
        self.assertEqual(sides["top"], list(range(80, 60, -1)))
        signals = {item["pin"]: item["signal"] for item in PACKAGE["pins"]}
        expected = {
            1: "GPIO22", 20: "VDDA", 21: "VSSA", 40: "GPIO28",
            41: "GPIO18", 60: "GPIO36", 61: "GPIO11", 80: "GPIO24",
        }
        self.assertEqual({pin: signals[pin] for pin in expected}, expected)

    def test_computed_pads_touch_body_and_do_not_overlap(self):
        g = PACKAGE["geometry"]
        body = g["body"]
        rects = []
        for side, pins in PACKAGE["sides"].items():
            vertical = side in ("left", "right")
            span = body["height"] if vertical else body["width"]
            step = span / len(pins)
            for index, pin in enumerate(pins):
                center = (body["y"] if vertical else body["x"]) + step * (index + 0.5)
                if side == "left":
                    rect = (body["x"] - g["pin_length"], center - g["pin_width"]/2,
                            g["pin_length"], g["pin_width"])
                    self.assertAlmostEqual(rect[0] + rect[2], body["x"], delta=0.5)
                elif side == "right":
                    rect = (body["x"] + body["width"], center - g["pin_width"]/2,
                            g["pin_length"], g["pin_width"])
                    self.assertAlmostEqual(rect[0], body["x"] + body["width"], delta=0.5)
                elif side == "top":
                    rect = (center - g["pin_width"]/2, body["y"] - g["pin_length"],
                            g["pin_width"], g["pin_length"])
                    self.assertAlmostEqual(rect[1] + rect[3], body["y"], delta=0.5)
                else:
                    rect = (center - g["pin_width"]/2, body["y"] + body["height"],
                            g["pin_width"], g["pin_length"])
                    self.assertAlmostEqual(rect[1], body["y"] + body["height"], delta=0.5)
                rects.append((pin, rect))
        self.assertEqual(len(rects), 80)
        for i, (pin_a, a) in enumerate(rects):
            for pin_b, b in rects[i + 1:]:
                overlap = not (a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0] or
                               a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1])
                self.assertFalse(overlap, f"Pin{pin_a} overlaps Pin{pin_b}")


if __name__ == "__main__":
    unittest.main()
