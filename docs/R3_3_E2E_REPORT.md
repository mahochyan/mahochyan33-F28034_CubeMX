# R3.3 自动验收报告

执行日期：2026-07-31  
内部状态：`CONFIG_STUDIO_R3.3_PERIPHERAL_GRAPH_INTERNAL_PASS`

此状态只表示本仓库的数据库、事务、约束、静态构建和浏览器用户流程达到 R3.3
内部门槛。用户尚未完成正式网页操作验收，因此不得把状态升级为最终发布批准；
它也不是 CCS 编译或 LLC 功率级使能证明。

## 结果摘要

| 门禁 | 结果 |
|---|---:|
| JavaScript 单元/约束/生成器测试 | 47 / 47 PASS |
| Python 既有回归测试 | 55 PASS，1 SKIP（已无未验证 MUX 样本） |
| 静态产物检查 | 11 required artifacts，MUX 127/127 PASS |
| Playwright 真实 Chromium 用户流程 | 15 / 15 PASS |
| 物理脚点击 | Pin1～Pin80 全覆盖 |
| configurable=true 且功能为空 | 0 |

## R3.3 点名模块流程

| 浏览器操作 | 验收证据 |
|---|---|
| 点击 SCLA | 自动进入 I2CA 向导，必须选择 SDAA；提交后是一个 I2CA 模块对象 |
| 点击 SPISIMOA | 自动进入 SPIA/SPIB 完整向导；3-wire master 仅保留 SIMO+CLK |
| 点击 CANTXA | 进入 CANA；self-test loopback 成功且零 CAN 物理脚 claim |
| 点击 EQEP1A | 自动要求 EQEP1B；提交后按 EQEP1 模块分组 |
| 点击 ADCINA0，再添加第二 SOC | SOC0、SOC1 同时保留并生成两组 ADCSOCxCTL |
| Comparator 内部 Trip | 不分配假的 COMPxOUT 物理脚 |
| EPWM7 + HRCAP 高分辨率校准 | 原子拒绝；芯片图和功能树同时标红 |
| 已配置摘要 | 按 I2CA/SPIA/EQEP1 等模块分组，不按单脚散列 |

## 点名约束与生成语义

- I2C 缺配对信号、SPIA/B 混搭、SCI full-duplex 缺 RX、LINA 模式混合、
  CAN normal 缺 TX/RX、eQEP 缺 A/B 或 async、eCAP 双模式均自动拒绝。
- ADC 使用 ePWM SOCA/B 时，若源 PWM 或事件配置不完整则 ERROR。
- 一个内部 Comparator Trip 可合法保护多个已配置 ePWM，且不占物理脚。
- ePWM 同步图有环为 ERROR。
- HRCAP 高分辨率校准与应用 EPWM7 自动冲突。
- 普通 GPIO 累积、删除清理、跨模块累积、多 SOC、重复生成、JSON 往返、
  Preview/ZIP 字节一致均有自动测试。

## 测试证据保留方式

本报告记录的是项目精简前完成的发布门禁。按后续精简要求，Python、JavaScript
和 Playwright 测试源码及截图已经从当前目录删除；可从 Git 提交 `df44a86`
恢复当时的测试代码和逐项证据。当前仓库仍可执行 `npm.cmd run build` 重建静态本体。

生产入口是 `dist/index.html`，可通过 `file://` 直接打开，也可部署到 GitHub Pages；
运行时不需要 Python、Flask、Docker、本地端口或 `/api`。
