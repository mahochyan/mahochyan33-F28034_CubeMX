# SESSION_LOG — F28034_LLC_ConfigStudio

> **状态更新（session 4 完成，2026-07-30 13:20）：Phase A/B/C/D 全部落地，42 个单元测试全过。**
> 工具通道在 session 4 全程稳定，无失真。本日志保留早期环境教训，但下方"当前真实状态"已重写为最新事实。

---

## 0. 当前真实状态（2026-07-30 13:20 实测，全部真实落盘）

### 完成度
- ✅ **Phase A**：SVG 芯片图 + 点击引脚/功能树双向联动 + 冲突显示 + 全局搜索 + 数据库测试
- ✅ **Phase B**：8 个阶梯式向导（gpio_output/gpio_input/epwm_complementary/adc_soc/timer_interrupt/watchdog/system_clock/tripzone_ost），数据驱动（wizards.json）
- ✅ **Phase C**：constraint_checker.py（10 条约束规则）+ codegen.py（生成 18 个文件）+ staging 导出（`generator/staging/gen_*/`）
- ✅ **Phase D**：Registry 插件框架（扫 parts/*/device.json 自动发现）+ F28035 SKELETON 骨架
- ✅ 工作单已复制到 `D:\CCS21_workspace\Codex_Project\WTOOL-C2000-CONFIG-V2.md`
- ✅ README.md 已写

### 实测验证记录
| 验证 | 结果 |
|---|---|
| `python build_device_db.py` | 80 pins / 45 GPIO / 0 warnings |
| `python svg_generator.py` | 生成 chip_pnt80.svg，80 pin groups |
| `python -m unittest discover -s tests` | **Ran 42 tests — OK** |
| Flask test_client `/api/config` | 发现 TMS320F28034(SUPPORTED) + TMS320F28035(SKELETON) |
| `/api/device/.../pinmux` | 80 pins |
| `/api/device/.../index` | 98 functions；EPWM1A→pin69；TZ1n→pin47/75；ECAP1→pin55/62/80；XCLKIN→non_mux |
| `/api/device/.../wizards` | 8 向导；epwm_complementary 13 步 |
| `/api/validate`（死区0+电源脚+未验证MUX） | ok=False blocking=3（UNRESOLVED_PARAM/POWER_PIN_GPIO/PWM_DEADBAND_ZERO）+PWM_NO_TRIP 警告 |
| `/api/generate` preview | 18 个文件 |
| `/api/generate` staging | 导出到 `generator/staging/gen_20260730_131546/`，live_project_touched=False |
| `/api/generate` mode=live | **400 拒绝** |
| 实跑 `python app.py` + 浏览器资源 | index/css/svg/7×js 全 200，svg 80 pin groups |

### 磁盘文件（最终，46 个文件）
见 `Get-ChildItem -Recurse -File`。核心：
`app.py / start_config_studio.bat / build_device_db.py / svg_generator.py / README.md`
`devices/.../{family.json,wizards.json}` + `parts/tms320f28034/{device,pinmux,constraints,packages/pnt80}.json` + `parts/tms320f28035/device.json`
`generator/{__init__,codegen}.py` + `generator/staging/gen_*/`(18 文件)
`validators/{__init__,constraint_checker}.py`
`web/{index.html, css/style.css, img/chip_pnt80.svg, js/{store,chip,tree,detail,wizard,search,app}.js}`
`tests/{test_phase_a,test_constraints}.py`
`docs/{SESSION_LOG.md, build_warnings.json}`

---

## 1. 已核实结论（不要重新推导）

### 1.1 数据源修正（已由官方 CSV/MD 证实）
1. 手册 = **SPRS584Q**（PNT80 = PN 封装 80-LQFP，T = 温度等级后缀）
2. **F28034 有 eCAN**：pin32 GPIO31/CANTXA，pin33 GPIO30/CANRXA
3. MUX 寄存器名 = `GPAMUX1`（GPIO0-15）/`GPAMUX2`（GPIO16-31）/`GPBMUX1`（GPIO32-44）

### 1.2 寄存器归属（已对 DSP2803x_Gpio.h 逐行核实）
MUX/QSEL/DIR/PUD → `GpioCtrlRegs`；SET/CLEAR/TOGGLE/DAT → `GpioDataRegs`。
build_device_db.py 已为每个 GPIO 生成全部 8 个 `*_field` 访问器（mux/qsel/dir/pud 用 Ctrl，set/clr/tog/dat 用 Data）。42 个测试中有 2 个专门断言这一点。

### 1.3 GPIO19 XCLKIN = 非 MUX（已修复并测试）
`SysCtrlRegs.XCLK.bit.XCLKINSEL` 选源（0=GPIO19,1=GPIO38），不占 GPAMUX 槽。
pinmux.json 中 GPIO19：MUX1=SPISTEAn、MUX2=LINRXA、MUX3=ECAP1 + `alt_non_mux:[XCLKIN]`。
`TestGpio19NonMux` 两个测试锁定此行为。

### 1.4 头文件逐行核实值
- AIO 仅 `AIO2/4/6/10/12/14` 有效（测试断言）。
- PCLKCR 位：`PCLKCR0.TBCLKSYNC`（在 PCLKCR0 非 PCLKCR1，测试断言）、ADCENCLK 等；PCLKCR1.EPWM1-7ENCLK；PCLKCR3.COMP1-3/CPUTIMER0-2/CLA1；PCLKCR2.HRCAP1/2。
- 看门狗：WDCR WDCHK 必须 101；禁用值 0x0068；喂狗 0x55/0xAA。
- PLL：DIVSEL 先 /4 → PLLCR.DIV=12 → 等 PLLLOCKS=1 → DIVSEL=/2。60MHz 上限（约束 PLL_ILLEGAL）。
- ADC：先上电带隙/基准，强制 1ms 等待。

### 1.5 LLC 100W 关键计算（SYSCLK=60MHz）
- 100kHz 对称：TBPRD=300；死区 200ns=12 tick；20us 中断 PRD=1199（Timer0→PIE INT1.7）。
- 生成器 codegen.py 已按这些公式自动计算 TBPRD/CMPA/DBRED/PRD。

### 1.6 待 grep 确认（上机编译前）
1. `EPwm1Regs.CMPA.half.CMPA`（已在生成代码中使用，HRPWM union，直接 CMPA= 不编译）
2. ePWM1 SOCA 的 `TRIGSEL` 值（生成代码暂写 5 并标 [待核实]，需查 DSP2803x_Adc.h）
3. MUX 编号 `source_verified=false` 的条目 —— 约束检查器已对其**拒绝导出**（UNRESOLVED_PARAM），核实后改 true 解锁。

---

## 2. 遗留 / 下一步（非阻塞）

1. **MUX 定序核实**：对照 SPRS584Q Table 5-1 把关键脚（GPIO0/1 ePWM、TZ 脚、ADC 触发脚）的 `source_verified` 置 true。当前所有非 MUX0 复用都被约束器阻断导出，这是**故意的安全行为**。
2. **代码生成器的 ADC TRIGSEL**：确认 ePWM1 SOCA 真实值后更新 codegen.py。
3. **向导与引脚联动深化**：当前点功能树会打开对应向导；尚未把向导参数与具体引脚选择绑定到同一配置对象（Phase C 已能在 wizard 里点"生成该外设代码"回显/导出）。
4. **CCS buildProject 目标构建测试**：工作单要求用 CCS21 对 staging 最小工程做 buildProject（不 Load/Run）。本会话未执行（需 CCS 环境）。
5. **软件控制层**（工作单 §4.G：State Machine/PFM/PI/Current Limit/Soft Start/Fast/Slow Task）尚未建双向索引，属后续增强。

---

## 3. 环境教训（历史，备查）

session 1-3 工具通道反复失效：write 假成功落盘占位符、bash 空返回/exit 1、read 返回合成内容。
教训已内建到流程：**每个文件写完立即核对字节数；用 test_client/实跑验证而非凭"写入成功"；关键结论写进本日志防丢。**
session 4 全程稳定，所有进度均真实落盘并经 test_client/实跑/单测三重验证。

> 若工具通道再次失效：停止写文件，只读已落盘文件核对，等通道恢复再继续；绝不把"假成功"当真实进度。

---

## 4. 交接断点（next action）

Phase A-D 已全部落地并通过测试。剩余均为**核实类**而非**开发类**工作：

1. 对 SPRS584Q Table 5-1 核实关键脚 MUX 定序 → 把对应 `source_verified` 改 true → 重跑 `python build_device_db.py` + `python -m unittest discover -s tests`
2. grep 确认 `DSP2803x_Adc.h` 中 ePWM1 SOCA 的 TRIGSEL 值 → 更新 codegen.py
3. 有 CCS 环境时对 `generator/staging/gen_*/` 最小工程跑 buildProject（不 Load/Run）
4. 全部核实通过后，才可考虑写最终态 `F28034_CONFIG_STUDIO_V1_READY_FOR_REVIEW`（当前**不要**写）

---

## 0. 当前真实状态（2026-07-30 12:36 实测）

### 磁盘上实际存在的文件（唯一可信清单）

```text
F28034_LLC_ConfigStudio/
├── build_device_db.py                                   16268 B  建库脚本（可运行）
└── devices/ti/c2000/
    ├── f2803x/family.json                                3787 B  家族公共数据
    └── parts/tms320f28034/
        ├── device.json                                    856 B  器件信息
        ├── constraints.json                              2537 B  约束规则表
        ├── pinmux.json                                  75139 B  80脚×MUX数据库（核心）
        └── packages/pnt80.json                          10472 B  封装几何数据
