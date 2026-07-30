# Official Analog Route Report

Source: [TI SPRS584Q](https://www.ti.com/lit/ds/sprs584q/sprs584q.pdf), Table 7-42.

| 指标 | 结果 |
|---|---:|
| `analog_function_missing` | 0 |
| `analog_function_extra` | 0 |

- ADC channels: `16`
- Comparator inputs: `6`
- AIO functions: `6`
- ADC and comparator inputs are parallel analog paths.
- AIO is an independent digital-buffer/AIOMUX dimension.
- Comparator input generation remains explicitly `pin path only`.
