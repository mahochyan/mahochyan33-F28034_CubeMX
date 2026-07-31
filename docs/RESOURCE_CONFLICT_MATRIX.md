# R3.3 资源冲突矩阵

资源图把“谁在使用什么”记录为 claim。`exclusive` 资源出现多个不同 owner 时是
`ERROR`；`shared` 资源允许多个合法消费者。

| 资源/规则 | 声明者 | 模式 | 结果 | 自动处理 |
|---|---|---|---|---|
| `PIN<n>` | 独立引脚或模块信号 | exclusive | 同一物理脚被两个功能使用为 ERROR | 原子提交失败，芯片图和功能树标红 |
| `DIGITAL_MUX.GPIO<n>` | 普通 GPIO MUX 功能 | exclusive | 同一 GPIO 同时选两个 MUX 为 ERROR | 不写入 ProjectConfig |
| `PERIPHERAL.<instance>` | I2C/SPI/SCI/LIN/CAN/eQEP/eCAP/HRCAP/COMP/ePWM | exclusive | 同一实例的互斥配置为 ERROR | 必须编辑或删除原模块 |
| `CLOCK.LSPCLK/SYSCLK/TBCLK/HCCAPCLK` | 多个外设 | shared | 合法共享 | 仅记录依赖，不误报 |
| `SHARED.EPWM7_CALIBRATION` | 应用 EPWM7、HRCAP 校准 | exclusive | 同时出现为 ERROR | 两端脚位与功能节点同时标红 |
| HRCAP 校准实例 | HRCAP 应用通道、专用校准通道 | exclusive | 同一 HRCAP 既做应用捕获又做校准为 ERROR | 要求另选 HRCAP 实例 |
| `LINA_REGISTER_BLOCK` | `LINA.lin`、`LINA.sci_compat` | exclusive | 两模式不能同时存在 | schema v2 用单个 `mode` 标量；非法组合拒绝 |
| SPI 实例信号组 | SPIA 或 SPIB | instance-bound | A/B 信号混搭为 ERROR | `SIGNAL_INSTANCE_MIXED` |
| SPI 3-wire 数据角色 | SIMO/SOMI | mode-bound | master 未释放 SOMI，或 slave 未释放 SIMO 为 ERROR | 只生成实际使用的数据脚 |
| CAN normal 信号组 | CANTXA、CANRXA | required pair | 缺 TX 或 RX 为 ERROR | loopback 是明确例外且不占脚 |
| eQEP A/B | EQEP1A、EQEP1B | required pair | 缺 A/B 或 async 输入为 ERROR | 整个 EQEP1 事务不提交 |
| eCAP 模式 | capture、APWM | exclusive | 同时启用为 ERROR | 只生成一种寄存器语义 |
| ADC ePWM 触发 | ADC SOC、EPWMx SOCA/B | shared internal | PWM 模块或事件未完整启用为 ERROR | 不借用 ADCSOCAO/B 物理脚 |
| Trip source | 外部 TZ、Comparator、CLOCKFAIL、EQEP1ERR | shared internal | 非法源/目标或内部源带物理脚为 ERROR | 一个合法源可关联多个 ePWM |
| ePWM sync graph | ePWM master/slave | directed graph | 出现环路为 ERROR | `PWM_SYNC_CYCLE` |
| XCLKIN source | GPIO19 或 GPIO38 | selector | 同时选择两个来源为 ERROR | 由特殊路由约束检查 |
| JTAG 共享 GPIO35～38 | 调试与普通 GPIO 输出 | risk | 调试连接有效时为 WARNING | 显示风险，不伪造为普通 MUX 冲突 |

## 失败事务的可见行为

校验失败时不会修改当前 `ProjectConfig`，也不会修改 `localStorage`。界面保留失败
向导供用户修正，并在芯片图、功能树同时用红色显示冲突参与者。红色只是诊断提示，
不是已经写入了一份坏配置。