```

**app.py / web/ / tests/ / docs/ / start.bat 均不存在**，此前会话中"写入成功"的文件全部是环境失真，从未落盘。
空目录（web/css、web/js、generator、validators、tests、docs、generated、generator/staging 等）已建好，无内容。

### 环境

| 项 | 值 |
|---|---|
| 工作目录 | `D:\1POWERlearning\program_LLC\F28034_LLC_ConfigStudio` |
| Python | 3.13.14 |
| Flask | 3.1.3（已 pip 安装） |
| TI 设备库 | `D:\CCS21_workspace\LLC_100W_F28034\device`（F2803x Support Library v2.01） |
| 引脚数据源 | `D:\1POWERlearning\references\TMS320F28034_PN80_pinout.csv`（81行 = 表头+80脚，已清理） |
| 官方手册 | SPRS584Q（**不是** SPRS517） |

---

## 1. 已核实结论（不要重新推导）

### 1.1 数据源修正（已由官方 CSV/MD 证实，原会话已纠正）
1. 手册 = **SPRS584Q**（PNT80 = PN 封装 80-LQFP，T = 温度等级后缀，不影响引脚）
2. **F28034 有 eCAN**：pin32 GPIO31/CANTXA，pin33 GPIO30/CANRXA；头文件含 `PCLKCR0.ECANAENCLK` + DSP2803x_ECan.h
3. MUX 寄存器名 = `GPAMUX1`（GPIO0-15）/`GPAMUX2`（GPIO16-31）/`GPBMUX1`（GPIO32-44），不是 GPA1MUX

### 1.2 寄存器归属（已对 DSP2803x_Gpio.h 逐行核实，编译期必需）

| 操作 | 结构体 | 寄存器（GPIO0-31 / 32-44） |
|---|---|---|
| MUX | `GpioCtrlRegs` | GPAMUX1 / GPAMUX2 / GPBMUX1 |
| QSEL | `GpioCtrlRegs` | GPAQSEL1 / GPAQSEL2 / GPBQSEL1 |
| DIR | `GpioCtrlRegs` | GPADIR / GPBDIR |
| PUD | `GpioCtrlRegs` | GPAPUD / GPBPUD |
| SET/CLEAR/TOGGLE/DAT | `GpioDataRegs` | GPASET… / GPBSET…（**不是 GpioCtrlRegs**） |

> 原会话误报 set_field/clr_field 用错结构体；grep 证实 build_device_db.py 中**已正确用 GpioDataRegs**，无需修复。

### 1.3 GPIO19 四项复用 ≠ MUX 溢出（本会话重点澄清）

- CSV 列 `XCLKIN;SPISTEAn;LINRXA;ECAP1` 共 4 项，但 GPAMUX2 每脚仅 2bit（MUX 0-3）。
- `DSP2803x_SysCtrl.h` 第 60 行证实 `XCLKINSEL`（`SysCtrlRegs.XCLK.bit.XCLKINSEL`）是**系统控制寄存器**选源（0=GPIO19, 1=GPIO38），不占 GPAMUX 槽位。
- 因此 GPIO19 真实情况：
  - MUX1=SPISTEAn、MUX2=LINRXA、MUX3=ECAP1（MUX 槽内，待 PDF Table 5-1 定序）
  - XCLKIN = 非 MUX 功能，由 XCLK.bit.XCLKINSEL 控制，属"alt_non_mux"
- **当前 pinmux.json 中是错的**：把 XCLKIN 错放进 MUX1、丢弃了 ECAP1。修复脚本见 §2。

### 1.4 头文件逐行核实值

- **AIO 只有** `AIO2/4/6/10/12/14` 有效（奇数位全是 rsvd），测试必须断言。
- PCLKCR 位：`PCLKCR0.TBCLKSYNC`（**在 PCLKCR0 不是 PCLKCR1**）、`ADCENCLK`、`SPIA/BENCLK`、`SCIAENCLK`、`I2CAENCLK`、`ECANAENCLK`、`HRPWMENCLK`、`LINAENCLK`；`PCLKCR1.EPWM1-7ENCLK`、`ECAP1ENCLK`、`EQEP1ENCLK`；`PCLKCR3.COMP1-3ENCLK`、`CPUTIMER0-2ENCLK`、`CLA1ENCLK`；`PCLKCR2.HRCAP1/2ENCLK`。
- 看门狗：`WDCR` 的 WDCHK 字段**必须写 101**，否则立即复位；禁用值 `0x0068`；喂狗 `WDKEY=0x55; WDKEY=0xAA`。
- PLL：DIVSEL 先 /4 → 设 PLLCR.DIV → 等 PLLLOCKS=1 → DIVSEL 改目标。SYSCLK 上限 60MHz。
- ADC：先上电带隙/基准，**强制 1ms 等待**再进时钟/触发配置。

### 1.5 LLC 100W 关键计算（SYSCLK=60MHz）

- 100kHz 对称计数：`TBPRD = 60000000/(2×100000) = 300`
- 死区 200ns：`DBRED = DBFED = 200ns/16.67ns = 12 tick`
- 20us 中断：`Timer0 PRD = 60000000×20e-6 − 1 = 1199`；Timer0 → PIE Group1 Ch7（INT1.7）
- ePWM 触发 ADC：`ADCTRL2.bit.SOC0_TRIGSEL`，ePWM1 SOCA 待确认（推测=5，需 grep DSP2803x_Adc.h）

### 1.6 待 grep 确认的 3 个符号（上机编译前必查）

1. `EPwm1Regs.CMPA.half.CMPA = …`（HRPWM 片上 CMPA 是 16+8 union，**直接赋值 `CMPA=` 不编译**）
2. `DB_ACTV_HIC` 的拼写（DSP2803x_EPwm_defines.h）
3. ePWM1 SOCA 的 `TRIGSEL` 值（DSP2803x_Adc.h，推测 5）
4. MUX 编号按 CSV 分号列序推断，`source_verified` 一律设为 `false`，待对 SPRS584Q Table 5-1 逐脚确认后改 true；约束器对未验证 MUX 赋值拒绝导出。

---

## 2. 遗留待修复：build_device_db.py 的 XCLKIN 拆分

**这是重建前唯一必须做的数据库修复。**

在 `FIXED_GROUPS` 常量附近加模块级定义：

```python
# 不由 GPxMUX 选源的"非 MUX 复用"。
# 证据：DSP2803x_SysCtrl.h 第60行 XCLKINSEL（SysCtrlRegs.XCLK.bit.XCLKINSEL，
#       0=GPIO19，1=GPIO38）。XCLKIN 不占 GPAMUX 槽位。
NON_MUX_FUNCTIONS = {
    "XCLKIN": {
        "selector": "SysCtrlRegs.XCLK.bit.XCLKINSEL",
        "source_document": "DSP2803x_SysCtrl.h",
        "source_section": "XCLK_BITS.XCLKINSEL",
    }
}
```

`build_pinmux()` 里、进 MUX 循环之前拆分：

```python
non_mux = [a for a in alts if a in NON_MUX_FUNCTIONS]
mux_alts = [a for a in alts if a not in NON_MUX_FUNCTIONS]

