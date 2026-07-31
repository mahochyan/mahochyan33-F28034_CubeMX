/* R3.3 schema-driven peripheral-instance staircase wizard. */
(function () {
  'use strict';

  let mountElement = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function profileName() {
    const entry = Store.activeEditor.candidatePins[0];
    const type = entry?.type || 'generic';
    const instance = Store.signalDescriptor(Store.activeEditor.functionId)?.instance;
    const profiles = {
      I2CA: 'i2c', SPIA: 'spi', SPIB: 'spi', SCIA: 'sci',
      LINA: 'lin', CANA: 'can', EQEP1: 'eqep', ECAP1: 'ecap',
      HRCAP1: 'hrcap', HRCAP2: 'hrcap',
    };
    if (profiles[instance]) return profiles[instance];
    if (type === 'gpio' || (entry?.mux != null && Number(entry.mux) === 0)) {
      return 'gpio';
    }
    if (type === 'adc_input') return 'adc';
    if (type === 'comparator_input') return 'comparator_input';
    if (type === 'aio') return 'aio';
    if (type === 'epwm') return 'epwm';
    if (type === 'i2c') return 'i2c';
    if (type === 'tripzone') return 'tripzone';
    return 'generic';
  }

  function profile() {
    return Store.wizards?.profiles?.[profileName()] ||
      Store.wizards?.profiles?.generic;
  }

  function visible(step, draft) {
    if (!step.visible_if) return true;
    return Object.entries(step.visible_if)
      .every(([key, expected]) => draft[key] === expected);
  }

  function steps() {
    const draft = Store.activeEditor.draft || {};
    return (profile()?.steps || []).filter(step => visible(step, draft));
  }

  function applyDefaults() {
    const patch = {};
    (profile()?.steps || []).forEach(step => {
      if (step.default !== undefined &&
          Store.activeEditor.draft?.[step.id] === undefined) {
        patch[step.id] = step.default;
      }
    });
    if (Store.activeEditor.selectedPin != null) {
      patch.selectedPin = Number(Store.activeEditor.selectedPin);
    }
    const instance = Store.signalDescriptor(Store.activeEditor.functionId)?.instance;
    if (profileName() === 'hrcap' &&
        Store.activeEditor.draft?.calibration_instance === undefined) {
      patch.calibration_instance = instance === 'HRCAP1' ? 'HRCAP2' : 'HRCAP1';
    }
    Store.updateDraft(patch);
  }

  function mountInline(element) {
    mountElement = element;
    element.hidden = false;
    applyDefaults();
    render();
  }

  function summaryHtml() {
    const editor = Store.activeEditor;
    const draft = editor.draft || {};
    const checked = Store.validateDraft();
    const descriptor = Store.signalDescriptor(editor.functionId);
    const derivedInstance = descriptor?.instance ||
      (profileName() === 'adc' ? 'ADC' :
        (profileName() === 'comparator_input'
          ? String(editor.functionId).slice(0, 5) : null));
    const rows = [
      ['功能', editor.functionId],
      ['外设实例', derivedInstance || '独立引脚'],
      ['物理脚', draft.selectedPin != null ? `Pin${draft.selectedPin}` : '未选择'],
      ['模式', draft.mode || draft.direction || profileName()],
    ];
    if (profileName() === 'epwm') {
      rows.push(
        ['频率', `${draft.frequency_hz} Hz`],
        ['计数', draft.count_mode],
        ['占空比', draft.duty],
        ['AQ', draft.aq_profile],
        ['死区', draft.mode === 'complementary'
          ? `${draft.red_ns}/${draft.fed_ns} ns` : '无'],
        ['Trip', draft.trip_enabled
          ? `${draft.trip_source} ${draft.trip_mode}` : '未启用硬件 Trip'],
      );
    }
    if (profileName() === 'i2c') {
      rows.push(
        ['生成范围', 'I2CA 模块对象 + SDA/SCL + i2c_init.c'],
        ['硬件提示', '板上必须有外部上拉电阻'],
      );
    }
    if (profileName() === 'tripzone') {
      rows.push(['电气属性', '异步输入，降低保护延迟']);
    }
    return `<dl class="draft-summary">${
      rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')
    }</dl>${checked.ok
      ? '<div class="draft-ok">完整提交计划可用</div>'
      : `<div class="draft-errors">${checked.errors.map(esc).join('<br>')}</div>`}`;
  }

  function controlHtml(step) {
    const draft = Store.activeEditor.draft || {};
    const value = draft[step.id];
    if (step.control === 'candidate_pin') {
      const options = Store.activeEditor.candidatePins.map(candidate => {
        const def = Store.pinDef(candidate.physical_pin);
        const configured = Store.getPin(candidate.physical_pin);
        const occupied = configured &&
          Number(draft.editingPin) !== Number(candidate.physical_pin) &&
          configured.module !== Store.getPin(draft.editingPin)?.module;
        const verified = candidate.signal_verified &&
          candidate.mux_value_verified && candidate.pin_config_supported;
        const routeLabel = candidate.mux == null
          ? candidate.route_kind : `MUX${candidate.mux}`;
        return `<option value="${candidate.physical_pin}"
          ${Number(value) === Number(candidate.physical_pin) ? 'selected' : ''}
          ${occupied || !verified ? 'disabled' : ''}>
          Pin${candidate.physical_pin} / ${esc(def?.primary_signal)} / ${esc(routeLabel)}${
          occupied ? '（已占用）' : (!verified ? '（证据或生成支持不完整）' : '')}
        </option>`;
      }).join('');
      return `<select data-field="${step.id}">
        <option value="">请选择</option>${options}
      </select>`;
    }
    if (step.control === 'signal_pin') {
      const descriptor = Store.signalDescriptor(Store.activeEditor.functionId);
      const roleDefinition = descriptor?.group?.roles?.[step.role];
      if (!roleDefinition) return '<div class="draft-errors">信号角色不存在于设备图</div>';
      if (descriptor.role === step.role) {
        return `<div class="draft-ok">当前入口脚：Pin${esc(
          Store.activeEditor.draft.selectedPin)} / ${esc(roleDefinition.function)}</div>`;
      }
      const options = Store.pinsForFunction(roleDefinition.function).map(candidate => {
        const configured = Store.getPin(candidate.physical_pin);
        const editingModule = Store.activeEditor.draft?.editingModule;
        const occupied = configured && configured.module !== editingModule;
        return `<option value="${candidate.physical_pin}"
          ${Number(value) === Number(candidate.physical_pin) ? 'selected' : ''}
          ${occupied ? 'disabled' : ''}>
          Pin${candidate.physical_pin} / ${esc(roleDefinition.function)}${
          occupied ? '（已占用）' : ''}
        </option>`;
      }).join('');
      return `<select data-field="${step.id}">
        <option value="">${step.optional ? '不使用这个可选信号' : '请选择配对物理脚'}</option>
        ${options}
      </select>`;
    }
    if (step.control === 'choice') {
      return `<div class="wizard-choices">${step.choices.map(choice => `
        <label><input type="radio" name="${esc(step.id)}" data-field="${esc(step.id)}"
          value="${esc(choice.value)}"
          ${String(value) === String(choice.value) ? 'checked' : ''}>
          ${esc(choice.label)}</label>`).join('')}</div>`;
    }
    if (step.control === 'number') {
      return `<input type="number" data-field="${step.id}" value="${esc(value)}"
        ${step.min != null ? `min="${step.min}"` : ''}
        ${step.max != null ? `max="${step.max}"` : ''}
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
    if (!mountElement || Store.activeEditor.status !== 'editing') return;
    const visibleSteps = steps();
    const index = Math.min(
      Store.activeEditor.stepIndex,
      Math.max(0, visibleSteps.length - 1),
    );
    Store.activeEditor.stepIndex = index;
    const step = visibleSteps[index];
    mountElement.hidden = false;
    mountElement.innerHTML = `
      <div class="inline-wizard">
        <div class="wizard-title">${esc(profile().title)} · ${esc(Store.activeEditor.functionId)}</div>
        <div class="wizard-progress">步骤 ${index + 1} / ${visibleSteps.length}</div>
        <h3>${esc(step.label)}</h3>
        <div class="wizard-control">${controlHtml(step)}</div>
        <div class="wizard-actions">
          <button type="button" data-action="back" class="btn"
            ${index === 0 ? 'disabled' : ''}>上一步</button>
          <button type="button" data-action="cancel" class="btn">取消</button>
          ${index === visibleSteps.length - 1
            ? '<button type="button" data-action="finish" class="btn btn-primary">原子提交</button>'
            : '<button type="button" data-action="next" class="btn btn-primary">下一步</button>'}
        </div>
      </div>`;
    wire(step, visibleSteps);
  }

  function wire(step, visibleSteps) {
    mountElement.querySelectorAll('[data-field]').forEach(control => {
      const eventName = ['radio', 'checkbox'].includes(control.type) ? 'change' : 'input';
      control.addEventListener(eventName, () => {
        let value;
        if (control.type === 'checkbox') value = control.checked;
        else if (control.type === 'number') value = Number(control.value);
        else if (['candidate_pin', 'signal_pin'].includes(step.control)) {
          value = control.value ? Number(control.value) : null;
        } else value = control.value;
        Store.updateDraft({ [control.dataset.field]: value });
        if (['boolean', 'choice'].includes(step.control)) render();
      });
    });
    mountElement.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      Store.setDraftStep(Math.max(0, Store.activeEditor.stepIndex - 1));
      render();
    });
    mountElement.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      Store.setDraftStep(Math.min(visibleSteps.length - 1, Store.activeEditor.stepIndex + 1));
      render();
    });
    mountElement.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      Store.discardDraft();
      setStatus('已取消：committed ProjectConfig 未改变');
    });
    mountElement.querySelector('[data-action="finish"]')?.addEventListener('click', () => {
      const result = Store.commitDraft();
      if (!result.ok) {
        setStatus(`不能提交：${result.errors.join('；')}`, true);
        render();
        return;
      }
      setStatus('配置已原子提交到 ProjectConfig');
    });
  }

  window.Wizard = { mountInline, render };
})();
