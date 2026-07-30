/* R3 schema-driven inline single-step wizard. */
(function () {
  let mountEl = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function profileName() {
    const entry = Store.activeEditor.candidatePins[0];
    const type = entry?.type || 'generic';
    if (type === 'gpio' || Number(entry?.mux) === 0) return 'gpio';
    if (type === 'epwm') return 'epwm';
    if (type === 'i2c') return 'i2c';
    if (type === 'tripzone') return 'tripzone';
    return 'generic';
  }

  function schema() {
    const name = profileName();
    return Store.wizards?.profiles?.[name] || Store.wizards?.profiles?.generic;
  }

  function visible(step, draft) {
    if (!step.visible_if) return true;
    return Object.entries(step.visible_if).every(([key, value]) => draft[key] === value);
  }

  function visibleSteps() {
    const draft = Store.activeEditor.draft || {};
    return (schema()?.steps || []).filter(step => visible(step, draft));
  }

  function applyDefaults() {
    const patch = {};
    (schema()?.steps || []).forEach(step => {
      if (step.default !== undefined &&
          Store.activeEditor.draft?.[step.id] === undefined) patch[step.id] = step.default;
    });
    const selected = Store.activeEditor.selectedPin;
    if (selected != null) patch.selectedPin = Number(selected);
    Store.updateDraft(patch);
  }

  function mountInline(element) {
    mountEl = element;
    element.hidden = false;
    applyDefaults();
    render();
  }

  function summaryHtml() {
    const editor = Store.activeEditor;
    const draft = editor.draft || {};
    const checked = Store.validateDraft();
    const rows = [
      ['功能', editor.functionId],
      ['物理脚', draft.selectedPin != null ? `Pin${draft.selectedPin}` : '未选择'],
      ['模式', draft.mode || draft.direction || profileName()],
    ];
    if (profileName() === 'epwm') {
      rows.push(['频率', `${draft.frequency_hz} Hz`], ['计数', draft.count_mode],
        ['占空比', draft.duty], ['AQ', draft.aq_profile],
        ['死区', draft.mode === 'complementary' ? `${draft.red_ns}/${draft.fed_ns} ns` : '无'],
        ['Trip', draft.trip_enabled ? `${draft.trip_source} ${draft.trip_mode}` : '仅软件钳位']);
    }
    if (profileName() === 'i2c') {
      rows.push(['电气属性', '开漏；启用上拉；异步输入资格'],
        ['硬件提示', '板上必须有外部上拉电阻']);
    }
    if (profileName() === 'tripzone') rows.push(['电气属性', '异步输入，避免保护延迟']);
    return `<dl class="draft-summary">${
      rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')
    }</dl>${checked.ok ? '<div class="draft-ok">草稿可以提交</div>' :
      `<div class="draft-errors">${checked.errors.map(esc).join('<br>')}</div>`}`;
  }

  function controlHtml(step) {
    const draft = Store.activeEditor.draft || {};
    const value = draft[step.id];
    if (step.control === 'candidate_pin') {
      const options = Store.activeEditor.candidatePins.map(item => {
        const def = Store.pinDef(item.physical_pin);
        const occupied = Store.getPin(item.physical_pin) &&
          Number(draft.editingPin) !== Number(item.physical_pin);
        const verified = item.signal_verified && item.mux_value_verified;
        return `<option value="${item.physical_pin}" ${
          Number(value) === Number(item.physical_pin) ? 'selected' : ''
        } ${occupied || !verified ? 'disabled' : ''}>Pin${item.physical_pin} / ${
          esc(def?.primary_signal)} / MUX${item.mux}${
          occupied ? '（已占用）' : (!verified ? '（证据不完整）' : '')}</option>`;
      }).join('');
      return `<select data-field="${step.id}"><option value="">请选择</option>${options}</select>`;
    }
    if (step.control === 'choice') {
      return `<div class="wizard-choices">${step.choices.map(choice =>
        `<label><input type="radio" name="${esc(step.id)}" data-field="${esc(step.id)}"
          value="${esc(choice.value)}" ${String(value) === String(choice.value) ? 'checked' : ''}>
          ${esc(choice.label)}</label>`).join('')}</div>`;
    }
    if (step.control === 'number') {
      return `<input type="number" data-field="${step.id}" value="${esc(value)}"
        ${step.min != null ? `min="${step.min}"` : ''} ${step.max != null ? `max="${step.max}"` : ''}
        step="${step.step || 1}">`;
    }
    if (step.control === 'boolean') {
      return `<label><input type="checkbox" data-field="${step.id}" ${value ? 'checked' : ''}>
        ${value ? '已启用' : '未启用'}</label>`;
    }
    if (step.control === 'summary') return summaryHtml();
    return '';
  }

  function render() {
    if (!mountEl || Store.activeEditor.status !== 'editing') return;
    const steps = visibleSteps();
    const index = Math.min(Store.activeEditor.stepIndex, Math.max(0, steps.length - 1));
    if (index !== Store.activeEditor.stepIndex) Store.activeEditor.stepIndex = index;
    const step = steps[index];
    const spec = schema();
    mountEl.innerHTML = `
      <div class="inline-wizard">
        <div class="wizard-title">${esc(spec.title)} · ${esc(Store.activeEditor.functionId)}</div>
        <div class="wizard-progress">步骤 ${index + 1} / ${steps.length}</div>
        <h3>${esc(step.label)}</h3>
        <div class="wizard-control">${controlHtml(step)}</div>
        <div class="wizard-actions">
          <button type="button" data-action="back" class="btn" ${index === 0 ? 'disabled' : ''}>上一步</button>
          <button type="button" data-action="cancel" class="btn">取消</button>
          ${index === steps.length - 1
            ? '<button type="button" data-action="finish" class="btn btn-primary">完成</button>'
            : '<button type="button" data-action="next" class="btn btn-primary">下一步</button>'}
        </div>
      </div>`;
    wire(step, steps);
  }

  function wire(step, steps) {
    mountEl.querySelectorAll('[data-field]').forEach(control => {
      const eventName = control.type === 'radio' || control.type === 'checkbox'
        ? 'change' : 'input';
      control.addEventListener(eventName, () => {
        let value;
        if (control.type === 'checkbox') value = control.checked;
        else if (control.type === 'number') value = Number(control.value);
        else if (step.control === 'candidate_pin') value = control.value ? Number(control.value) : null;
        else value = control.value;
        Store.updateDraft({ [control.dataset.field]: value });
        if (step.control === 'boolean' || step.control === 'choice') render();
      });
    });
    mountEl.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      Store.setDraftStep(Math.max(0, Store.activeEditor.stepIndex - 1)); render();
    });
    mountEl.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      Store.setDraftStep(Math.min(steps.length - 1, Store.activeEditor.stepIndex + 1)); render();
    });
    mountEl.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      Store.discardDraft(); setStatus('已取消：committed ProjectConfig 未改变');
    });
    mountEl.querySelector('[data-action="finish"]')?.addEventListener('click', () => {
      const result = Store.commitDraft();
      if (!result.ok) {
        setStatus(`不能提交：${result.errors.join('；')}`, true); render(); return;
      }
      setStatus('配置已原子提交到 ProjectConfig');
    });
  }

  Bus.on('draft:changed', () => {
    if (mountEl && !mountEl.hidden) render();
  });
  window.Wizard = { mountInline, render };
})();
