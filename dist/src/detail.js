/* R3.2 detail, assigned-pin, code-preview and validation rendering. */
(function () {
  'use strict';

  let preview = { files: {}, recommended_file: null, current_file: null };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function highlight(code) {
    let text = esc(code);
    text = text.replace(/(\/\/[^\n]*)/g, '<span class="c-cmt">$1</span>');
    return text.replace(/\b(EALLOW|EDIS|void|return|if|for|Uint16|Uint32|static)\b/g,
      '<span class="c-kw">$1</span>');
  }

  function renderPin(pin) {
    const root = document.getElementById('detailPanel');
    if (pin == null) {
      root.innerHTML =
        '<div class="empty-state dim">点击左侧芯片图上的一个引脚查看详情。</div>';
      return;
    }
    const def = Store.pinDef(pin);
    if (!def) {
      root.innerHTML = '<div class="empty-state dim">未知引脚。</div>';
      return;
    }
    const configured = Store.getPin(pin);
    const options = (def.mux_options || []).map(option => `
      <div class="mux-opt">
        <span class="muxno">MUX${option.mux}</span>
        <span class="fname">${esc(option.function)}</span>
        <span class="ftype">${esc(option.type)}</span>
        ${option.peripheral_init_supported
          ? '<span class="state-tag t-sel">完整 ePWM 初始化</span>'
          : '<span class="unverified">pinmux-only</span>'}
      </div>`).join('');
    root.innerHTML = `
      <dl class="kv">
        <dt>物理脚号</dt><dd>Pin${def.physical_pin}</dd>
        <dt>主名称</dt><dd>${esc(def.primary_signal)}</dd>
        <dt>类型</dt><dd>${esc(def.pin_type)}</dd>
        ${def.gpio_num != null ? `<dt>GPIO</dt><dd>GPIO${def.gpio_num}</dd>` : ''}
        <dt>可配置</dt><dd>${def.configurable ? '是' : '否（固定功能脚）'}</dd>
      </dl>
      ${def.configurable ? `<div class="sec-title">Golden MUX 选项</div>${options}` : ''}
      ${configured ? `<div class="sec-title">Committed ProjectConfig</div>
        <pre class="config-json">${esc(JSON.stringify(configured, null, 2))}</pre>` :
        '<div class="empty-state dim">尚未配置。</div>'}`;
  }

  function renderRegs(pin) {
    const root = document.getElementById('regsPanel');
    if (pin == null) {
      root.innerHTML =
        '<div class="empty-state dim">选择引脚后显示相关寄存器与位域映射。</div>';
      return;
    }
    const def = Store.pinDef(pin);
    if (!def?.configurable) {
      root.innerHTML = '<div class="empty-state dim">该脚没有可配置 GPIO 位域。</div>';
      return;
    }
    root.innerHTML = `<table class="reg-table"><tbody>
      <tr><td>MUX</td><td class="field">${esc(def.mux_field)}</td></tr>
      <tr><td>方向</td><td class="field">${esc(def.dir_field)}</td></tr>
      <tr><td>上拉</td><td class="field">${esc(def.pud_field)}</td></tr>
      <tr><td>输入资格</td><td class="field">${esc(def.qsel_field || def.qsel_reg)}</td></tr>
      <tr><td>数据</td><td class="field">${esc(def.dat_field || def.dat_reg)}</td></tr>
    </tbody></table>`;
  }

  function setPreview(result) {
    const files = result?.files || {};
    preview = {
      files,
      recommended_file: result?.recommended_file || null,
      current_file: result?.recommended_file || Object.keys(files)[0] || null,
    };
    renderCode();
  }

  function pinLabel(physicalPin, functionName) {
    if (physicalPin == null) return null;
    return `Pin${Number(physicalPin)} → ${functionName}`;
  }

  function pwmGuide() {
    const modules = Object.entries(Store.project.pwm_modules || {})
      .sort(([a], [b]) => a.localeCompare(b));
    if (!modules.length) {
      return {
        intro: '当前工程还没有配置 PWM。请先在功能树中选择 ePWM 功能并完成阶梯向导。',
        pins: [],
        steps: [],
      };
    }
    const pins = [];
    const releases = [];
    for (const [name, module] of modules) {
      pins.push(pinLabel(module.pin_a, `${name}A`));
      if (module.pin_b != null) pins.push(pinLabel(module.pin_b, `${name}B`));
      if (module.trip?.enabled && module.trip.pin != null) {
        pins.push(pinLabel(
          module.trip.pin,
          String(module.trip.source || 'Trip').toUpperCase().endsWith('N')
            ? String(module.trip.source).toUpperCase()
            : `${String(module.trip.source).toUpperCase()}N`,
        ));
      }
      releases.push(`${name}_ReleaseClamp()`);
    }
    return {
      intro: '这些物理脚已经由 ePWM 外设接管。初始化完成不等于已经输出脉冲：生成器会先把 A/B 两路保持在低电平。',
      pins: pins.filter(Boolean),
      steps: [
        '在主程序启动阶段先调用 Generated_InitAll()，并检查它的返回值必须为 0。',
        '先不要接入高压母线；用示波器确认驱动电源、地线和故障输入的电平符合原理图。',
        '确认 Trip 故障输入已经恢复为无故障状态，并确认上下管驱动不会同时导通。',
        `满足全部硬件安全条件后，再显式调用 ${releases.join('、')}；返回 0 才表示钳位已解除。`,
        '先在低压、限流条件下观察频率、占空比、互补极性和死区，全部正确后再进入功率级调试。',
      ],
      warning: '不要把 ReleaseClamp() 紧跟在初始化函数后面无条件调用；它必须放在实际硬件安全检查之后。',
    };
  }

  function pinmuxGuide() {
    const pins = Store.assignedList().filter(pin =>
      !/^EPWM[1-7][AB]$/i.test(String(pin.function || '')));
    const selected = Store.selectedPin == null ? null : Store.getPin(Store.selectedPin);
    const ordered = selected && pins.some(pin =>
      Number(pin.physical_pin) === Number(selected.physical_pin))
      ? [selected, ...pins.filter(pin =>
        Number(pin.physical_pin) !== Number(selected.physical_pin))]
      : pins;
    const steps = ordered.map(pin => {
      const def = Store.pinDef(pin.physical_pin);
      const fn = String(pin.function || '');
      if (/^GPIO\d+$/i.test(fn)) {
        if (pin.direction === 'input') {
          return `Pin${pin.physical_pin} / ${fn} 是输入脚；初始化后从 ${def?.dat_field || 'GPIO 数据寄存器'} 读取实际电平。`;
        }
        return `Pin${pin.physical_pin} / ${fn} 是输出脚；初始化后通过 ${def?.set_field || 'SET 寄存器'} 置高、${def?.clr_field || 'CLEAR 寄存器'} 置低。`;
      }
      return `Pin${pin.physical_pin} 已切换为 ${fn}；本工具只完成这个脚的 MUX/上拉/输入资格配置，还需要由你的业务代码初始化并使用 ${fn} 所属外设。`;
    });
    return {
      intro: 'PinMux 只负责把封装上的物理脚连接到芯片内部 GPIO 或外设模块，不会自动完成所有外设业务逻辑。',
      pins: ordered.map(pin => pinLabel(pin.physical_pin, pin.function)).filter(Boolean),
      steps: steps.length ? steps : [
        '当前没有非 ePWM 可配置脚；完成 GPIO 或通信功能向导后，这里会给出对应的读写方法。',
      ],
      warning: '先对照原理图确认物理脚号和电平极性，再把生成文件加入 CCS 工程。',
    };
  }

  function adcGuide() {
    const adc = Store.project.adc;
    if (!adc) {
      return {
        intro: '当前工程没有 ADC 配置。',
        pins: [],
        steps: ['先在功能向导中选择 ADC 通道、SOC、触发源和采样窗口。'],
      };
    }
    const pin = Object.values(Store.pinmux?.pins || {}).find(def =>
      String(def.primary_signal || '').toUpperCase() === String(adc.channel).toUpperCase());
    return {
      intro: `SOC${adc.soc} 会按 ${adc.trigger} 触发方式采样 ${adc.channel}，采样窗口为 ${Number(adc.acqps) + 1} 个 ADC 时钟周期。`,
      pins: pin ? [pinLabel(pin.physical_pin, adc.channel)] : [String(adc.channel)],
      steps: [
        '先确认输入电压没有超过芯片 ADC 允许范围，并保证模拟地与采样电路连接正确。',
        '在主程序中调用 Generated_InitAll() 完成 ADC 上电和 SOC 配置。',
        `触发转换后，从对应的 ADCRESULT${adc.soc} 结果寄存器读取采样值；再按你的分压比例换算成实际电压。`,
      ],
      warning: '这里的说明不替代模拟前端量程、RC 滤波和校准计算。',
    };
  }

  function usageGuide(fileName) {
    const file = String(fileName || '');
    if (/^pwm_init\.[ch]$/.test(file)) return pwmGuide();
    if (/^pinmux_init\.[ch]$/.test(file)) return pinmuxGuide();
    if (/^adc_init\.[ch]$/.test(file)) return adcGuide();
    if (/^generated_init_all\.[ch]$/.test(file)) {
      return {
        intro: '这是主程序最先使用的统一初始化入口；它先把 PWM 相关脚拉低，再按安全顺序调用各模块初始化。',
        pins: Store.assignedList().map(pin =>
          pinLabel(pin.physical_pin, pin.function)).filter(Boolean),
        steps: [
          '在完成 TI 官方器件基础初始化后调用 Generated_InitAll()。',
          '返回值非 0 时立即停在安全状态并排查时钟故障，不要继续运行控制逻辑。',
          '返回 0 后 PWM 仍保持低电平；功率级必须经过额外硬件检查和 ReleaseClamp() 才能放行。',
        ],
        warning: 'Generated_InitAll() 成功只代表寄存器初始化完成，不代表硬件已经具备上电条件。',
      };
    }
    if (/^system_clock_init\.[ch]$/.test(file)) {
      return {
        intro: '这个文件配置芯片内部系统时钟，不直接对应外部管脚。',
        pins: [],
        steps: [
          '由 Generated_InitAll() 自动调用，并检查返回值。',
          '若返回非 0，应保持 PWM 关闭并检查时钟源、PLL 配置和芯片状态。',
        ],
      };
    }
    if (/^timer_interrupt_init\.[ch]$/.test(file)) {
      return {
        intro: '这个文件建立 Timer0 周期中断通路，不直接占用封装管脚。',
        pins: [],
        steps: [
          '把需要周期执行且耗时很短的任务放进生成的 Timer0 ISR。',
          '耗时计算和通信不要全部塞进 ISR，可在 ISR 中置标志，再交给主循环处理。',
        ],
      };
    }
    if (/^protection_init\.[ch]$/.test(file)) {
      return {
        intro: '这个入口为后续扩展保护链预留；当前 Trip Zone 的实际配置在 pwm_init.c。',
        pins: [],
        steps: ['切换到 pwm_init.c 查看 Trip 管脚映射、故障电平和 PWM 放行顺序。'],
      };
    }
    if (file === 'generation_blocked.txt') {
      return {
        intro: '当前 ProjectConfig 存在阻断项，所以没有生成可用初始化代码。',
        pins: [],
        steps: ['先切换到“校验”页修正全部 ERROR，再回到代码页。'],
      };
    }
    return {
      intro: '当前文件是工程数据或生成报告，不是直接操作管脚的 C 源文件。',
      pins: [],
      steps: ['切换到 pinmux_init.c 或 pwm_init.c，可查看具体管脚的接线关系和调用顺序。'],
    };
  }

  function renderUsageGuide() {
    const root = document.getElementById('usageGuidePanel');
    if (!root) return;
    const guide = usageGuide(preview.current_file);
    root.innerHTML = `
      <div class="usage-guide-head">
        <strong>初学者使用说明</strong>
        <span>独立说明，不属于生成代码，也不会写入导出文件。</span>
      </div>
      <p>${esc(guide.intro)}</p>
      ${guide.pins?.length ? `
        <h4>当前管脚关系</h4>
        <div class="usage-pin-map">${guide.pins.map(pin =>
          `<span class="usage-pin">${esc(pin)}</span>`).join('')}</div>` : ''}
      ${guide.steps?.length ? `
        <h4>怎么使用</h4>
        <ol>${guide.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}
      ${guide.warning ? `<div class="usage-warning">注意：${esc(guide.warning)}</div>` : ''}`;
  }

  function renderCode() {
    const panel = document.getElementById('codePanel');
    const tabs = document.getElementById('codeFiles');
    const names = Object.keys(preview.files);
    tabs.innerHTML = names.map(name =>
      `<button type="button" class="code-file-tab ${
        name === preview.current_file ? 'active' : ''
      }" data-file="${esc(name)}">${esc(name)}</button>`).join('');
    tabs.querySelectorAll('[data-file]').forEach(button => {
      button.addEventListener('click', () => {
        preview.current_file = button.dataset.file;
        renderCode();
      });
    });
    document.getElementById('currentCodeFile').textContent =
      preview.current_file || '无文件';
    if (!names.length) {
      panel.innerHTML = '<code>// 当前 ProjectConfig 没有可预览文件。</code>';
      renderUsageGuide();
      return;
    }
    panel.innerHTML = `<code>${highlight(preview.files[preview.current_file] || '')}</code>`;
    renderUsageGuide();
  }

  function renderCheck(result) {
    const root = document.getElementById('checkPanel');
    const findings = result?.findings || [];
    if (!findings.length || findings.every(item => item.severity === 'INFO')) {
      root.innerHTML = '<div class="check-ok">✓ 未发现阻断项</div>';
      return;
    }
    root.innerHTML = findings.map(item => `
      <div class="finding ${esc(item.severity)}">
        <span class="sev">${esc(item.severity)}</span>
        <div class="msg">${esc(item.message)}
          <div class="rule">${esc(item.rule)}</div>
        </div>
      </div>`).join('');
  }

  function pinSummary(pin) {
    const module = pin.module && Store.project.pwm_modules[pin.module];
    return module ? { ...pin, pwm: module } : pin;
  }

  function renderAssigned() {
    const root = document.getElementById('assignedPanel');
    const pins = Store.assignedList();
    if (!pins.length) {
      root.innerHTML = '<div class="empty-state dim">尚未配置任何引脚。</div>';
      return;
    }
    root.innerHTML = pins.map(pin => `
      <details class="assigned-item" data-pin="${pin.physical_pin}">
        <summary>Pin${pin.physical_pin} ${esc(pin.signal)} / ${esc(pin.function)}
          ${pin.peripheral_init_supported
            ? '<span class="state-tag t-sel">外设初始化</span>'
            : '<span class="unverified">pinmux-only</span>'}
        </summary>
        <pre>${esc(JSON.stringify(pinSummary(pin), null, 2))}</pre>
        <div class="assigned-actions">
          <button type="button" class="btn btn-sm" data-action="edit">编辑</button>
          <button type="button" class="btn btn-sm" data-action="locate">在芯片图定位</button>
          <button type="button" class="btn btn-sm" data-action="delete">删除</button>
        </div>
      </details>`).join('');
    root.querySelectorAll('.assigned-item').forEach(item => {
      const pin = Number(item.dataset.pin);
      item.querySelector('[data-action="locate"]').addEventListener('click', () => {
        Store.selectPin(pin);
        Chip.focusPin(pin);
      });
      item.querySelector('[data-action="edit"]').addEventListener('click', () => {
        if (!Store.editPin(pin)) return;
        document.querySelector('#midTabs [data-tab="tree"]').click();
        const configured = Store.getPin(pin);
        Tree.reveal(configured.function);
        const node = document.querySelector(
          `.function-node[data-function="${CSS.escape(configured.function)}"]`,
        );
        if (node) Wizard.mountInline(node.querySelector('.inline-editor'));
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        const configured = Store.getPin(pin);
        const message = configured?.module
          ? `删除 Pin${pin} 会原子删除整个 ${configured.module} A/B/Trip 组，继续吗？`
          : `删除 Pin${pin} 配置，继续吗？`;
        if (window.confirm(message)) Store.removePin(pin);
      });
    });
  }

  window.Detail = {
    renderPin,
    renderRegs,
    renderCode,
    renderCheck,
    renderAssigned,
    setPreview,
    highlight,
    usageGuide,
  };
})();
