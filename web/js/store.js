/* R3 store: one committed ProjectConfig plus one isolated draft editor. */
(function () {
  const listeners = {};
  const LS_KEY = 'c2000.config.r3';
  const R2_KEY = 'c2000.config.r2';
  const clone = value => JSON.parse(JSON.stringify(value));

  const Bus = {
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    emit(event, payload) {
      (listeners[event] || []).forEach(fn => {
        try { fn(payload); } catch (err) { console.error(err); }
      });
    },
  };

  function emptyProject(device, packageName) {
    return {
      schema_version: 3,
      device: device || 'TMS320F28034',
      package: packageName || 'PNT80',
      system_clock: null,
      pins: {},
      pwm_modules: {},
      adc: null,
      timers: {},
      protection: null,
    };
  }

  const Store = {
    config: null,
    device: null,
    deviceInfo: null,
    pinmux: null,
    packageData: null,
    constraints: null,
    reverseIndex: null,
    wizards: null,
    selectedPin: null,
    activeFunction: null,
    project: emptyProject(),
    activeEditor: {
      source: null, functionId: null, candidatePins: [], selectedPin: null,
      draft: null, stepIndex: 0, status: 'idle',
    },

    setConfig(value) { this.config = value; Bus.emit('config', value); },
    setDevice(name, info) {
      this.device = name;
      this.deviceInfo = info;
      if (!this.project || this.project.device !== name) {
        this.project = emptyProject(name, info?.default_package || 'PNT80');
      }
      Bus.emit('device', info);
    },
    setPinmux(value) { this.pinmux = value; Bus.emit('pinmux', value); },
    setPackage(value) { this.packageData = value; Bus.emit('package', value); },
    setConstraints(value) { this.constraints = value; },
    setIndex(value) { this.reverseIndex = value; Bus.emit('index', value); },
    setWizards(value) { this.wizards = value; },

    pinDef(pin) { return this.pinmux?.pins?.[String(pin)] || null; },
    getPin(pin) { return this.project.pins[String(pin)] || null; },
    pinsForFunction(name) { return this.reverseIndex?.[name] || []; },

    selectPin(pin) {
      this.selectedPin = pin;
      Bus.emit('pin:selected', pin);
    },
    setActiveFunction(name) {
      this.activeFunction = name;
      Bus.emit('function:active', name);
    },

    beginDraft({ source, functionId, selectedPin = null, existing = null }) {
      if (this.activeEditor.status === 'editing') {
        Bus.emit('draft:replace-request', {
          current: clone(this.activeEditor),
          next: { source, functionId, selectedPin, existing },
        });
        return false;
      }
      const candidates = this.pinsForFunction(functionId);
      this.activeEditor = {
        source, functionId, candidatePins: clone(candidates),
        selectedPin, draft: existing ? clone(existing) : {
          function: functionId, selectedPin,
        },
        stepIndex: 0, status: 'editing',
      };
      this.setActiveFunction(functionId);
      Bus.emit('editor:changed', clone(this.activeEditor));
      return true;
    },
    forceBeginDraft(args) {
      this.discardDraft();
      return this.beginDraft(args);
    },
    updateDraft(patch) {
      if (this.activeEditor.status !== 'editing') return;
      Object.assign(this.activeEditor.draft, patch || {});
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'selectedPin')) {
        this.activeEditor.selectedPin = Number(patch.selectedPin);
      }
      Bus.emit('draft:changed', clone(this.activeEditor));
    },
    setDraftStep(index) {
      this.activeEditor.stepIndex = Math.max(0, Number(index) || 0);
      Bus.emit('draft:changed', clone(this.activeEditor));
    },
    validateDraft() {
      const e = this.activeEditor;
      const errors = [];
      if (e.status !== 'editing' || !e.draft) errors.push('没有活动草稿');
      const pin = Number(e.draft?.selectedPin ?? e.selectedPin);
      if (!Number.isInteger(pin)) errors.push('请选择物理脚');
      const candidate = e.candidatePins.find(item => Number(item.physical_pin) === pin);
      if (!candidate) errors.push('所选物理脚不提供该功能');
      if (this.getPin(pin) && !e.draft?.editingPin) errors.push(`Pin${pin} 已被占用`);
      if (/^EPWM\d+[AB]$/i.test(e.functionId || '') &&
          e.draft?.mode === 'complementary') {
        if (!(Number(e.draft.frequency_hz) > 0)) errors.push('PWM 频率必须大于 0');
        if (!(Number(e.draft.duty) > 0 && Number(e.draft.duty) < 1)) {
          errors.push('占空比必须在 0 和 1 之间');
        }
        if (!(Number(e.draft.red_ns) > 0 && Number(e.draft.fed_ns) > 0)) {
          errors.push('互补 PWM 必须设置非零死区');
        }
      }
      if (/^EPWM\d+B$/i.test(e.functionId || '') &&
          e.draft?.mode !== 'complementary') {
        errors.push('R3 当前禁止 B-only 单路模式；请选择 A/B 互补或从 A 通道开始');
      }
      return { ok: errors.length === 0, errors, candidate };
    },
    commitDraft() {
      const checked = this.validateDraft();
      if (!checked.ok) return checked;
      const e = this.activeEditor;
      const d = clone(e.draft);
      const pin = Number(d.selectedPin ?? e.selectedPin);
      const def = this.pinDef(pin);
      const candidate = checked.candidate;
      const option = (def.mux_options || []).find(item =>
        Number(item.mux) === Number(candidate.mux) &&
        String(item.function).toUpperCase() === String(e.functionId).toUpperCase());
      const fn = e.functionId;
      const basePin = {
        physical_pin: pin,
        signal: def.primary_signal,
        gpio_num: def.gpio_num,
        mux: Number(candidate.mux),
        function: fn,
        type: candidate.type,
        electrical_profile: option?.generator_profile || null,
      };

      if (/^EPWM\d+[AB]$/i.test(fn)) {
        const match = /^(EPWM\d+)([AB])$/i.exec(fn);
        const moduleName = match[1].toUpperCase();
        const channel = match[2].toUpperCase();
        const partnerFn = moduleName + (channel === 'A' ? 'B' : 'A');
        const partnerCandidate = this.pinsForFunction(partnerFn)[0] || null;
        const mode = d.mode || 'single';
        let pinA = channel === 'A' ? pin : null;
        let pinB = channel === 'B' ? pin : null;
        if (mode === 'complementary') {
          if (!partnerCandidate) return { ok: false, errors: [`找不到 ${partnerFn} 物理脚`] };
          if (channel === 'A') pinB = Number(partnerCandidate.physical_pin);
          else pinA = Number(partnerCandidate.physical_pin);
        }
        const sourcePin = pinA ?? pinB;
        if (pinA != null) this.project.pins[String(pinA)] = this._epwmPin(pinA, `${moduleName}A`, moduleName, false);
        if (pinB != null) this.project.pins[String(pinB)] = this._epwmPin(pinB, `${moduleName}B`, moduleName, mode === 'complementary');
        this.project.pwm_modules[moduleName] = {
          mode,
          pin_a: pinA,
          pin_b: pinB,
          source_channel: pinA != null ? 'A' : 'B',
          derived_channel: mode === 'complementary' ? 'B' : null,
          count_mode: d.count_mode || 'up_down',
          frequency_hz: Number(d.frequency_hz || 100000),
          duty: Number(d.duty || 0.5),
          aq_profile: d.aq_profile || 'set_cau_clear_cad',
          deadband: mode === 'complementary' ? {
            enabled: true,
            red_ns: Number(d.red_ns || 200),
            fed_ns: Number(d.fed_ns || 200),
            polarity: 'active_high_complementary',
          } : { enabled: false },
          trip: {
            enabled: d.trip_enabled !== false,
            source: d.trip_source || 'TZ1',
            mode: d.trip_mode || 'one_shot',
            action_a: 'force_low',
            action_b: 'force_low',
          },
          source_pin: sourcePin,
        };
        if (d.trip_enabled !== false) {
          const tripBase = String(d.trip_source || 'TZ1').toUpperCase().replace(/N$/, '');
          const tripFn = Object.keys(this.reverseIndex || {}).find(name =>
            name.toUpperCase().replace(/N$/, '') === tripBase);
          const tripCandidate = tripFn && this.pinsForFunction(tripFn).find(item =>
            !this.project.pins[String(item.physical_pin)]);
          if (tripCandidate) {
            const tripPin = Number(tripCandidate.physical_pin);
            const tripDef = this.pinDef(tripPin);
            this.project.pins[String(tripPin)] = {
              physical_pin: tripPin,
              signal: tripDef.primary_signal,
              gpio_num: tripDef.gpio_num,
              mux: Number(tripCandidate.mux),
              function: tripFn,
              type: 'tripzone',
              electrical_profile: 'trip_async_input',
              module: moduleName,
              role: 'trip',
            };
          }
        }
      } else {
        if (Number(candidate.mux) === 0) {
          Object.assign(basePin, {
            direction: d.direction || 'output',
            initial_level: d.initial_level || 'low',
            pullup: d.pullup || 'disable',
            qualification: d.qualification || 'sync',
            electrical_profile: (d.direction || 'output') === 'input'
              ? 'gpio_input' : 'gpio_output',
          });
        }
        this.project.pins[String(pin)] = basePin;
      }
      this.selectedPin = pin;
      this._save();
      this.activeEditor = {
        source: null, functionId: null, candidatePins: [], selectedPin: null,
        draft: null, stepIndex: 0, status: 'idle',
      };
      this.activeFunction = null;
      Bus.emit('project:committed', clone(this.project));
      Bus.emit('editor:changed', clone(this.activeEditor));
      return { ok: true };
    },
    _epwmPin(pin, fn, moduleName, derived) {
      const def = this.pinDef(pin);
      const option = (def.mux_options || []).find(item =>
        String(item.function).toUpperCase() === fn);
      return {
        physical_pin: pin, signal: def.primary_signal, gpio_num: def.gpio_num,
        mux: Number(option.mux), function: fn, type: 'epwm',
        electrical_profile: 'epwm_output', module: moduleName, derived: !!derived,
      };
    },
    discardDraft() {
      this.activeEditor = {
        source: null, functionId: null, candidatePins: [], selectedPin: null,
        draft: null, stepIndex: 0, status: 'idle',
      };
      this.activeFunction = null;
      Bus.emit('editor:changed', clone(this.activeEditor));
      Bus.emit('function:active', null);
    },

    editPin(pin) {
      const cfg = this.getPin(pin);
      if (!cfg) return false;
      const module = cfg.module && this.project.pwm_modules[cfg.module];
      const existing = module ? {
        selectedPin: pin, editingPin: pin, function: cfg.function,
        mode: module.mode, frequency_hz: module.frequency_hz,
        count_mode: module.count_mode, duty: module.duty,
        aq_profile: module.aq_profile,
        red_ns: module.deadband?.red_ns, fed_ns: module.deadband?.fed_ns,
        trip_enabled: module.trip?.enabled, trip_source: module.trip?.source,
        trip_mode: module.trip?.mode,
      } : { ...cfg, selectedPin: pin, editingPin: pin };
      return this.beginDraft({
        source: 'assigned', functionId: cfg.function,
        selectedPin: pin, existing,
      });
    },
    removePin(pin) {
      const cfg = this.getPin(pin);
      if (!cfg) return;
      if (cfg.module && this.project.pwm_modules[cfg.module]) {
        Object.keys(this.project.pins).forEach(key => {
          if (this.project.pins[key].module === cfg.module) delete this.project.pins[key];
        });
        delete this.project.pwm_modules[cfg.module];
      } else {
        delete this.project.pins[String(pin)];
      }
      this._save();
      Bus.emit('project:committed', clone(this.project));
    },
    clearProject() {
      this.project = emptyProject(this.device, this.deviceInfo?.default_package || 'PNT80');
      this.discardDraft();
      this._save();
      Bus.emit('project:committed', clone(this.project));
    },
    assignedList() {
      return Object.values(this.project.pins).sort(
        (a, b) => a.physical_pin - b.physical_pin);
    },
    pinState(pin) {
      const def = this.pinDef(pin);
      if (!def?.configurable) return 'fixed';
      if (this.project.pins[String(pin)]) return 'sel';
      if (this.activeFunction && this.pinsForFunction(this.activeFunction)
        .some(item => Number(item.physical_pin) === Number(pin))) return 'avail';
      return 'default';
    },
    exportConfig() { return clone(this.project); },
    _save() {
      localStorage.setItem(LS_KEY, JSON.stringify(this.project));
    },
    restore() {
      try {
        const current = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (current?.schema_version === 3) {
          this.project = current;
          return true;
        }
        const old = JSON.parse(localStorage.getItem(R2_KEY) || 'null');
        if (old?.pins) {
          const migrated = emptyProject(old.device || this.device);
          Object.values(old.pins).forEach(pin => {
            const p = Number(pin.physical_pin);
            migrated.pins[String(p)] = {
              physical_pin: p, signal: pin.signal, gpio_num: pin.gpio_num,
              mux: pin.mux, function: pin.function, type: pin.mode,
              direction: pin.direction, initial_level: pin.initial_level,
              pullup: pin.pullup, qualification: pin.qualification,
            };
          });
          this.project = migrated;
          this._save();
          return true;
        }
      } catch (err) { console.warn('ProjectConfig restore failed', err); }
      return false;
    },
    exportJSON() { return JSON.stringify(this.project, null, 2); },
    importJSON(text) {
      const value = JSON.parse(text);
      if (value?.schema_version !== 3 || typeof value.pins !== 'object') {
        throw new Error('只接受 schema_version=3 的 ProjectConfig');
      }
      this.project = value;
      this._save();
      Bus.emit('project:committed', clone(this.project));
    },
  };

  async function api(path, options) {
    const init = options ? {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    } : undefined;
    let response;
    try { response = await fetch(path, init); }
    catch (err) {
      const wrapped = new Error(`network error: ${err.message}`);
      wrapped.url = path; wrapped.status = 0; throw wrapped;
    }
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const err = new Error(payload?.error?.message || payload?.error ||
                            payload?.message || `${response.status} ${response.statusText}`);
      err.url = path; err.status = response.status; err.payload = payload;
      throw err;
    }
    return payload;
  }

  function status(message, isError) {
    const node = document.getElementById('statusText');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('status-err', !!isError);
  }

  window.Store = Store;
  window.Bus = Bus;
  window.api = api;
  window.setStatus = status;
})();