for i, alt in enumerate(mux_alts[:3]):   # ← 原来是 alts[:3]
    mux_options.append({
        "mux": i + 1, "function": alt, "type": classify_alt(alt),
        "source_verified": False, "source_document": "SPRS584Q",
        "source_section": "Table 5-1",
    })
if len(mux_alts) > 3:
    WARNINGS.append(f"pin {pnum} GPIO{gnum}: {len(mux_alts)} MUX 复用超过2bit MUX 槽，保留前3个，待 Table 5-1 定序")

if non_mux:
    entry["alt_non_mux"] = [{
        "function": fn,
        "selector": NON_MUX_FUNCTIONS[fn]["selector"],
        "source_verified": False,
        "source_document": NON_MUX_FUNCTIONS[fn]["source_document"],
        "source_section": NON_MUX_FUNCTIONS[fn]["source_section"],
    } for fn in non_mux]
```

并在脚本顶部加 `WARNINGS: list[str] = []`，main 里：

```python
valid_aio = {"AIO2","AIO4","AIO6","AIO10","AIO12","AIO14"}
for e in pinmux["pins"].values():
    if e.get("aio") and e["aio"] not in valid_aio:
        WARNINGS.append(f"pin {e['physical_pin']} {e['primary_signal']}: {e['aio']} 不是有效数字 AIO（仅 2/4/6/10/12/14）")
