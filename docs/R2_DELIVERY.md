# R2 主配置流程整改交付 — C2000 Config Studio for F28034

> 范围：只做真正的主配置流程（不扩展设备/寄存器分类/新向导）。
> 全部真实落盘、真实 HTTP、真实浏览器、真实 TI 编译器。

## build identity

| 项 | 值 |
|---|---|
| build_id | `7faac188858b` |
| source_sha256 | 见 `GET /api/sha256` |
| 查询 | `GET /api/health` |

## 本轮修复 / 实现

| # | 项 | 结果 |
|---|---|---|
| 1 | 每引脚独立配置对象（GPIO0 含 direction/initial_level/pullup/qualification） | Store.pins[pin] 单一对象，模式驱动剪枝 |
| 2 | 点 MUX 自动打开对应分支向导 | detail.js 选 MUX → Wizard.openForPin |
| 3 | 真单步向导（上一步/下一步/取消/完成/进度/回退清不兼容后续值） | wizard.js 单步渲染 + Store 模式剪枝 |
| 4 | GPIO 分支（模式→方向→电平[输出]→上拉→资格[输入]→摘要→完成） | 条件显隐 showIf |
| 5 | ePWM 分支（通道→频率→计数→占空比→AQ→死区→Trip→摘要→完成） | epwmSteps |
| 6 | 监听所有 ProjectConfig 变化→实时刷新右侧 | Bus `config:changed`/`wizard:step` → renderCode/renderRegs/renderCheck |
| 7 | 删前端第二套拼接，预览与导出用同一生成核心 | 新增 `/api/preview-code`，右侧预览= staging pinmux_init.c 逐字一致 |
| 8 | localStorage 持久化 + 清空引脚/工程 + 导出/导入 JSON | `_save/restore/exportJSON/importJSON` + 顶部 4 按钮 |
| 9 | 启动实例管理（PID/端口/build_id，stop 真关闭并验证端口释放） | `generator/instance.json` + `/api/shutdown` 用 `os._exit`（修 threaded dev server 不退出） |
| 10 | PN80 几何修正（right=60..41 上→下，top=80..61 左→右） | chip.js + svg_generator.py SIDES |
| 11 | 引脚显示规范统一：内部只 序号+主名称，复用功能在外侧，四边一致 | chip.js 重绘（id 在内 / fn 在外 / +N / hover title） |

## E2E 验收（真实浏览器）

| 套件 | 结果 |
|---|---|
| `e2e_r2.py` 主流程 A–I | **11/11** |
| `e2e_geometry.py` 7 个角点 | **7/7** |
| `e2e_display.py` 显示规范 §8 | **7/7** |
| `test_http_live.py` 真实 HTTP | **10/10** |
| 单元测试 | **43 全过** |
| `ccs_build_check.py` 6 场景编译+链接 | **0 error，6×.out** |

E2E 关键点：
- A GPIO0 低电平输出 → `GPACLEAR`+`GPADIR=1`
- B 高电平 → `GPASET`
- C 改输入 → initial_level 自动消失（无 SET/CLEAR 预置）+ 出现输入资格步
- D GPIO→EPWM1A → GPIO 参数清除（该脚 pinmux 延后，无 DIR 预置）
- E 每步修改右侧代码立即变化
- F 预览代码与 staging `pinmux_init.c` **逐字一致**
- G 刷新（localStorage + Store.restore）配置恢复
- H 清空当前引脚有效；I 清空整个工程有效
- J 5174 启动后 `/api/shutdown` 端口确实 RELEASED

## 显示规范（§8 验收）

- 任意引脚内部只出现「序号+主名称」（如 `69 GPIO0`、`7 VDD`、`9 XRSn`）
- 任意复用功能只出现在引脚外侧（`EPWM1A`、`EPWM1B / COMP1OUT` 等）
- 四边布局一致（每边 20 个 identity 标签，外侧功能列表向芯片外展开）
- 选 pin 后能继续进入功能选择和代码生成

## 已知说明

- 预览只展示 `pinmux_init.c`（最贴合引脚选择）；staging 导出完整 18 文件，二者 pinmux_init.c 逐字一致（§F 已断言）。
- ePWM/ADC/Timer 的深层参数在「生成代码」走完整后端生成器；引脚级阶梯专注 pinmux。

---

`CONFIG_STUDIO_R2_CORE_FLOW_READY_FOR_USER_TEST`
