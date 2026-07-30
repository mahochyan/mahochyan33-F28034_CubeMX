/* R3 detail/assigned/code rendering. All code comes from /api/preview. */
(function () {
  let preview = { files: {}, recommended_file: null, current_file: null };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }
  function highlight(code) {
    let text = esc(code);
    text = text.replace(/(\/\/[^\n]*)/g, '<span class="c-cmt">$1</span>');
    text = text.replace(/\b(EALLOW|EDIS|void|return|if|for|Uint16|Uint32|static)\b/g,
      '<span class="c-kw">$1</span>');
    return text;
  }

  function renderPin(pin) {
    const root = document.getElementById('detailPanel');
    const def = Store.pinDef(pin);
    if (!def) {
      root.innerHTML = '<div class="empty-state dim">未知引脚。</div>'; return;
    }
    const cfg = Store.getPin(pin);
    root.innerHTML = `
      <dl class="kv">
        <dt>物理脚号</dt><dd>Pin${def.physical_pin}</dd>
        <dt>主名称</dt><dd>${esc(def.primary_signal)}</dd>
        <dt>类型</dt><dd>${esc(def.pin_type)}</dd>
        ${def.gpio_num != null ? `<dt>GPIO</dt><dd>GPIO${def.gpio_num}</dd>` : ''}
        <dt>可配置</dt><dd>${def.configurable ? '是' : '否（只读详情）'}</dd>
      </dl>
      ${cfg ? `<div class="sec-title">committed 配置</div>
        <pre class="config-json">${esc(JSON.stringify(cfg, null, 2))}</pre>` :
        '<div class="empty-state dim">尚未配置。</div>'}`;
  }

  function renderRegs(pin) {
    const root = document.getElementById('regsPanel');
    const def = Store.pinDef(pin);
    if (!def?.configurable) {
      root.innerHTML = '<div class="empty-state dim">该脚无可配置 GPIO 寄存器。</div>'; return;
    }
    root.innerHTML = `<table class="reg-table"><tbody>
      <tr><td>MUX</td><td class="field">${esc(def.mux_field)}</td></tr>
      <tr><td>方向</td><td class="field">${esc(def.dir_field)}</td></tr>
      <tr><td>上拉</td><td class="field">${esc(def.pud_field)}</td></tr>
      <tr><td>输入资格</td><td class="field">${esc(def.qsel_field || def.qsel_reg)}</td></tr>
    </tbody></table>`;
  }

  function setPreview(result) {
    preview = {
      files: result?.files || {},
      recommended_file: result?.recommended_file || null,
      current_file: result?.recommended_file || Object.keys(result?.files || {})[0] || null,
    };
    renderCode();
  }
  function selectFile(name) { preview.current_file = name; renderCode(); }
  function renderCode() {
    const panel = document.getElementById('codePanel');
    const tabs = document.getElementById('codeFiles');
    const names = Object.keys(preview.files);
    if (tabs) {
      tabs.innerHTML = names.map(name =>
        `<button type="button" class="code-file-tab ${
          name === preview.current_file ? 'active' : ''}" data-file="${esc(name)}">${esc(name)}</button>`
      ).join('');
      tabs.querySelectorAll('[data-file]').forEach(button =>
        button.addEventListener('click', () => selectFile(button.dataset.file)));
    }
    const label = document.getElementById('currentCodeFile');
    if (label) label.textContent = preview.current_file || '无文件';
    if (!names.length) {
      panel.innerHTML = '<code>// 尚无后端生成预览。</code>'; return;
    }
    panel.innerHTML = `<code>${highlight(preview.files[preview.current_file] || '')}</code>`;
  }

  function renderCheck(result) {
    const root = document.getElementById('checkPanel');
    const findings = result?.findings || [];
    if (!findings.length || findings.every(item => item.severity === 'INFO')) {
      root.innerHTML = '<div class="check-ok">✓ 未发现阻断项</div>'; return;
    }
    root.innerHTML = findings.map(item => `
      <div class="finding ${esc(item.severity)}">
        <span class="sev">${esc(item.severity)}</span>
        <div class="msg">${esc(item.message)}<div class="rule">${esc(item.rule)}</div></div>
      </div>`).join('');
  }

  function pinSummary(pin) {
    const module = pin.module && Store.project.pwm_modules[pin.module];
    return module ? {
      ...pin, pwm: {
        mode: module.mode, frequency_hz: module.frequency_hz,
        duty: module.duty, count_mode: module.count_mode,
        deadband: module.deadband, trip: module.trip,
      },
    } : pin;
  }

  function renderAssigned() {
    const root = document.getElementById('assignedPanel');
    const pins = Store.assignedList();
    if (!pins.length) {
      root.innerHTML = '<div class="empty-state dim">尚未配置任何引脚。</div>'; return;
    }
    root.innerHTML = pins.map(pin => `
      <details class="assigned-item" data-pin="${pin.physical_pin}">
        <summary>Pin${pin.physical_pin} ${esc(pin.signal)} / ${esc(pin.function)}</summary>
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
        Store.selectPin(pin); Chip.focusPin(pin);
      });
      item.querySelector('[data-action="edit"]').addEventListener('click', () => {
        if (Store.editPin(pin)) {
          activateTab('#pane-mid', 'tree');
          Tree.reveal(Store.getPin(pin).function);
          const node = document.querySelector(`.function-node[data-function="${CSS.escape(Store.getPin(pin).function)}"]`);
          if (node) Wizard.mountInline(node.querySelector('.inline-editor'));
        }
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        const cfg = Store.getPin(pin);
        const text = cfg?.module
          ? `删除 Pin${pin} 将删除整个 ${cfg.module} 互补/保护组，继续吗？`
          : `删除 Pin${pin} 配置，继续吗？`;
        if (window.confirm(text)) Store.removePin(pin);
      });
    });
  }

  window.Detail = {
    renderPin, renderRegs, renderCode, renderCheck, renderAssigned,
    setPreview, highlight,
  };
})();
