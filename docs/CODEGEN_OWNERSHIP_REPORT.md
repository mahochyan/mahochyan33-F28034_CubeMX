# R3.3 代码生成所有权报告

唯一事实来源是完整的 schema v2 `ProjectConfig`。生成器每次从零重建全部文件；
上一版 C 文本和 `previousGeneratedFiles` 不参与任何生成判断。

| 生成文件 | 唯一配置来源 | 作用 |
|---|---|---|
| `pinmux_init.c/h` | `pins` | 安全锁存、数字 MUX、方向、上拉、输入资格；模拟输入不写 GPIO 寄存器 |
| `clock_init.c/h` | `system_clock` | 系统时钟基础配置和故障超时 |
| `pwm_init.c/h` | `pwm_modules` | ePWM 时基、比较、AQ、dead-band 与安全钳位 |
| `pwm_routing_init.c/h` | `pwm_sync_graph`、`pwm_event_triggers`、`trip_routes`、`interrupt_routes` | 内部同步、SOCA/B、Trip 与中断路由 |
| `adc_init.c/h` | `adc.reference_mode`、`adc.socs`、`adc.interrupts` | SOC0～SOC15 集合、触发、采样窗、ADCINT |
| `comparator_init.c/h` | `comparators` | COMP1～3 输入来源、DAC、滞回与极性 |
| `i2c_init.c/h` | `i2c_modules` | I2C 模块时钟、角色、地址、速率、FIFO |
| `spi_init.c/h` | `spi_modules` | SPIA/B 角色、线制、字长、时钟与 FIFO |
| `sci_init.c/h` | `sci_modules` | SCIA 帧格式、波特率、方向与 FIFO |
| `lin_init.c/h` | `lin_modules` | LINA LIN/SCI-compatible 模式及基础参数 |
| `can_init.c/h` | `can_modules` | eCAN CCR/CCE 握手、位时序、邮箱基础状态 |
| `eqep_init.c/h` | `eqep_modules` | eQEP1 计数模式、位置范围、同步输入 |
| `ecap_init.c/h` | `ecap_modules` | eCAP1 capture 或 APWM |
| `hrcap_init.c/h` | `hrcap_modules` | HRCAP 捕获和显式 HCCal 依赖 |
| `timer_init.c/h` | `timers` | CPU Timer 顺序与中断开关 |
| `protection_init.c/h` | `protection` | 保护基础配置 |
| `generated_init_all.c/h` | 所有已配置集合 + 实际生成文件集合 | 按依赖顺序统一调用 |
| `generated_config.json` | 规范化后的完整 ProjectConfig | 可审查快照 |
| `generation_manifest.json` | 生成器和文件集合 | 声明 source_of_truth 与所有权 |
| `validation_report.md` | 完整约束检查结果 | ERROR/WARNING/INFO 证据 |
| `generation_report.md` | 生成摘要 | 安全边界与人工审查提示 |

## 初始化顺序

`Generated_InitAll()` 保持 PWM 安全钳位，随后按“时钟 → PinMux → 通信/捕获/
Comparator/ADC → 内部路由 → PWM → 保护/Timer”的依赖顺序调用。函数返回不等于
自动释放功率 PWM，释放必须由上层软件在保护条件确认后显式进行。

## 全量重生成语义

- 新增 GPIO21：新的 `pinmux_init.c` 同时包含旧 GPIO20 和新 GPIO21。
- 删除 GPIO20：新文件不再含 GPIO20，不保留旧代码残影。
- 增加 I2CA：旧 `pwm_init.c` 字节保持，新增 I2C 和相关 PinMux。
- 增加 SOC1：SOC0 仍存在。
- 同一 ProjectConfig 连续生成、JSON 导出再导入后生成，文件逐字节一致。
- Preview 与 ZIP 使用同一 `files` 对象，逐字节一致。
- `diffGeneratedFiles(previous, next)` 只供用户审查新增/删除/修改，不反馈给生成器。

## 安全边界

当前证明的是浏览器逻辑和确定性文本生成。生成的寄存器代码尚未在本报告中证明
通过 TI 编译器，也没有完成 JTAG、板级通信、保护延迟或 LLC 功率级测试。
