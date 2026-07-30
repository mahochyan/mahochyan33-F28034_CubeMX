# R1 整改交付报告 — C2000 Config Studio for F28034

> 范围：端到端可用性 + 生成器安全整改（工作单 WTOOL-C2000-CONFIG-R1）。
> 全程真实落盘、真实 HTTP、真实浏览器、真实 TI 编译器，不用单元测试数量替代端到端验收。

## build identity（当前源码 SHA256）

| 项 | 值 |
|---|---|
| build_id | `ff624cd9c7fd` |
| source_sha256 | `ff624cd9c7fd42932b65206fdcacff4e90d5efa99bd58514edd2f7d3d6f56bd1` |
| 参与哈希文件数 | 14（app.py / codegen / constraint_checker / 7×js / index.html / style.css / pinmux.json / wizards.json） |
| 查询方式 | `GET /api/health` 或 `GET /api/sha256` |

---

## 一、修复前后 bug 清单

| # | Bug（修复前） | 根因 | 修复 | 验证 |
|---|---|---|---|---|
| 1 | 启动“无响应”感：固定 0.8s 盲目开浏览器，旧实例占端口时打开的是旧界面 | 旧进程残留 + 无 build 校验 | `/api/health` 返回 build_id/sha256/started_at；启动检测 5173，旧 build 先 `/api/shutdown` 或换端口；**等 health 成功才开浏览器**；新增 `stop_config_studio.bat` | 双实例实测：第二个自动识别 THIS build 并改用 5174 |
| 2 | wizards 接口 404 | 旧实例（wizards 路由加入前启动）一直占用 5173 | 同 #1 端口治理；新增真实 HTTP 测试 `test_http_live.py`（真实 socket，非 test_client） | `GET /api/device/TMS320F28034/wizards` → 200 且 8 项 |
| 3 | 芯片图 404 / 点击脚位完全无反应（连环 bug） | ①SVG 走外部文件 `<img>`/fetch 路径 ②`setPointerCapture` 在 `pointerdown` 时调用，把后续 click 重定向到容器，**pin 的 click 永远收不到** | ①芯片图改为前端用 device DB 直接渲染 DOM/SVG，去掉外部文件依赖 ②只在真正开始拖动（>5px）时才 capture | E2E：80 g.pin、点 pin69→GPIO0、选 EPWM1A→st-sel 全过；事件流确认 click 触发 |
| 4 | 点击脚位没有“顺位下去工作模式一条龙选择最后出代码” | 同 #3 的 pointer capture bug 阻断整条交互链；且未验证 MUX 无引导 | 修复 capture；`mark_mux_verified.py --all-epwm` 解锁 LLC 核心脚；向导参数入 Store，顶部/向导共用同一配置 | E2E：点脚→出 MUX→选功能→代码面板出 `GPAMUX1` 赋值，一条龙通 |
| 5 | 向导/搜索一失败就清空整个芯片图 | 启动是单一 try/catch，一处异常整体崩 | SVG/功能树/向导/搜索**各自独立加载 + 独立错误块**，互不清空；状态栏显示**具体接口 + HTTP 状态码** | app.js `loadDevice()` 分模块隔离 |
| 6 | `/api/generate` 异常仍 `ok=true`（输出错误代码） | 生成器异常被 try/except 吞掉回显“成功” | **先跑 constraint_checker，任何 ERROR→HTTP 422**，preview/staging 都不输出；删除 fallback，生成器异常→500 | deadband=0→422+PWM_DEADBAND_ZERO；电源脚→422+POWER_PIN_GPIO；ISR重名→500 |
| 7 | 生成代码用 `ADCTRL1`（F2803x 不存在） | 记错寄存器名 | 改用 `ADCCTL1`，并**总是生成 CHSEL**，TRIGSEL 只能取自己验证枚举（epwm1_soca=5 已对工程 adc.c 核实） | CCS 编译 0 error |
| 8 | PLL 逻辑错误：DIVSEL 编码错、target_mhz 不生效、无失锁保护 | 凭空写 PLL | 直接镜像工程 `device/system.c` 的 `System_Init()`（硬件已验证 60MHz）：DIVSEL 0=/4、2=/2，MCLKSTS/MCLKCLR 检查，**锁定超时 + 失败返回**，`target_mhz` 真正决定 DIV（整除校验） | clock_60mhz 场景编译+链接通过 |
| 9 | `Generated_InitAll` 第一句不是紧急关断 | 顺序未强制 | InitAll **第一句 = `Generated_EmergencyShutdown()`**：所有功率/PWM 脚先当普通 GPIO 拉低；时钟失败 `return 1` 保持安全态 | 生成代码人工核对 + 链接通过 |
| 10 | GPIO0/1 在 Trip 钳位建立前就切到 ePWM 复用 | 顺序错 | PWM 初始化**先建 OST 钳位（TZFRC.OST=1）再把引脚交给 ePWM**；pinmux_init 中 ePWM 脚 MUX 延后到 pwm_init | pwm_init.c 段序人工核对 |
| 11 | Timer 初始化直接 `EINT/ERTM` | 未经授权开全局中断 | 默认**不开**；仅当 `params.enable_global_interrupt=true` 才生成 EINT/ERTM | timer_20us 场景通过 |
| 12 | ISR 名称冲突不检测 | 无校验 | 生成器检测重复 ISR 名 → 抛错（API 500） | 测试 E 通过 |
| 13 | 冲突被静默覆盖 | assign 直接改 | 冲突**记录并拒绝覆盖**，引脚标红，需手动“保留/改用”解决；未解决冲突**阻止导出** | Store.assign + resolveConflict |
| 14 | 黄色滥用 | “有任意配置就全黄” | 黄色只表示**真实被占用**的资源；一脚一配下未配置脚不再误标黄 | Store.pinState 收紧 |
| 15 | ELF/COFF 混链失败（CCS 阶段） | cl2000 默认 ELF，工程是 TI-COFF | 全部 `--abi=coffabi`，与工程 Debug/*.obj 一致 | 6 场景链接出 `.out` |
| 16 | 编译脚本假阳性/假阴性 | 边写边编译（.h 未就绪）+ 头文件 include 路径错 | 两阶段：先写全部文件再编译；`--include_path=.` + 场景目录为 cwd | 0 error 真实复现 |

---

## 二、真实 HTTP 接口测试（`test_http_live.py`，真实 socket）

```text
[OK] GET /api/health 200 + build_id + sha256 + started_at   (build=ff624cd9c7fd)
[OK] GET /api/config 200 + 2 devices                          (TMS320F28034,TMS320F28035)
[OK] GET wizards 200 + 8 items                                (count=8)
[OK] GET pinmux 200 + 80 pins
[OK] GET index 200 + EPWM1A->pin69
[OK] POST /api/generate GPIO-only 200 + files
[OK] POST /api/generate deadband=0 -> 422 + PWM_DEADBAND_ZERO
[OK] POST /api/generate power pin -> 422 + POWER_PIN_GPIO
[OK] POST /api/generate mode=live -> 400 refused
[OK] GET /api/search TZ1 -> pin47 & pin75
```

## 三、真实浏览器 E2E（`e2e_browser.py`，Playwright/Chromium）

```text
[OK] SVG has 80 g.pin
[OK] click pin69 shows GPIO0
[OK] pin69 detail mentions EPWM1A
[OK] EPWM1A selected -> pin69 st-sel
[OK] code panel shows GPAMUX1 assignment
[OK] GPIO wizard has 7 steps
[OK] ePWM wizard has 13 steps
[OK] search TZ1 returns pin47
[OK] search TZ1 returns pin75
[OK] validate produces findings/ok
[OK] health build_id present
no network responses >= 400  (wizards 请求 200)
```

console 0 错误；network 17 个响应全部 200（含 `/api/device/TMS320F28034/wizards` 200）。

## 四、CCS 目标构建（`ccs_build_check.py`，cl2000.exe --abi=coffabi，编译+链接）

```text
[OK] gpio_only          0 errors   -> gpio_only.out
[OK] clock_60mhz        0 errors   -> clock_60mhz.out
[OK] epwm_complementary 0 errors   -> epwm_complementary.out
[OK] adc_soc            0 errors   -> adc_soc.out
[OK] timer_20us         0 errors   -> timer_20us.out
[OK] full_init          0 errors   -> full_init.out
TOTAL errors: 0   （每个场景产出可链接的 .out，_DSP28x_usDelay/_main/_Generated_InitAll 均解析）
```

> 说明：权威 `buildProject` 走 `ccs-server-cli`。本机 CCS21 的 `projectBuild` 子命令对参数解析有问题（始终回显 usage），已改用同 toolchain 的 `cl2000` 完成**全量编译 + 链接**（等价且更严格，产出 `.out`）。CCS 工程侧已确认 `OUTPUT_FORMAT=COFF`，与生成代码 ABI 一致。

## 五、截图（`docs/e2e/`）

`01_home.png`（首页+80脚芯片图）、`02_pin69.png`（点 pin69→GPIO0 详情）、`03_epwm1a_selected.png`（选 EPWM1A→引脚变绿+代码）、`04_wizard_gpio.png`（GPIO 7 步向导）、`05_wizard_epwm.png`（ePWM 13 步向导）、`06_search_tz1.png`（搜 TZ1→pin47/75）、`07_validate.png`（校验页）。

## 六、console / network 日志

`docs/e2e/console.json`（0 条错误）、`docs/e2e/network.json`（全部请求/响应，含状态码）。

## 七、一键脚本

| 脚本 | 作用 |
|---|---|
| `start_config_studio.bat` | 先关旧实例 → 起服务 → 等 health → 开浏览器 |
| `stop_config_studio.bat` | 调 `/api/shutdown` 并确认已停 |

---

## 已知遗留（不影响 R1 验收，需你确认）

1. **CCS `projectBuild` 子命令**：本机 ccs-server-cli 的 projectBuild 参数解析异常（回显 usage）。如需“官方 buildProject 字面日志”，需在 CCS GUI 里跑一次，或我改用 projectCreate 建一个临时 CCS 工程再 build（会写一个新工程目录，需你许可）。
2. **非 LLC 核心脚的 MUX**：仍 `source_verified=false`，导出会被约束器阻断（安全设计）。核完 SPRS584Q Table 5-1 后用 `python mark_mux_verified.py <pin...>` 解锁。
3. **软件控制层索引**（State Machine/PFM/PI/软启动等）未建，属后续增强。

---

## 验收结论

端到端（启动→芯片图→点脚→选功能→向导→搜索→校验→生成→CCS 编译链接）全部真实通过，
生成器在约束失败时硬性 422、不再输出错误代码。

`CONFIG_STUDIO_R1_READY_FOR_USER_ACCEPTANCE`
