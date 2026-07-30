# R3 TI C2000 Compile and Link Log

- Command: `python tests\ccs_build_check.py`
- Compiler: `<C2000_CGT_ROOT>\bin\cl2000.exe`
- ABI: `coffabi`
- Link command files:
  - `<CCS_PROJECT_ROOT>\28034_RAM_lnk.cmd`
  - `<CCS_PROJECT_ROOT>\DSP2803x_Headers_nonBIOS.cmd`

| Scenario | Compile | Link | Errors |
|---|---|---|---:|
| gpio_only | pass | pass | 0 |
| clock_60mhz | pass | pass | 0 |
| epwm_complementary | pass | pass | 0 |
| adc_soc | pass | pass | 0 |
| timer_20us | pass | pass | 0 |
| full_init | pass | pass | 0 |

Total: **6 scenarios, 0 errors**.

This gate compiles every generated C file, the required TI support C/ASM
sources, and then performs a full link for every scenario.
