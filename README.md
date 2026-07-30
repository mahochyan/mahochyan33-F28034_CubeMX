# C2000 Config Studio R3 Web Core

这是面向 `TMS320F28034 / PNT80` 的图形化配置器。R3 阶段只收敛
Web Core，不新增芯片和外设。

项目主页（GitHub Pages）：

<https://mahochyan.github.io/mahochyan33-F28034_CubeMX/>

> GitHub Pages 展示项目界面、能力和部署说明。完整配置器依赖 Flask /
> Waitress API，不能只靠静态 HTML 运行。

## R3 已实现的主线

- 只有一份 `ProjectConfig`：草稿取消不会污染已提交配置。
- 功能树内嵌单步向导：一次只编辑一个功能，支持上一步、下一步、取消和完成。
- ePWM A/B 互补配置按模块原子提交，B 路由死区模块派生，Trip 输入一并提交。
- 预览和 ZIP 导出共用 `generator.generate_project()`，输出可重复。
- `PNT80` 芯片图完全由 package JSON 驱动，80 个物理脚按顶视图排列。
- MUX 证据拆分为“信号存在”“数值已核验”“生成器支持”三种状态。
- Web 模式使用 Waitress，ZIP 在内存中生成，不写服务器 staging。

## 本地模式

双击：

```bat
start_config_studio.bat
```

停止：

```bat
stop_config_studio.bat
```

本地模式只监听 `127.0.0.1`，并在 `generator/instance.json` 记录实际
PID、端口和构建号。

## Web 模式

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

启动一个生产 WSGI 进程：

```powershell
$env:APP_MODE='web'
$env:PORT='8080'
python -m waitress --listen=0.0.0.0:8080 --threads=8 app:app
```

浏览器打开 `http://localhost:8080/`。Docker/Compose 部署见
`docs/DEPLOY_WEB.md`。

## GitHub Pages

静态项目主页位于 `docs/index.html`。仓库 `main` 分支更新后，GitHub
Pages 从 `/docs` 发布；它是项目展示和文档入口，不冒充可执行的后端服务。

## 生成器安全语义

- 未配置的模块不生成对应初始化文件。
- ePWM 上下计数：`TBPRD = TBCLK / (2 × fPWM)`。
- `CAU 置位 / CAD 清零`：`CMPA = TBPRD × (1 - duty)`。
- 互补 B 路由死区模块派生，不复制另一套 AQ。
- Trip 会选择输入源，并把 `TZA/TZB` 都钳为低电平。
- I²C 使用开漏语义，启用内部上拉、异步输入资格，同时提示板上外部上拉。
- 生成代码不会自动释放 ePWM 软件钳位。

## 验收命令

```powershell
python -m unittest discover -s tests -v
python tests\e2e_geometry_bbox.py -v
python tests\e2e_web_flow.py
python tests\ccs_build_check.py
```

其中 `e2e_web_flow.py` 会启动 Waitress，并用 Playwright/Chromium 操作真实
页面；不能用历史 43 项单元测试替代浏览器验收。

## 证据与交付记录

- `docs/R3_BASELINE.md`
- `docs/PINMUX_EVIDENCE_REPORT.md`
- `docs/UNVERIFIED_MUX_REPORT.md`
- `docs/GENERATOR_SEMANTIC_REPORT.md`
- `docs/R3_CCS_BUILD_LOG.md`
- `docs/R3_DELIVERY.md`
- `docs/r3_e2e/`

数据依据为 TI `SPRS584Q` 数据手册及本机 TI C2000 头文件/源文件。
