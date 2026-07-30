# C2000 Config Studio R3.2.2 Official Static

面向 `TMS320F28034PNT / PNT80` 的浏览器端引脚复用、配置检查与 C 代码生成器。

在线地址：

<https://mahochyan.github.io/mahochyan33-F28034_CubeMX/>

生产版本位于 `dist/`，是 GitHub Pages 可直接托管的纯静态网页。运行时不依赖
Python、Flask、Docker、本地端口或 `/api` 接口。

> 当前内部状态：`CONFIG_STUDIO_R3.2.2_OFFICIAL_PIN_DATABASE_INTERNAL_PASS`。
> 这表示官方引脚数据库和软件验收门禁已通过，不代表硬件实测、功率级使能或电源安全批准。

## R3.2.2 完整官方引脚数据库

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

## 浏览器验收

Playwright 使用真实 Chromium 逐一点击 Pin1～Pin80，并检查：

- 80 个物理脚全部可以点击并显示详情
- `configurable=true` 时功能列表绝不为空；否则测试直接按 P0 失败
- 固定脚和 JTAG 只读角色不会错误打开配置向导
- 点击管脚后只显示该管脚功能；“显示全部功能”恢复完整功能树

验收报告：

- [80 脚浏览器点击报告](docs/ALL_80_PINS_E2E_REPORT.md)
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
npm.cmd install
python .\tools\build_official_pin_golden.py
npm.cmd run build
start .\dist\index.html
```

## 构建与完整验收

需要 Node.js 22 或更高版本、Python 3 和 Chromium：

```powershell
npm.cmd install
npx.cmd playwright install chromium
python .\tools\build_official_pin_golden.py
npm.cmd run test:unit
python -m unittest discover -s tests -p "test_*.py"
npm.cmd run build
npm.cmd run test:dist
npm.cmd run test:e2e
```

GitHub Actions 会重复执行数据库生成、单元测试、静态构建和真实浏览器验收，
全部通过后才把 `dist/` 部署到 GitHub Pages。

## 目录

```text
index.html                  开发入口，不要直接双击
assets/                     页面样式
src/core/                   ProjectConfig、校验、生成器、ZIP 核心
src/devices/TMS320F28034/   浏览器运行时器件数据
devices/                    可审计的官方 golden 数据源
tools/                      golden 数据库与静态网页构建工具
dist/                       GitHub Pages 纯静态生产目录
tests_js/                   浏览器核心和官方数据库单元测试
tests_e2e/                  Playwright 真实用户流程
docs/                       自动生成的覆盖和差异报告
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
