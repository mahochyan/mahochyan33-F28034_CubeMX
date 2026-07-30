# C2000 Config Studio R3.2 Static

面向 `TMS320F28034 / PNT80` 的浏览器端引脚复用与初始化代码配置器。

在线地址：

<https://mahochyan.github.io/mahochyan33-F28034_CubeMX/>

生产版本位于 `dist/`，是 GitHub Pages 可直接托管的纯静态网页。浏览器
直接读取仓库中的 JavaScript/JSON，完成约束校验、C 代码预览、工程 JSON
持久化和确定性 ZIP 导出。

> 当前发布状态：`CONFIG_STUDIO_R3.2_STATIC_IN_PROGRESS`。内部自动化和
> 浏览器验收通过不等于功率级批准；还需要用户在实际网页完成验收。

## R3.2 主线

- MUX golden：127 个有效非 Reserved 选项，差异/多余/缺失均为 0。
- 17 个已知错误项修正为 MUX3；GPIO35~38 的 JTAG 项不再作为普通候选。
- `ProjectConfig` 只使用 `schema_version: 1`。
- 向导提交采用完整 commit plan；冲突时内存与 localStorage 都不改变。
- ePWM 互补→单路、Trip 禁用、Trip 源切换都会清理旧的派生引脚。
- 校验、生成器和 ZIP 全部在浏览器端运行。
- 非 ePWM 外设当前按 `pinmux-only` 处理，不伪装成完整外设初始化。
- 芯片图由 `PNT80` package JSON 驱动，固定渲染 80 个物理脚。
- 所有生成的 C/H 文件都带有：
  - `LOGIC TEST ONLY`
  - `NOT APPROVED FOR POWER-STAGE ENABLE`

## 目录

```text
index.html                 静态入口
assets/                    页面样式
src/core/                  ProjectConfig、校验、生成、ZIP 核心
src/devices/TMS320F28034/  浏览器器件数据
dist/                      GitHub Pages 发布目录
tests_js/                  浏览器核心单元测试
tests_e2e/                 Playwright 真实用户流程
.github/workflows/pages.yml 构建、测试和 Pages 部署
```

旧的 Python/Flask 文件只保留为参考实现和离线回归工具，不会进入 `dist/`，
也不是生产网页的运行条件。

## 构建与验收

需要 Node.js 22 或更高版本：

```powershell
npm install
npx playwright install chromium
npm run test:unit
npm run build
npm run test:dist
npm run test:e2e
```

完整旧回归：

```powershell
python -m unittest discover -s tests -v
```

`npm run test:e2e` 会把 `dist/` 挂载到 `/test-repo/` 子路径，并通过真实
Chromium 操作 Pin69/EPWM1A、SCLA、导入导出、刷新持久化和冲突回滚。
本地测试服务器只属于测试工具，部署后的网页不需要本地端口或后台进程。

## 生成代码安全边界

- ePWM 初始化期间同时保持软件强制低电平与 OST 钳位。
- `ReleaseClamp()` 先确认 Trip 输入恢复，再冻结 TBCLK、重置
  `TBCTR/TBPHS`、清除 Trip、在周期边界重启，最后取消软件钳位。
- 时钟生成包含 `PLLLOCKPRD`、`MCLKSTS` 和锁定超时检查，不生成 `ESTOP0`。
- Timer 初始化采用 `TSS/TRB/TIE` 安全顺序，不修改全局中断开关。
- 生成代码必须经过工程师审查和台架验证，不能直接作为功率级使能依据。

详细内部验收见 [R3.2 静态交付记录](docs/R3_2_STATIC_DELIVERY.md)。
