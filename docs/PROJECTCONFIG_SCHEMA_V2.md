# ProjectConfig schema v2

schema v2 的目标是把整套工程状态放进一个对象，而不是把当前点击的脚或上一版 C
文本当成事实来源。空工程结构如下：

```json
{
  "schema_version": 2,
  "device": "TMS320F28034",
  "package": "PNT80",
  "migration_history": [],
  "system_clock": null,
  "pins": {},
  "pwm_modules": {},
  "pwm_sync_graph": {},
  "pwm_event_triggers": {},
  "adc": {
    "reference_mode": null,
    "socs": {},
    "interrupts": {}
  },
  "comparators": {},
  "trip_routes": {},
  "i2c_modules": {},
  "spi_modules": {},
  "sci_modules": {},
  "lin_modules": {},
  "can_modules": {},
  "eqep_modules": {},
  "ecap_modules": {},
  "hrcap_modules": {},
  "xint_routes": {},
  "clock_routes": {},
  "low_power_wake": {},
  "timers": {},
  "interrupt_routes": {},
  "protection": null
}
```

## 四层对象如何对应

| 层 | 例子 | 保存位置 |
|---|---|---|
| Peripheral instance | I2CA、SPIA、CANA、EQEP1、COMP1、EPWM1 | `*_modules`、`comparators`、`pwm_modules` |
| Signal group | I2CA.sda/scl、EQEP1.a/b/index/strobe | 模块对象的 `signals` + golden `signal_groups.json` |
| Internal route | EPWM1_SOCA→SOC0、COMP1OUT→EPWM1/2 | `pwm_event_triggers`、`trip_routes`、`pwm_sync_graph` |
| Shared resource | EPWM7 calibration、LINA register block | 由 resource graph 从完整 ProjectConfig 推导 |

`pins` 只保存真正占用封装脚的数字/AIO 路由。ADC 与 Comparator 外部模拟输入保存在
对应模块对象中；内部 SOCA、Comparator Trip 和内部同步的 `physical_pin` 必须为空。

## ADC 从单对象升级为集合

每个 SOC 使用 `adc.socs.SOC0`～`SOC15` 独立保存，所以添加 SOC1 不会覆盖 SOC0。
`adc.interrupts.ADCINT1.eoc` 引用一个已存在的 SOC key。SOC 编号、channel、trigger
和 ACQPS 都在全项目校验时检查。

## 原子提交

1. 向导只修改 `activeEditor.draft`。
2. `buildCommitPlan()` 从当前 ProjectConfig 克隆出候选 nextProject。
3. 补齐整个模块的信号组、模块参数和内部路由。
4. 对 nextProject 做完整约束与资源图检查。
5. 只有零个 ERROR 时 `applyAtomically()` 才替换当前 ProjectConfig。

提交计划保存提交前的确定性 JSON。若编辑期间工程已经改变，计划被视为 stale 并
拒绝，避免用旧向导覆盖新配置。删除模块会同时删除其全部信号脚和内部路由。

## v1 迁移

`normalizeProject()` 明确识别 `schema_version: 1`，把旧单 ADC 对象迁移为
`adc.socs.SOC<n>` 集合，并写入 `migration_history`。未知或缺失字段不会被当作
上一版生成 C 文本来补偿；导入后仍必须通过 schema v2 全项目校验。
