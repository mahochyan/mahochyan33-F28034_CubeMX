# R3.3 内部路由矩阵

内部路由是芯片内部模块之间的连接，不应为了“画出连接”而占用一个假的封装脚。
只有表中明确写着“需要物理脚”的外部路径才进入 `pins`。

| 路由 | 来源 | 目标 | 需要物理脚 | 完整性规则 | ProjectConfig |
|---|---|---|---:|---|---|
| 软件触发 ADC | CPU 软件 | SOC0～SOC15 | 否 | trigger 必须存在于路由库 | `adc.socs.*.trigger=SOFTWARE` |
| Timer 触发 ADC | CPUTIMER0/1/2 | SOC0～SOC15 | 否 | 定时器配置由使用者审查 | `adc.socs.*.trigger` |
| ePWM SOCA/SOCB | EPWM1～EPWM7 事件 | SOC0～SOC15 | 否 | PWM 模块存在；事件 enabled、source、prescale 完整 | `pwm_event_triggers` + `adc.socs` |
| ADC EOC → ADCINT | SOCx EOC | ADCINT1/2 | 否 | interrupt 指向的 SOC 必须存在 | `adc.interrupts` |
| Comparator Trip | COMP1OUT～COMP3OUT | 一个或多个 ePWM | 否 | 对应 Comparator 对象存在；禁止 `source_pin` | `trip_routes` |
| CLOCKFAIL Trip | 时钟故障 | 一个或多个 ePWM | 否 | 至少一个已配置 PWM target | `trip_routes` |
| EQEP1ERR Trip | eQEP1 error | 一个或多个 ePWM | 否 | EQEP1 对象存在；至少一个 target | `trip_routes` |
| 外部 TZ Trip | TZ1/TZ2/TZ3 | 一个或多个 ePWM | 是 | 必须选择真实 TZ 物理脚；快速保护用 async 输入 | `trip_routes.*.source_pin` |
| ePWM 内部同步 | EPWM1～EPWM7 | EPWM1～EPWM7 | 否 | 有向图不得成环 | `pwm_sync_graph` |
| 外部同步输入 | EPWMSYNCI | ePWM 同步链 | 是 | 从官方 MUX 候选选择真实脚 | `pins` + `pwm_sync_graph` |
| 外部同步输出 | ePWM 同步链 | EPWMSYNCO | 是 | 从官方 MUX 候选选择真实脚 | `pins` + `pwm_sync_graph` |
| 外设中断 | ADC/SCI/I2C/CAN/eQEP/eCAP | PIE/CPU | 否 | 向量独占，映射到官方 PIE group/channel | `interrupt_routes` |

## 当前机器可读路由库

- ADC trigger：`SOFTWARE`、`CPUTIMER0～2`、`EPWM1～7_SOCA/SOCB`，共 18 项。
- Trip source：`TZ1～3`、`COMP1OUT～3OUT`、`CLOCKFAIL`、`EQEP1ERR`。
- 中断映射：ADCINT1/2、SCI RX/TX、I2C INT1/2、eCAN INT0/1、EQEP1、ECAP1。
- 内部 ePWM 同步源和目标均覆盖 EPWM1～EPWM7。

`ADCSOCAO`、`ADCSOCBO`、`EPWMSYNCI`、`EPWMSYNCO` 和 `COMPxOUT` 仍保留为
官方可选外部 MUX 信号；只有用户明确选择这些外部观察/同步功能时才占用物理脚。
