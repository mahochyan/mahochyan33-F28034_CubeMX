# Official GPIO MUX Diff

Source: [TI SPRS584Q](https://www.ti.com/lit/ds/sprs584q/sprs584q.pdf), Table 7-40 and Table 7-41.

| 指标 | 结果 |
|---|---:|
| `gpio_mux_missing` | 0 |
| `gpio_mux_extra` | 0 |
| `gpio_mux_mismatch` | 0 |

Non-Reserved combinations: `127`. All four slots, including Reserved, remain in `gpio_slots`.
