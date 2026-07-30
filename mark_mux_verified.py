#!/usr/bin/env python3
"""
mark_mux_verified.py — flip source_verified=false -> true for selected pins
after manual confirmation against SPRS584Q Table 5-1.

Usage:
    python mark_mux_verified.py 69 68 47        # verify specific physical pins
    python mark_mux_verified.py --all-epwm      # verify all ePWM/TZ pins for LLC
    python mark_mux_verified.py --list          # list unverified pins

Only run AFTER you have personally checked the MUX numbering in the datasheet.
The constraint checker refuses to export any unverified MUX assignment.
"""

import json
import pathlib
import sys

BASE = pathlib.Path(__file__).parent
PINMUX = BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json"

# Pins the 100W LLC project relies on (main switches + trip + LED + ADC trigger).
LLC_CORE_PINS = [69, 68, 47, 75, 78, 79, 80]


def load():
    return json.loads(PINMUX.read_text(encoding="utf-8"))


def save(d):
    PINMUX.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")


def unverified(d):
    out = []
    for p in d["pins"].values():
        for m in p.get("mux_options", []):
            if m.get("source_verified") is False:
                out.append((p["physical_pin"], p["primary_signal"], m["mux"], m["function"]))
    return out


def mark(d, pins):
    changed = 0
    for p in d["pins"].values():
        if p["physical_pin"] not in pins:
            continue
        for m in p.get("mux_options", []):
            if m.get("source_verified") is False:
                m["source_verified"] = True
                changed += 1
    return changed


def main():
    args = sys.argv[1:]
    d = load()
    if not args or "--list" in args:
        unv = unverified(d)
        print(f"{len(unv)} unverified MUX entries:")
        for pin, sig, mux, fn in unv:
            print(f"  pin {pin:3d}  {sig:10s}  MUX{mux}  {fn}")
        return

    pins = set()
    if "--all-epwm" in args:
        pins.update(LLC_CORE_PINS)
    for a in args:
        if a.isdigit():
            pins.add(int(a))

    if not pins:
        print("no pins specified. Use --list to see unverified entries.")
        return

    n = mark(d, pins)
    if n:
        save(d)
    print(f"marked {n} MUX entries verified on pins {sorted(pins)}")
    print("re-run: python build_device_db.py is NOT needed (edited pinmux.json in place)")
    print("NOTE: only do this after checking SPRS584Q Table 5-1.")


if __name__ == "__main__":
    main()
