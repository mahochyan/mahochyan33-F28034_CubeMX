# R3 TI C2000 Compile and Link Log

- Command: `python tests\ccs_build_check.py`
- Compiler: `C:\ti\ccs2100\ccs\tools\compiler\ti-cgt-c2000_25.11.1.LTS\bin\cl2000.exe`
- ABI: `coffabi`
- Link command files:
  - `D:\CCS21_workspace\LLC_100W_F28034\28034_RAM_lnk.cmd`
  - `D:\CCS21_workspace\LLC_100W_F28034\DSP2803x_Headers_nonBIOS.cmd`

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
