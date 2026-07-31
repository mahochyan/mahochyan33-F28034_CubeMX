# R3.3 外设联动矩阵

本报告把“一个引脚能切到什么功能”和“一个外设实例怎样才算完整”分开记录。
机器可读事实来源是 `peripheral_instances.json` 与 `signal_groups.json`；物理脚和
MUX 仍以 SPRS584Q Figure 5-3、Table 5-1、Table 7-40～7-42 为准。

支持级别 `peripheral_init` 只表示工具能生成该模块的基础初始化代码，不表示已经
通过 CCS 编译、硬件通信或功率级验证。

| 模块 | 官方信号 | 必选信号 | 可选信号 | 模式 | 共享资源 | 硬冲突 | 警告 | 生成文件 | 支持级别 | 官方章节 |
|---|---|---|---|---|---|---|---|---|---|---|
| ADC | ADCINA0～7、ADCINB0～7 | 每个 SOC 选择一个 channel；SOC0～SOC15 编号唯一 | ADCINT1/2、软件/Timer/ePWM 触发 | 多 SOC 集合 | SYSCLK、ePWM SOCA/SOCB | ePWM 事件未完整启用时禁止作为触发源 | ACQPS 过短告警；模拟脚不写 GPIO MUX | `adc_init.c` | peripheral_init | SPRUI10A Ch.8 |
| COMP1 | COMP1A、COMP1B；内部 COMP1OUT | 正、负输入各一个来源 | 内部 10-bit DAC、极性、滞回、内部 Trip、外部输出脚 | external / internal_dac | SYSCLK、Trip source | 内部 Trip 不得伪占 COMP1OUT 物理脚 | 外部输出只是可选 MUX 路由 | `comparator_init.c` | peripheral_init | SPRUI10A Ch.9 |
| COMP2 | COMP2A、COMP2B；内部 COMP2OUT | 同 COMP1 | 同 COMP1 | external / internal_dac | SYSCLK、Trip source | 同 COMP1 | 同 COMP1 | `comparator_init.c` | peripheral_init | SPRUI10A Ch.9 |
| COMP3 | COMP3A、COMP3B；内部 COMP3OUT | 同 COMP1 | 同 COMP1 | external / internal_dac | SYSCLK、Trip source | 同 COMP1 | 同 COMP1 | `comparator_init.c` | peripheral_init | SPRUI10A Ch.9 |
| I2CA | SDAA、SCLA | SDAA + SCLA | FIFO、中断、地址 | master / slave | LSPCLK、两只数字 MUX | 缺 SDA 或 SCL；任一脚被占用 | 板级必须有 SDA/SCL 外部上拉 | `i2c_init.c` | peripheral_init | SPRUI10A Ch.13 |
| SPIA | SPISIMOA、SPISOMIA、SPICLKA、SPISTEA | CLK；数据脚按角色/线制/方向决定 | STE | master/slave；3-wire/4-wire；tx/rx/full_duplex | LSPCLK、所选数字 MUX | 混入 SPIB；3-wire 未释放不用数据脚；SPIBRR 越界 | STE 与外部片选策略要匹配 | `spi_init.c` | peripheral_init | SPRUI10A Ch.11 |
| SPIB | SPISIMOB、SPISOMIB、SPICLKB、SPISTEB | 同 SPIA | STE | 同 SPIA | LSPCLK、所选数字 MUX | 混入 SPIA；其余同 SPIA | 同 SPIA | `spi_init.c` | peripheral_init | SPRUI10A Ch.11 |
| SCIA | SCITXDA、SCIRXDA | 按方向：TX、RX 或两者 | FIFO、中断、半双工方向控制 | tx_only / rx_only / full_duplex / half_duplex | LSPCLK、所选数字 MUX | full_duplex 缺 TX/RX；half_duplex 缺方向策略 | 电平标准和外部接口由板级决定 | `sci_init.c` | peripheral_init | SPRUI10A Ch.12 |
| LINA | LINTXA、LINRXA | 按方向选择 TX/RX | 校验和、中断 | lin / sci_compat；方向可选 | LSPCLK、LINA_REGISTER_BLOCK | 同一实例不能同时使用 lin 与 sci_compat | 真正 LIN 总线通常需要外部 LIN 收发器 | `lin_init.c` | peripheral_init | SPRUI10A Ch.15 |
| CANA | CANTXA、CANRXA | normal: TX+RX；listen_only: RX；诊断按模式；loopback: 无脚 | 邮箱、过滤、中断 | normal / listen_only / self_test_loopback / tx_test / rx_test | SYSCLK、eCAN-A 实例 | normal 缺 TX/RX；位时序字段无效 | 真实 CAN 总线需要外部收发器 | `can_init.c` | peripheral_init | SPRUI10A Ch.14 |
| EQEP1 | EQEP1A、EQEP1B、EQEP1I、EQEP1S | A + B | Index、Strobe | quadrature / direction_count | SYSCLK、所选数字 MUX | 缺 A/B；任一输入 qualification=async | 输入必须同步到 SYSCLK | `eqep_init.c` | peripheral_init | SPRUI10A Ch.7 |
| ECAP1 | ECAP1 | IO | 捕获边沿/APWM 周期与比较值、中断 | capture / apwm | SYSCLK、ECAP1 实例 | capture 与 APWM 同时启用 | APWM 时方向与捕获模式不同 | `ecap_init.c` | peripheral_init | SPRUI10A Ch.6 |
| HRCAP1 | HRCAP1 | input | HCCal 库、校准实例、周期 | capture / high_resolution | HCCAPCLK、HCCAL_LIBRARY、EPWM7_CALIBRATION | 高分辨率校准与应用 EPWM7；应用通道与校准实例相同 | 首次捕获通常需要丢弃 | `hrcap_init.c` | peripheral_init | SPRUI10A Ch.5 |
| HRCAP2 | HRCAP2 | input | 同 HRCAP1 | capture / high_resolution | 同 HRCAP1 | 同 HRCAP1 | 同 HRCAP1 | `hrcap_init.c` | peripheral_init | SPRUI10A Ch.5 |
| EPWM1 | EPWM1A、EPWM1B | A；互补模式还要 B | dead-band、Trip、SOCA/B、同步 | single / complementary | TBCLK、Trip、同步、SOCA/B | 脚位/Trip 资源冲突 | 上电保持安全钳位 | `pwm_init.c`、`pwm_routing_init.c` | peripheral_init | SPRUI10A Ch.3 |
| EPWM2 | EPWM2A、EPWM2B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |
| EPWM3 | EPWM3A、EPWM3B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |
| EPWM4 | EPWM4A、EPWM4B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |
| EPWM5 | EPWM5A、EPWM5B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |
| EPWM6 | EPWM6A、EPWM6B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |
| EPWM7 | EPWM7A、EPWM7B | 同 EPWM1 | 同 EPWM1 | 同 EPWM1 | TBCLK、EPWM7_CALIBRATION | 应用 EPWM7 与 HRCAP 高分辨率校准冲突 | 同 EPWM1 | 同 EPWM1 | peripheral_init | SPRUI10A Ch.3 |

## 原子事务含义

例如用户从 `SCLA` 进入向导，提交的不是一条孤立 PinMux，而是一个 `I2CA`
模块对象、SDA/SCL 两个角色、两只物理脚及相应生成文件。缺少任一必选角色时，
整个事务失败，旧 `ProjectConfig` 和浏览器本地存储都保持不变。
