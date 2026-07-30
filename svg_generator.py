#!/usr/bin/env python3
"""
svg_generator.py
----------------
Renders the PNT80 (80-pin LQFP) chip diagram as an interactive SVG.

Reads ONLY:
    devices/ti/c2000/parts/tms320f28034/pinmux.json
    devices/ti/c2000/parts/tms320f28034/packages/pnt80.json

Writes:
    web/img/chip_pnt80.svg

No pin data is hard-coded here. Re-run whenever the device database changes.
Run:  python svg_generator.py
"""

import json
import pathlib

BASE = pathlib.Path(__file__).parent
PINMUX = BASE / "devices/ti/c2000/parts/tms320f28034/pinmux.json"
PKG = BASE / "devices/ti/c2000/parts/tms320f28034/packages/pnt80.json"
OUT = BASE / "web/img/chip_pnt80.svg"

# LQFP80 standard layout: pin 1 at upper-left, numbered counter-clockwise.
# Verified grouping against SPRS584Q Fig 5-3 (R2 geometry fix):
#   left   = 1..20, top-to-bottom
#   bottom = 21..40, left-to-right
#   right  = 60..41, top-to-bottom
#   top    = 80..61, left-to-right
SIDES = {
    "left": list(range(1, 21)),
    "bottom": list(range(21, 41)),
    "right": list(range(60, 40, -1)),
    "top": list(range(80, 60, -1)),
}

BODY = 420            # chip body square side (px)
PAD = 130             # clearance around body for pins + labels
CW = BODY + 2 * PAD   # canvas width  = 680? -> we use square 1180 via SCALE
# Use a comfortably large canvas so text is legible.
CANVAS = 1180
BODY_PX = 470
PAD_PX = (CANVAS - BODY_PX) // 2   # 355

PIN_LEN = 46
PIN_W = 13
STEP = BODY_PX / 20.0            # 23.5 px per pin along a side
FS_NUM = 10
FS_SIG = 11

STATE_COLORS = {
    "default": "#3a4150",
    "avail":   "#2f6fde",   # blue   : candidate for active function
    "sel":     "#2ea44f",   # green  : selected
    "occ":     "#d4a017",   # yellow : occupied
    "err":     "#d43a3a",   # red    : conflict
    "fixed":   "#262a31",   # grey   : power/gnd/fixed
}


def side_of(pin: int) -> str:
    for name, pins in SIDES.items():
        if pin in pins:
            return name
    return "left"


def position(pin: int):
    """Return (x, y, rotate_deg, text_anchor) for the pad of physical pin."""
    idx = SIDES[side_of(pin)].index(pin)
    offset = PAD_PX + STEP * (idx + 0.5)
    if side_of(pin) == "left":
        return PAD_PX - PIN_LEN, offset, 0, "end"
    if side_of(pin) == "bottom":
        return offset, PAD_PX + BODY_PX + PIN_LEN, -90, "start"
    if side_of(pin) == "right":
        return PAD_PX + BODY_PX + PIN_LEN, offset, 0, "start"
    # top
    return offset, PAD_PX - PIN_LEN, -90, "end"


def label(pin: dict) -> str:
    return pin.get("primary_signal", "?")


def alt_label(pin: dict) -> str:
    """Short text shown under the main label for GPIO pins."""
    if "gpio_num" in pin and pin.get("mux_options"):
        alts = [m["function"] for m in pin["mux_options"][1:]]
        if alts:
            return " / ".join(alts)
    return ""


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def css() -> str:
    c = STATE_COLORS
    return f"""
  .pin {{ cursor:pointer; }}
  .pin.fixed {{ cursor:default; }}
  .pin .pad {{ stroke:#0d1117; stroke-width:1; transition:fill .12s, stroke .12s; }}
  .pin .lbl {{ fill:#c9d1d9; font:600 {FS_SIG}px Consolas,Menlo,monospace;
               pointer-events:none; }}
  .pin .num {{ fill:#8b949e; font:{FS_NUM}px Consolas,Menlo,monospace;
               pointer-events:none; }}
  .pin .alt {{ fill:#6e7681; font:{FS_NUM - 1}px Consolas,Menlo,monospace;
               pointer-events:none; }}
  .pin .pad     {{ fill:{c['default']}; }}
  .pin.fixed .pad {{ fill:{c['fixed']}; }}
  .pin.st-avail .pad {{ fill:{c['avail']}; stroke:#7fb0ff; }}
  .pin.st-sel   .pad {{ fill:{c['sel']};   stroke:#7fe0a0; }}
  .pin.st-occ   .pad {{ fill:{c['occ']};   stroke:#ffd970; }}
  .pin.st-err   .pad {{ fill:{c['err']};   stroke:#ff8080; }}
  .pin:not(.fixed):hover .pad {{ stroke:#ffffff; stroke-width:1.6; }}
"""


