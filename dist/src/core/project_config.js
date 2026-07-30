/* R3.2 ProjectConfig: pure, atomic draft-to-commit transactions. */
(function (root, factory) {
  const json = root.DeterministicJSON ||
    (typeof require === 'function' ? require('./deterministic_json.js') : null);
  const api = factory(json);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ProjectConfigCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JSONCore) {
  'use strict';

  const clone = value => JSONCore.clone(value);
  const PWM_RE = /^EPWM([1-7])([AB])$/i;

  function createEmptyProject(device = 'TMS320F28034', packageName = 'PNT80') {
    return {
      schema_version: 1,
      device,
      package: packageName,
      system_clock: null,
      pins: {},
      pwm_modules: {},
      adc: null,
      timers: {},
      protection: null,
    };
  }

  function normalizeProject(value, device = 'TMS320F28034', packageName = 'PNT80') {
    const source = value && typeof value === 'object' ? value : {};
    const project = createEmptyProject(
      source.device || device,
      source.package || packageName,
    );
    project.system_clock = source.system_clock || null;
    project.pins = source.pins && typeof source.pins === 'object' ? clone(source.pins) : {};
    project.pwm_modules = source.pwm_modules && typeof source.pwm_modules === 'object'
      ? clone(source.pwm_modules) : {};
    project.adc = source.adc || null;
    project.timers = source.timers && typeof source.timers === 'object'
      ? clone(source.timers) : {};
    project.protection = source.protection || null;
    return project;
  }

  function normalizeIndex(reverseIndex) {
    const index = {};
    Object.entries(reverseIndex || {}).forEach(([name, entries]) => {
      index[name.toUpperCase()] = (entries || []).map(clone);
    });
    return index;
  }

  function pinDef(pinmux, physicalPin) {
    return pinmux?.pins?.[String(Number(physicalPin))] || null;
  }

  function exactOption(pinmux, physicalPin, functionName, muxValue) {
    const def = pinDef(pinmux, physicalPin);
    if (!def) return null;
    return (def.mux_options || []).find(option =>
      String(option.function).toUpperCase() === String(functionName).toUpperCase() &&
      (muxValue == null || Number(option.mux) === Number(muxValue))) || null;
  }

  function optionErrors(option, label) {
    const errors = [];
    if (!option) return [`${label} 不存在于器件 MUX 数据库`];
    if (!option.signal_verified) errors.push(`${label} 的信号归属没有 golden 证据`);
    if (!option.mux_value_verified) errors.push(`${label} 的 MUX 数值没有 golden 证据`);
    if (!option.pin_config_supported) errors.push(`${label} 尚不支持生成引脚配置`);
    return errors;
  }

  function pinRecord(pinmux, candidate, functionName, extra = {}) {
    const physicalPin = Number(candidate.physical_pin);
    const def = pinDef(pinmux, physicalPin);
    const option = exactOption(pinmux, physicalPin, functionName, candidate.mux);
    return {
      physical_pin: physicalPin,
      signal: def.primary_signal,
      gpio_num: def.gpio_num,
      mux: Number(option.mux),
      function: String(option.function).toUpperCase(),
      type: option.type,
      signal_verified: !!option.signal_verified,
      mux_value_verified: !!option.mux_value_verified,
      pin_config_supported: !!option.pin_config_supported,
      peripheral_init_supported: !!option.peripheral_init_supported,
      generator_profile: option.generator_profile || null,
      ...extra,
    };
  }

  function removeEditedOwnership(project, editor) {
    const editingPin = Number(editor?.draft?.editingPin);
    if (!Number.isInteger(editingPin)) return;
    const existing = project.pins[String(editingPin)];
    if (!existing) return;
    if (existing.module && project.pwm_modules[existing.module]) {
      Object.keys(project.pins).forEach(key => {
        if (project.pins[key]?.module === existing.module) delete project.pins[key];
      });
      delete project.pwm_modules[existing.module];
    } else {
      delete project.pins[String(editingPin)];
    }
  }

  function findFreeCandidate(index, functionName, project, excludedPins = []) {
    const excluded = new Set(excludedPins.map(Number));
    return (index[String(functionName).toUpperCase()] || []).find(candidate => {
      const p = Number(candidate.physical_pin);
      return !excluded.has(p) && !project.pins[String(p)];
    }) || null;
  }

  function candidateForEditor(editor) {
    const selectedPin = Number(editor?.draft?.selectedPin ?? editor?.selectedPin);
    return (editor?.candidatePins || []).find(candidate =>
      Number(candidate.physical_pin) === selectedPin) || null;
  }

  function validateDraftShape(editor) {
    const errors = [];
    if (editor?.status !== 'editing' || !editor?.draft) {
      errors.push('没有活动草稿');
      return errors;
    }
    const selectedPin = Number(editor.draft.selectedPin ?? editor.selectedPin);
    if (!Number.isInteger(selectedPin)) errors.push('请选择物理脚');
    if (!candidateForEditor(editor)) errors.push('所选物理脚不提供该功能');
    return errors;
  }

  function pwmSettingsErrors(draft, channel) {
    const errors = [];
    const mode = draft.mode || 'single';
    if (channel === 'B' && mode !== 'complementary') {
      errors.push('B 通道不能单独配置；请从 A 通道开始或选择 A/B 互补');
    }
    if (!(Number(draft.frequency_hz) > 0)) errors.push('PWM 频率必须大于 0');
    if (!(Number(draft.duty) > 0 && Number(draft.duty) < 1)) {
      errors.push('占空比必须在 0 和 1 之间');
    }
    if (mode === 'complementary' &&
        (!(Number(draft.red_ns) > 0) || !(Number(draft.fed_ns) > 0))) {
      errors.push('互补 PWM 必须设置非零 RED/FED 死区');
    }
    return errors;
  }

  function buildPwmPlan(nextProject, editor, candidate, pinmux, index) {
    const draft = editor.draft;
    const match = PWM_RE.exec(String(editor.functionId || ''));
    const channel = match[2].toUpperCase();
    const moduleName = `EPWM${match[1]}`;
    const mode = draft.mode || 'single';
    const errors = pwmSettingsErrors(draft, channel);
    const selectedPin = Number(candidate.physical_pin);
    const selectedFn = `${moduleName}${channel}`;
    const selectedOption = exactOption(pinmux, selectedPin, selectedFn, candidate.mux);
    errors.push(...optionErrors(selectedOption, `Pin${selectedPin}/${selectedFn}`));
    if (nextProject.pins[String(selectedPin)]) errors.push(`Pin${selectedPin} 已被占用`);

    let pinA = channel === 'A' ? selectedPin : null;
    let pinB = channel === 'B' ? selectedPin : null;
    let partner = null;
    if (mode === 'complementary') {
      const partnerFn = `${moduleName}${channel === 'A' ? 'B' : 'A'}`;
      partner = findFreeCandidate(index, partnerFn, nextProject, [selectedPin]);
      if (!partner) {
        errors.push(`${partnerFn} 没有空闲物理脚，事务未提交`);
      } else {
        const partnerOption = exactOption(
          pinmux, partner.physical_pin, partnerFn, partner.mux,
        );
        errors.push(...optionErrors(
          partnerOption, `Pin${partner.physical_pin}/${partnerFn}`,
        ));
        if (channel === 'A') pinB = Number(partner.physical_pin);
        else pinA = Number(partner.physical_pin);
      }
    }

    const tripEnabled = draft.trip_enabled !== false;
    const tripSource = String(draft.trip_source || 'TZ1').toUpperCase().replace(/N$/, '');
    const tripFn = `${tripSource}N`;
    let tripCandidate = null;
    if (tripEnabled) {
      tripCandidate = findFreeCandidate(
        index, tripFn, nextProject, [pinA, pinB].filter(Number.isInteger),
      );
      if (!tripCandidate) {
        errors.push(`${tripSource} 没有空闲物理脚，事务未提交`);
      } else {
        const tripOption = exactOption(
          pinmux, tripCandidate.physical_pin, tripFn, tripCandidate.mux,
        );
        errors.push(...optionErrors(
          tripOption, `Pin${tripCandidate.physical_pin}/${tripFn}`,
        ));
      }
    }
    if (errors.length) return { errors };

    nextProject.pins[String(selectedPin)] = pinRecord(
      pinmux, candidate, selectedFn,
      { module: moduleName, role: channel.toLowerCase(), derived: false },
    );
    if (partner) {
      const partnerFn = `${moduleName}${channel === 'A' ? 'B' : 'A'}`;
      nextProject.pins[String(partner.physical_pin)] = pinRecord(
        pinmux, partner, partnerFn,
        {
          module: moduleName,
          role: channel === 'A' ? 'b' : 'a',
          derived: true,
        },
      );
    }
    if (tripCandidate) {
      nextProject.pins[String(tripCandidate.physical_pin)] = pinRecord(
        pinmux, tripCandidate, tripFn,
        { module: moduleName, role: 'trip', derived: true },
      );
    }

    nextProject.pwm_modules[moduleName] = {
      mode,
      pin_a: pinA,
      pin_b: pinB,
      source_channel: channel,
      derived_channel: mode === 'complementary'
        ? (channel === 'A' ? 'B' : 'A') : null,
      count_mode: draft.count_mode || 'up_down',
      frequency_hz: Number(draft.frequency_hz || 100000),
      duty: Number(draft.duty ?? 0.5),
      aq_profile: draft.aq_profile || 'set_cau_clear_cad',
      deadband: mode === 'complementary' ? {
        enabled: true,
        red_ns: Number(draft.red_ns),
        fed_ns: Number(draft.fed_ns),
        polarity: 'active_high_complementary',
      } : { enabled: false },
      trip: tripEnabled ? {
        enabled: true,
        source: tripSource,
        function: tripFn,
        pin: Number(tripCandidate.physical_pin),
        gpio_num: pinDef(pinmux, tripCandidate.physical_pin).gpio_num,
        mode: draft.trip_mode || 'one_shot',
        action_a: 'force_low',
        action_b: 'force_low',
      } : { enabled: false },
    };
    return { errors: [] };
  }

  function buildNonPwmPlan(nextProject, editor, candidate, pinmux) {
    const draft = editor.draft;
    const functionName = String(editor.functionId).toUpperCase();
    const selectedPin = Number(candidate.physical_pin);
    const option = exactOption(pinmux, selectedPin, functionName, candidate.mux);
    const errors = optionErrors(option, `Pin${selectedPin}/${functionName}`);
    if (nextProject.pins[String(selectedPin)]) errors.push(`Pin${selectedPin} 已被占用`);
    if (errors.length) return { errors };

    const extra = {};
    if (Number(option.mux) === 0) {
      extra.direction = draft.direction || 'output';
      extra.initial_level = draft.initial_level || 'low';
      extra.pullup = draft.pullup || 'disable';
      extra.qualification = draft.qualification || 'sync';
      extra.generator_profile = extra.direction === 'input' ? 'gpio_input' : 'gpio_output';
    }
    nextProject.pins[String(selectedPin)] = pinRecord(
      pinmux, candidate, functionName, extra,
    );
    return { errors: [] };
  }

  function buildCommitPlan({ project, editor, pinmux, reverseIndex }) {
    const errors = validateDraftShape(editor);
    const currentProject = normalizeProject(project);
    const nextProject = clone(currentProject);
    const before = JSONCore.stringify(currentProject);
    if (errors.length) return { ok: false, errors, before, nextProject: null };

    removeEditedOwnership(nextProject, editor);
    const candidate = candidateForEditor(editor);
    const index = normalizeIndex(reverseIndex);
    const match = PWM_RE.exec(String(editor.functionId || ''));
    const result = match
      ? buildPwmPlan(nextProject, editor, candidate, pinmux, index)
      : buildNonPwmPlan(nextProject, editor, candidate, pinmux);
    if (result.errors.length) {
      return { ok: false, errors: result.errors, before, nextProject: null };
    }
    return {
      ok: true,
      errors: [],
      before,
      nextProject,
      after: JSONCore.stringify(nextProject),
    };
  }

  function validateCommitPlan(currentProject, plan) {
    if (!plan?.ok || !plan.nextProject) {
      return { ok: false, errors: plan?.errors || ['无效提交计划'] };
    }
    if (JSONCore.stringify(normalizeProject(currentProject)) !== plan.before) {
      return { ok: false, errors: ['ProjectConfig 已变化，请重新打开向导'] };
    }
    return { ok: true, errors: [] };
  }

  function applyAtomically(currentProject, plan) {
    const checked = validateCommitPlan(currentProject, plan);
    if (!checked.ok) {
      const error = new Error(checked.errors.join('；'));
      error.errors = checked.errors;
      throw error;
    }
    return clone(plan.nextProject);
  }

  function removePinAtomically(project, physicalPin) {
    const next = normalizeProject(project);
    const pin = next.pins[String(Number(physicalPin))];
    if (!pin) return next;
    if (pin.module && next.pwm_modules[pin.module]) {
      Object.keys(next.pins).forEach(key => {
        if (next.pins[key]?.module === pin.module) delete next.pins[key];
      });
      delete next.pwm_modules[pin.module];
    } else {
      delete next.pins[String(Number(physicalPin))];
    }
    return next;
  }

  return {
    createEmptyProject,
    normalizeProject,
    exactOption,
    buildCommitPlan,
    validateCommitPlan,
    applyAtomically,
    removePinAtomically,
  };
});