(BASE / "docs").mkdir(parents=True, exist_ok=True)
(BASE / "docs/build_warnings.json").write_text(json.dumps(WARNINGS, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"  {len(WARNINGS)} warnings -> docs/build_warnings.json")
```

**自检预期**：重跑 `python build_device_db.py` → 80 pins / 45 GPIO；pin55(GPIO19) 应含 `MUX3→ECAP1` + `alt_non_mux:[XCLKIN]`。

---

## 3. Phase A 执行顺序（修复后按序落盘）

每个文件写完后立即 `Get-Item` 核对 Length>0 再继续，防止再写假文件。

1. **修复并重建数据库**（§2）→ `python build_device_db.py`
2. **`svg_generator.py`** → 生成 `web/img/chip_pnt80.svg`
   - 只读 `pinmux.json` + `packages/pnt80.json`，不硬编码引脚
   - LQFP80：left=pin1-20 / bottom=pin21-40 / right=pin41-60 / top=pin61-80（自脚1角反时针，Pin1 圆点在左上）
   - 每脚一个 `<g class="pin p<pin>" data-pin=...>`（pad rect + 脚号 + 信号名），class 由 CSS 切 st-avail/st-sel/st-occ/st-err
   - 固定脚 class+pin-fixed；configurable 加 data-configurable=1
   - viewBox 0 0 1180 1180，BODY=420，PINS_PER_SIDE=20
3. **`app.py`**（Flask，127.0.0.1:5173，禁外网/禁 JTAG/禁 Load/Run/禁写 Flash）
   - `Registry` 扫 `devices/ti/c2000/parts/*/device.json` 自动发现芯片（Phase D 插新芯片=放新目录，不改代码）
   - API：`/api/config`、`/api/device/{d}`、`/api/device/{d}/pinmux`、`/api/device/{d}/constraints`、`/api/device/{d}/index`（function→pins 反索引，供双向高亮）、`/api/search?q=`（pins+functions 统一搜索）、`/api/validate`(POST)、`/api/generate`(POST，**仅 mode∈{preview,staging}，服务端硬性拒绝其它路径**)、`/api/ti-files`、`/api/health`
   - 启动时自动跑 `svg_generator` 若 svg 缺失
4. **`web/index.html` + `web/css/style.css`**
   - 三栏：顶栏（芯片选择/全局搜索/工程）+ 左（SVG 芯片图 + 图例）+ 中（功能树/阶梯向导/已配置引脚 三个 tab）+ 右（引脚详情/寄存器/代码/校验 四个 tab）
   - 颜色规范：蓝=可选、绿=已选、黄=占用、红=冲突、灰=电源/地/固定
   - 顶部始终显示安全横幅：离线·只读正式工程·不接 JTAG·不下载·不写 Flash·不自动启用 PWM
5. **`web/js/`（顺序：store → chip → tree → detail → search → app）**
   - `store.js`：单一数据源 + 事件总线；`pinState()` 统一判 5 色
   - `chip.js`：加载 SVG、点击、缩放/平移、repaint
   - `tree.js`：按外设分组的功能树，点功能→设 activeFunction
   - `detail.js`：右栏四 tab（详情/MUX 分级选择、寄存器映射表、最小初始化 C 代码预览、校验结果）
   - `search.js`：防抖搜索、↑↓ Enter 导航、点结果联动定位
   - `app.js`：bootstrap（拉 config→pinmux→constraints→svg→建树→接线）
   - **双向联动设计**：芯片视图与功能树互不引用，都只读 store。点树→`setActiveFunction`→候选脚蓝；点脚→`selectPin`→详情列 MUX 选项；两条路径共用同一 `pinState()`。
6. **`tests/test_phase_a.py`**（unittest，数据库断言）
   - 80 脚唯一、45 GPIO 无重复、GPIO 编号 0-44
   - mux_field/dir/pud∈GpioCtrlRegs；set/clr/dat/tog∈GpioDataRegs
   - 电源/地/复位/JTAG/TEST2/X1/X2/VREGENZ 不可配置
   - AIO ⊆ {2,4,6,10,12,14}
   - 反向索引：EPWM1A→pin69(GPIO0)；TZ1n→{47(GPIO12),75(GPIO15)}；ECAP1 可达（经 GPIO19 MUX3 或 GPIO24 MUX1）
   - XCLKIN 在 alt_non_mux、不在 mux_options
7. **`start_config_studio.bat`**：cd 项目 → `start http://127.0.0.1:5173` → `python app.py`（只绑 127.0.0.1）

### Phase A 验收（全部通过才进 Phase B）
- 点 69 脚：右侧出 GPIO0，MUX0=GPIO0 / MUX1=EPWM1A；选 MUX1 → 该脚变绿 + 代码预览出 `GPAMUX1.bit.GPIO0=1; GPAPUD.bit.GPIO0=1;`
- 功能树选 EPWM1A → pin69 蓝；选后绿；占黄；冲突红
- 搜 `TZ1` → 命中 GPIO12(MUX1)/GPIO15(MUX1)，点击定位
- 点 VDD（pin7）→ 拒绝，提示电源脚不可配置，不出 GPIO 代码
- 同一脚先配 MUX1 再配 MUX2 → 报冲突红
- `python -m unittest discover tests -v` 全过

---

## 4. Phase B 阶梯式向导（数据驱动，wizards.json）

每条阶梯 7 字段：`title / why / regs[] / hw_action / risk / verify / params[]`。新增外设=加 JSON 段，不改代码。
**关键安全顺序（已确认）**：
- GPIO 输出：`开锁 → 预置电平(SET/CLEAR) → 归属MUX=0 → 方向DIR → 电气属性(PUD/QSEL) → 上锁EDIS → 验证`
  - **电平必须在方向之前**：方向=1 之前引脚是高阻输入，写 DAT 只进锁存；顺序反了会在开驱动瞬间产生不确定宽度的错误脉冲，可能误导通功率级。
- ePWM 互补：`PCLKCR1 → TBCLKSYNC=0 → SW强制OST钳位(TZCLR 前先 TZSEL OST + TZCTL 双双低 + TZFORCE.OST=1) → 引脚MUX → TBPRD → CMPA → AQ → DeadBand(模式6=ACTIVE_HIGH_COMPLIMENTARY) → TZ → 清计数器 → TBCLKSYNC=1 → 验证`
  - **释放钳位（TZCLR.OST）单独成函数 `EPWMx_ReleaseClamp()`，绝不进自动生成 InitAll**，由应用层在确认母线/驱动供电/死区后显式调用——这是全系统唯一真正给功率级上波形的步骤。
- ADC：`ADCENCLK → 上电(带隙/基准) → 1ms 等待 → 时钟 → SOC0 TRIGSEL=ePWM1 SOCA → ACQPS → INTPULSEPOS → INT1SEL → 清INT → 使能 → 验证`
- Timer0：`CPUTIMER0ENCLK → PRD=1199 → 除频 → 清TIF → 注册ISR(PIE Vect INT1.7) → 使能TIE → 使能PIE → 使能IER.1 → 启动TSS=0 → 验证`

---

## 5. Phase C 代码生成 + 约束 + 导出

- `generator/`：`codegen.py`（模板渲染）、`pinmux.py`、`system_clock.py`、`pwm.py`、`adc.py`、`timer.py`、`init_all.py`、`patch.py`
- 输出到 `generator/staging/gen_YYYYMMDD_HHMMSS/`：
  `generated_config.json / pinmux_init.c(h) / system_clock_init.c(h) / pwm_init.c(h) / adc_init.c(h) / timer_interrupt_init.c(h) / protection_init.c(h) / generated_init_all.c(h) / required_ti_files.txt / generation_report.md / validation_report.md`
- `validators/constraint_checker.py` 实现 constraints.json 全部规则：脚冲突、MUX 非法、电源脚出 GPIO、PWM 无 Trip(警告)、互补零死区、TBPRD/DBRED 溢出、ADC 通道与脚不符、SOC 重复、PLL 非法、未验证 MUX 拒绝导出、PWM 释放顺序不安全。
- `Generated_InitAll()` 调用顺序（已确认）：`PWM紧急关断(InitGpioSafe) → InitSystemClock → InitPinMux → InitPeripheralClocks → InitPwm(保持钳位) → InitAdc(含1ms) → InitTimerInterrupt → InitProtection → return 0`。
- 生成代码引用 `D:\CCS21_workspace\LLC_100W_F28034\device` 官方头文件；`required_ti_files.txt` 列所需 .c 源（SysCtrl/Gpio/EPwm/Adc/PieCtrl/PieVect/GlobalVariableDefs/CpuTimers + usDelay.asm + DefaultIsr.asm）。**绝不重写 TI 寄存器定义**。
- 导出只走 staging，永不碰正式工程；补丁仅生成 `patch.diff` 供人工审查。

---

## 6. Phase D 多芯片插件

- 已满足：family.json 承载 f2803x 公共数据，parts/ 各芯片只放差异。
- `parts/tms320f28035/`：`device.json` 标 `status:"SKELETON"`，pinmux 留空 + note「待 SPRS585 数据手册核实」，**不宣称已验证**。Registry 自动发现，前端芯片下拉即出现，无需改代码。

---

## 7. 验收交付物清单（工作单 §13）

```text
可运行软件 / PNT80 芯片图 / 设备数据库 / 双向索引 / 阶梯向导 /
代码生成器 / 静态验证器 / 单元测试 / 用户手册 / 数据库维护手册 /
多芯片插件说明 / 示例工程 / 测试报告 / SHA256 清单 / 回滚说明
```

**`F28034_CONFIG_STUDIO_V1_READY_FOR_REVIEW` 是最终态，严禁提前写。**
当前完成度约 Phase A 的 30%（仅数据库层），Phase B/C/D 未开始。

---

## 8. 继续开发的断点（next action）

1. `python build_device_db.py`（先按 §2 修复 XCLKIN 拆分）→ 核对自检输出
2. 按 §3 顺序逐个落盘 Phase A 文件，每个文件写完核对字节数
3. Phase A 验收通过后进 Phase B

> 若工具通道再次失效（bash 空返回 / write 假成功），立即停止写文件，只读已落盘文件核对，等通道恢复再继续；绝不把"假成功"当成真实进度。