def build_svg(pins: dict) -> str:
    svg = []
    svg.append('<?xml version="1.0" encoding="UTF-8"?>')
    svg.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {CANVAS} {CANVAS}" id="chip-svg" '
        f'font-family="Consolas,Menlo,monospace">'
    )
    svg.append(f"<style>{css()}</style>")

    # Chip body
    svg.append(
        f'<rect x="{PAD_PX}" y="{PAD_PX}" width="{BODY_PX}" height="{BODY_PX}" '
        f'rx="16" fill="#161b22" stroke="#30363d" stroke-width="2"/>'
    )
    # Pin-1 marker (upper-left corner)
    svg.append(
        f'<circle cx="{PAD_PX + 26}" cy="{PAD_PX + 26}" r="9" '
        f'fill="none" stroke="#8b949e" stroke-width="2"/>'
    )
    svg.append(
        f'<text x="{PAD_PX + BODY_PX / 2:.0f}" y="{PAD_PX + BODY_PX / 2 - 8:.0f}" '
        f'text-anchor="middle" fill="#e6edf3" font-size="26" font-weight="700">'
        f'TMS320F28034</text>'
    )
    svg.append(
        f'<text x="{PAD_PX + BODY_PX / 2:.0f}" y="{PAD_PX + BODY_PX / 2 + 20:.0f}" '
        f'text-anchor="middle" fill="#8b949e" font-size="15">'
        f'PNT 80-pin LQFP  |  SPRS584Q</text>'
    )

    # Pins
    for pnum in range(1, 81):
        pin = pins.get(str(pnum))
        if pin is None:
            continue
        x, y, rot, anchor = position(pnum)
        fixed = not pin.get("configurable", False)
        cls = "pin fixed" if fixed else "pin"
        ptype = pin.get("pin_type", "")
        gpio = pin.get("gpio_num", "")
        sig = label(pin)
        alt = alt_label(pin)

        svg.append(
            f'<g class="{cls}" data-pin="{pnum}" data-type="{esc(ptype)}" '
            f'data-gpio="{gpio}" data-signal="{esc(sig)}" '
            f'data-configurable="{0 if fixed else 1}">'
        )
        # Pad rectangle
        svg.append(
            f'  <rect class="pad" x="{x:.1f}" y="{y - PIN_W / 2:.1f}" '
            f'width="{PIN_LEN}" height="{PIN_W}" rx="2" '
            f'transform="rotate({rot} {x:.1f} {y:.1f})"/>'
        )
        # Physical pin number (outside pad)
        nox, noy = x, y
        if side_of(pnum) == "left":
            nox = x - 6; noy = y + 3
        elif side_of(pnum) == "right":
            nox = x + PIN_LEN + 6; noy = y + 3
        elif side_of(pnum) == "bottom":
            noy = y + PIN_LEN + 12
        else:  # top
            noy = y - 8
        svg.append(
            f'  <text class="num" x="{nox:.1f}" y="{noy:.1f}" '
            f'text-anchor="{anchor}" '
            f'transform="rotate({rot} {nox:.1f} {noy:.1f})">{pnum}</text>'
        )
        # Signal label (inside pad / near body)
        if side_of(pnum) in ("left", "right"):
            lx = x + (PIN_LEN - 4 if side_of(pnum) == "left" else 4)
            ly = y + 3.5
            svg.append(
                f'  <text class="lbl" x="{lx:.1f}" y="{ly:.1f}" '
                f'text-anchor="{"end" if side_of(pnum)=="left" else "start"}">'
                f'{esc(sig)}</text>'
            )
            if alt:
                ay = y + 3.5 + 11
                svg.append(
                    f'  <text class="alt" x="{lx:.1f}" y="{ay:.1f}" '
                    f'text-anchor="{"end" if side_of(pnum)=="left" else "start"}">'
                    f'{esc(alt)}</text>'
                )
        else:
            # top/bottom: rotate signal text
            ly = y + (PIN_LEN - 4 if side_of(pnum) == "bottom" else -4)
            svg.append(
                f'  <text class="lbl" x="{x:.1f}" y="{ly:.1f}" '
                f'text-anchor="{anchor}" '
                f'transform="rotate({rot} {x:.1f} {ly:.1f})">{esc(sig)}</text>'
            )
        svg.append("</g>")

    svg.append("</svg>")
    return "\n".join(svg)


def main():
    pins = json.loads(PINMUX.read_text(encoding="utf-8"))["pins"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    svg = build_svg(pins)
    OUT.write_text(svg, encoding="utf-8")
    n_pin_groups = svg.count('<g class="pin')
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {n_pin_groups} pin groups)")
    if n_pin_groups != 80:
        print(f"  WARNING: expected 80 pin groups, got {n_pin_groups}")


if __name__ == "__main__":
    main()
