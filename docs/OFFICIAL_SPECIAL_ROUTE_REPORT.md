# Official Special Route Report

Source: [TI SPRS584Q](https://www.ti.com/lit/ds/sprs584q/sprs584q.pdf), Table 5-1 and the special-route notes.

| Special route | Result |
|---|---|
| `jtag_4` | PASS |
| `xclkin_2` | PASS |
| `xclkout_1` | PASS |
| `xint_3_gpio0_31` | PASS |
| `lpm_gpio0_31` | PASS |
| `boot_roles_complete` | PASS |

`special_route_missing = 0`

JTAG, XCLKIN, XINT, low-power wake and boot roles are not ordinary GPxMUX options. Read-only roles are visible in the UI but never sent to the normal PinMux generator.
