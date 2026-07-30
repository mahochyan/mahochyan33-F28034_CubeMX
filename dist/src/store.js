/* R3.2 browser store: one committed ProjectConfig and one isolated draft. */
(function () {
  'use strict';

  const listeners = {};
  const LS_KEY = 'c2000.config.r3.2';
  const LEGACY_KEYS = ['c2000.config.r3', 'c2000.config.r2'];
  const clone = value => DeterministicJSON.clone(value);

  const Bus = {
    on(event, listener) {
      (listeners[event] = listeners[event] || []).push(listener);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach(listener => {
        try { listener(payload); } catch (error) { console.error(error); }
      });
    },
  };

  function idleEditor() {
    return {
      source: null, functionId: null, candidatePins: [], selectedPin: null,
      draft: null, stepIndex: 0, status: 'idle',
    };
  }

  const Store = {
    config: null,
    device: 'TMS320F28034',
    deviceInfo: null,
    pinmux: null,
    packageData: null,
    constraints: null,
    family: null,
    reverseIndex: {},
    wizards: null,
    selectedPin: null,
    activeFunction: null,
    project: ProjectConfigCore.createEmptyProject(),
    activeEditor: idleEditor(),

    setConfig(value) { this.config = value; Bus.emit('config', value); },
    setDevice(name, info) {
      this.device = name;
      this.deviceInfo = info;
      Bus.emit('device', info);
    },
    setPinmux(value) { this.pinmux = value; Bus.emit('pinmux', value); },
    setPackage(value) { this.packageData = value; Bus.emit('package', value); },
    setConstraints(value) { this.constraints = value; },
    setFamily(value) { this.family = value; },
    setIndex(value) { this.reverseIndex = value || {}; Bus.emit('index', value); },
    setWizards(value) { this.wizards = value; },

    pinDef(pin) { return this.pinmux?.pins?.[String(Number(pin))] || null; },
    getPin(pin) { return this.project.pins[String(Number(pin))] || null; },
    pinsForFunction(name) {
      const target = String(name || '').toUpperCase();
      const key = Object.keys(this.reverseIndex || {})
        .find(entry => entry.toUpperCase() === target);
      return key ? this.reverseIndex[key] : [];
    },

    selectPin(pin) {
      this.selectedPin = Number(pin);
      Bus.emit('pin:selected', this.selectedPin);
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
        source,
        functionId,
        candidatePins: clone(candidates),
        selectedPin: selectedPin == null ? null : Number(selectedPin),
        draft: existing ? clone(existing) : {
          function: functionId,
          selectedPin: selectedPin == null ? null : Number(selectedPin),
        },
        stepIndex: 0,
        status: 'editing',
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
        this.activeEditor.selectedPin =
          patch.selectedPin == null ? null : Number(patch.selectedPin);
      }
      Bus.emit('draft:changed', clone(this.activeEditor));
    },
    setDraftStep(index) {
      this.activeEditor.stepIndex = Math.max(0, Number(index) || 0);
      Bus.emit('draft:changed', clone(this.activeEditor));
    },
    buildCommitPlan() {
      return ProjectConfigCore.buildCommitPlan({
        project: this.project,
        editor: this.activeEditor,
        pinmux: this.pinmux,
        reverseIndex: this.reverseIndex,
      });
    },
    validateDraft() {
      const plan = this.buildCommitPlan();
      return { ok: plan.ok, errors: plan.errors || [] };
    },
    commitDraft() {
      const plan = this.buildCommitPlan();
      if (!plan.ok) return { ok: false, errors: plan.errors };
      let nextProject;
      try {
        nextProject = ProjectConfigCore.applyAtomically(this.project, plan);
      } catch (error) {
        return { ok: false, errors: error.errors || [error.message] };
      }
      this.project = nextProject;
      this.selectedPin = Number(
        this.activeEditor.draft.selectedPin ?? this.activeEditor.selectedPin,
      );
      this._save();
      this.activeEditor = idleEditor();
      this.activeFunction = null;
      Bus.emit('project:committed', clone(this.project));
      Bus.emit('editor:changed', clone(this.activeEditor));
      Bus.emit('function:active', null);
      return { ok: true, project: clone(this.project) };
    },
    discardDraft() {
      this.activeEditor = idleEditor();
      this.activeFunction = null;
      Bus.emit('editor:changed', clone(this.activeEditor));
      Bus.emit('function:active', null);
    },

    editPin(pin) {
      const configured = this.getPin(pin);
      if (!configured) return false;
      const module = configured.module && this.project.pwm_modules[configured.module];
      const existing = module ? {
        selectedPin: Number(pin),
        editingPin: Number(pin),
        function: configured.function,
        mode: module.mode,
        frequency_hz: module.frequency_hz,
        count_mode: module.count_mode,
        duty: module.duty,
        aq_profile: module.aq_profile,
        red_ns: module.deadband?.red_ns,
        fed_ns: module.deadband?.fed_ns,
        trip_enabled: module.trip?.enabled,
        trip_source: module.trip?.source,
        trip_mode: module.trip?.mode,
      } : { ...configured, selectedPin: Number(pin), editingPin: Number(pin) };
      return this.beginDraft({
        source: 'assigned',
        functionId: configured.function,
        selectedPin: Number(pin),
        existing,
      });
    },
    removePin(pin) {
      this.project = ProjectConfigCore.removePinAtomically(this.project, Number(pin));
      this._save();
      Bus.emit('project:committed', clone(this.project));
    },
    clearProject() {
      this.project = ProjectConfigCore.createEmptyProject(
        this.device,
        this.deviceInfo?.default_package || 'PNT80',
      );
      this.discardDraft();
      this._save();
      Bus.emit('project:committed', clone(this.project));
    },
    assignedList() {
      return Object.values(this.project.pins || {})
        .sort((a, b) => Number(a.physical_pin) - Number(b.physical_pin));
    },
    pinState(pin) {
      const def = this.pinDef(pin);
      if (!def?.configurable) return 'fixed';
      if (this.project.pins[String(Number(pin))]) return 'sel';
      if (this.activeFunction && this.pinsForFunction(this.activeFunction)
        .some(item => Number(item.physical_pin) === Number(pin))) return 'avail';
      return 'default';
    },

    exportConfig() { return clone(this.project); },
    exportJSON() { return DeterministicJSON.stringify(this.project, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed.pins !== 'object') {
        throw new Error('文件不是有效的 ProjectConfig');
      }
      const migrated = ProjectConfigCore.normalizeProject(
        parsed,
        this.device,
        this.deviceInfo?.default_package || 'PNT80',
      );
      const validation = ConstraintChecker.validateProject(
        migrated, this.pinmux, this.family,
      );
      if (!validation.ok) {
        throw new Error(validation.blocking.map(item => item.message).join('；'));
      }
      this.project = migrated;
      this.discardDraft();
      this._save();
      Bus.emit('project:committed', clone(this.project));
      return clone(this.project);
    },
    _save() {
      localStorage.setItem(LS_KEY, DeterministicJSON.stringify(this.project, 0));
    },
    restore() {
      try {
        let source = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (!source) {
          for (const key of LEGACY_KEYS) {
            source = JSON.parse(localStorage.getItem(key) || 'null');
            if (source) break;
          }
        }
        if (!source?.pins) return false;
        this.project = ProjectConfigCore.normalizeProject(
          source,
          this.device,
          this.deviceInfo?.default_package || 'PNT80',
        );
        this._save();
        return true;
      } catch (error) {
        console.warn('ProjectConfig restore failed', error);
        return false;
      }
    },
  };

  function status(message, isError = false) {
    const node = document.getElementById('statusText');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('status-err', !!isError);
  }

  window.Store = Store;
  window.Bus = Bus;
  window.setStatus = status;
})();
