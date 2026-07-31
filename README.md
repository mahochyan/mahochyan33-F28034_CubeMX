# C2000 Config Studio R3.3 Peripheral Graph Static

面向 `TMS320F28034PNT / PNT80` 的浏览器端引脚复用、配置检查与 C 代码生成器。

在线地址：

<https://mahochyan.github.io/mahochyan33-F28034_CubeMX/>

生产版本位于 `dist/`，是 GitHub Pages 可直接托管的纯静态网页。运行时不依赖
Python、Flask、Docker、本地端口或 `/api` 接口。

仓库已精简为 R3.3 静态本体、当前源码、F28034 golden 数据和必要审计文档。
旧 Flask/Docker 服务、旧网页、测试源码、测试截图与本地依赖缓存已经移除；
需要追溯时仍可从 Git 历史提交 `df44a86` 恢复。

> 当前内部状态：`CONFIG_STUDIO_R3.3_PERIPHERAL_GRAPH_INTERNAL_PASS`。
> 这表示官方数据库、外设资源图和软件验收门禁已通过；用户正式网页验收仍待完成，
> 更不代表 CCS 编译、硬件实测、功率级使能或电源安全批准。

## R3.3：从单脚 PinMux 升级为完整外设

现在选择 `SCLA`、`SPISIMOA`、`CANTXA`、`EQEP1A` 等功能时，网页建立的是完整
外设模块对象，而不是一条孤立 PinMux：

- Peripheral instance：I2CA、SPIA/B、SCIA、LINA、CANA、EQEP1、ECAP1、
  HRCAP1/2、COMP1～3、EPWM1～7
- Signal group：按模式检查 I2C SDA/SCL、SPI 数据/时钟/片选、CAN TX/RX、
  eQEP A/B 等成组关系
- Internal route：ePWM SOCA/B → ADC、Comparator → Trip、ePWM 同步与中断路由
- Shared resource：HRCAP 校准与应用 EPWM7 等跨模块冲突

ADC 已升级为 SOC0～SOC15 集合。生成器只读取完整 schema v2 ProjectConfig，
每次从零全量重生成：新增配置保留旧配置，删除配置不会留下旧 C 文本。

R3.3 审计报告：

- [外设联动矩阵](docs/PERIPHERAL_LINKAGE_MATRIX.md)
- [资源冲突矩阵](docs/RESOURCE_CONFLICT_MATRIX.md)
- [内部路由矩阵](docs/INTERNAL_ROUTE_MATRIX.md)
- [代码生成所有权](docs/CODEGEN_OWNERSHIP_REPORT.md)
- [ProjectConfig schema v2](docs/PROJECTCONFIG_SCHEMA_V2.md)
- [R3.3 浏览器与自动验收](docs/R3_3_E2E_REPORT.md)

## R3.2.2 延续的完整官方引脚数据库

本版本不再逐个修补管脚，而是由
[`tools/build_official_pin_golden.py`](tools/build_official_pin_golden.py)
统一生成 physical pin、GPIO MUX、模拟并行路径和特殊路由数据。

唯一依据为 TI `SPRS584Q`：

- Figure 5-3：PNT 80-pin 顶视封装图
- Table 5-1：PNT80 物理脚号和信号
- Table 7-40：GPIO0～GPIO31 MUX
- Table 7-41：GPIO32～GPIO44 MUX
- Table 7-42：AIO2～AIO14 MUX

官方数据门禁：

| 指标 | 结果 |
|---|---:|
| 物理脚数量 | 80 |
| `physical_pin_missing` | 0 |
| `physical_signal_missing` | 0 |
| `gpio_mux_missing` | 0 |
| `gpio_mux_extra` | 0 |
| `gpio_mux_mismatch` | 0 |
| `analog_function_missing` | 0 |
| `special_route_missing` | 0 |

数据库把三件事分开表示：

- 芯片手册中确实存在的信号和路由
- 当前网页是否支持选择该路由
- 生成器是否已经支持完整外设初始化

因此，ADC、Comparator input、AIO、JTAG、启动模式、外部中断和低功耗唤醒等
信号不会再被错误地当成普通 GPIO MUX。JTAG/固定电源脚只读显示，不会打开普通配置向导。

## R3.3 发布前验收记录

精简前已使用真实 Chromium 逐一点击 Pin1～Pin80，并完成以下检查：

- 80 个物理脚全部可以点击并显示详情
- `configurable=true` 时功能列表绝不为空；否则测试直接按 P0 失败
- 固定脚和 JTAG 只读角色不会错误打开配置向导
- 点击管脚后只显示该管脚功能；“显示全部功能”恢复完整功能树

验收报告：

- [R3.3 总验收报告](docs/R3_3_E2E_REPORT.md)
- [物理脚覆盖报告](docs/OFFICIAL_PIN_COVERAGE_REPORT.md)
- [GPIO MUX 差异报告](docs/OFFICIAL_GPIO_MUX_DIFF.md)
- [模拟路径报告](docs/OFFICIAL_ANALOG_ROUTE_REPORT.md)
- [特殊路由报告](docs/OFFICIAL_SPECIAL_ROUTE_REPORT.md)

## 本地直接打开

Windows 用户请打开构建后的：

```text
dist\index.html
```

也可以在仓库目录的 PowerShell 中运行：

```powershell
start .\dist\index.html
```

不要直接双击仓库根目录的 `index.html`。根目录文件是开发入口，在 `file://`
模式下可能因为浏览器限制 `fetch()` 本地 JSON 而显示 `Failed to fetch`。
`dist/index.html` 已预加载静态 `device_bundle.js`，不需要本地服务器。

如果 `dist/` 不存在或内容过期：

```powershell
python .\tools\build_official_pin_golden.py
npm.cmd run build
start .\dist\index.html
```

`build_official_pin_golden.py` 只使用 Python 标准库；静态构建脚本只使用 Node.js
内置模块，因此不需要安装 npm 依赖。

## 重新构建

```powershell
python .\tools\build_official_pin_golden.py
npm.cmd run build
```

GitHub Actions 会重新构建 `dist/` 后部署到 GitHub Pages。R3.3 的完整测试源码
已按精简要求删除，历史测试结果与安全边界保留在审计报告和 Git 历史中。

## 目录

```text
index.html                  开发入口，不要直接双击
assets/                     页面样式
src/core/                   ProjectConfig、校验、生成器、ZIP 核心
src/devices/TMS320F28034/   浏览器运行时器件数据
devices/                    可审计的官方 golden 数据源
tools/                      golden 数据库与静态网页构建工具
dist/                       GitHub Pages 纯静态生产目录
docs/                       当前 R3.3 与官方数据审计报告
```

## 生成代码的安全边界

- 生成的 C/H 文件带有 `LOGIC TEST ONLY` 和
  `NOT APPROVED FOR POWER-STAGE ENABLE` 标记。
- ADC 生成 SOC、采样窗和 ADCINT 配置，不对模拟输入脚写
  `GPAMUX/GPADIR/GPAPUD`。
- Comparator input 只保存模拟信号路径，不伪造普通 GPIO 初始化。
- AIO 使用独立 `AIOMUX/AIODIR/AIOSET/AIOCLEAR` 语义。
- 任何生成代码都必须经过工程师审查、离线编译、低压台架验证和保护测试，
  不能直接作为 LLC 功率级使能依据。
