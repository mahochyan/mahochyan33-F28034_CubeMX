/* R3.3 schema-v2 canonical ProjectConfig and atomic module transactions. */
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
  const MODULE_COLLECTIONS = {
    I2CA: 'i2c_modules',
    SPIA: 'spi_modules',
    SPIB: 'spi_modules',
    SCIA: 'sci_modules',
    LINA: 'lin_modules',
    CANA: 'can_modules',
    EQEP1: 'eqep_modules',
    ECAP1: 'ecap_modules',
    HRCAP1: 'hrcap_modules',
    HRCAP2: 'hrcap_modules',
    COMP1: 'comparators',
    COMP2: 'comparators',
    COMP3: 'comparators',
    EPWM1: 'pwm_modules',
    EPWM2: 'pwm_modules',
    EPWM3: 'pwm_modules',
    EPWM4: 'pwm_modules',
    EPWM5: 'pwm_modules',
    EPWM6: 'pwm_modules',
    EPWM7: 'pwm_modules',
  };

  const PROJECT_COLLECTIONS = [
    'pins',
    'pwm_modules',
    'pwm_sync_graph',
    'pwm_event_triggers',
    'comparators',
    'trip_routes',
    'i2c_modules',
    'spi_modules',
    'sci_modules',
    'lin_modules',
    'can_modules',
    'eqep_modules',
    'ecap_modules',
    'hrcap_modules',
    'xint_routes',
    'clock_routes',
    'low_power_wake',
    'timers',
    'interrupt_routes',
  ];

  function legacyElectricalProfile(pin) {
    if (pin.electrical_profile || pin.generator_profile) {
      return pin.electrical_profile || pin.generator_profile;
    }
    const fn = String(pin.function || '').toUpperCase();
    const exact = {
      SDAA: 'i2c_open_drain', SCLA: 'i2c_open_drain',
      SCITXDA: 'sci_tx', SCIRXDA: 'sci_rx',
      LINTXA: 'lin_tx', LINRXA: 'lin_rx',
      CANTXA: 'can_tx', CANRXA: 'can_rx',
      TZ1: 'trip_async_input', TZ2: 'trip_async_input',
      TZ3: 'trip_async_input',
    };
    if (exact[fn]) return exact[fn];
    if (/^GPIO\d+$/.test(fn)) {
      return pin.direction === 'input' ? 'gpio_input' : 'gpio_output';
    }
    if (/^EPWM[1-7][AB]$/.test(fn)) return 'epwm_output';
    return null;
  }

  function createEmptyProject(device = 'TMS320F28034', packageName = 'PNT80') {
    return {
      schema_version: 2,
      device,
      package: packageName,
      migration_history: [],
      system_clock: null,
      pins: {},
      pwm_modules: {},
      pwm_sync_graph: {},
      pwm_event_triggers: {},
      adc: {
        reference_mode: null,
        socs: {},
        interrupts: {},
      },
      comparators: {},
      trip_routes: {},
      i2c_modules: {},
      spi_modules: {},
      sci_modules: {},
      lin_modules: {},
      can_modules: {},
      eqep_modules: {},
      ecap_modules: {},
      hrcap_modules: {},
      xint_routes: {},
      clock_routes: {},
      low_power_wake: {},
      timers: {},
      interrupt_routes: {},
      protection: null,
    };
  }

  function migrateV1(source, device, packageName) {
    const project = createEmptyProject(
      source.device || device,
      source.package || packageName,
    );
    project.system_clock = clone(source.system_clock || null);
    project.pins = clone(source.pins || {});
    const unresolvedPins = [];
    Object.values(project.pins).forEach(pin => {
      pin.electrical_profile = legacyElectricalProfile(pin);
      if (!pin.electrical_profile) unresolvedPins.push(pin.physical_pin);
    });
    project.pwm_modules = clone(source.pwm_modules || {});
    project.timers = clone(source.timers || {});
    project.protection = clone(source.protection || null);

    if (source.adc) {
      const number = Number(source.adc.soc ?? 0);
      const key = `SOC${number}`;
      project.adc.reference_mode = source.adc.reference_mode || null;
      project.adc.socs[key] = {
        ...clone(source.adc),
        soc: number,
      };
      const interrupt = String(source.adc.interrupt || 'ADCINT1').toUpperCase();
      project.adc.interrupts[interrupt] = {
        enabled: true,
        eoc: key,
        continuous: false,
      };
    }

    Object.entries(source.comparator_inputs || {}).forEach(([functionName, route]) => {
      const match = /^COMP([1-3])[AB]$/i.exec(functionName);
      if (!match) return;
      const name = `COMP${match[1]}`;
      project.comparators[name] = {
        positive: {
          kind: 'external',
          function: functionName.toUpperCase(),
          physical_pin: Number(route.physical_pin),
        },
        negative: { kind: 'internal_dac', value: 512 },
        inversion: false,
        hysteresis: true,
        qualification: 'sync',
        internal_destinations: [],
        external_output_pin: null,
      };
    });

    Object.entries(source.aio || {}).forEach(([key, route]) => {
      const physicalPin = Number(route.physical_pin ?? key);
      project.pins[String(physicalPin)] = {
        ...clone(route),
        physical_pin: physicalPin,
        signal: route.function,
        type: 'aio',
        route_kind: 'aio',
        module: `AIO.${route.function}`,
        role: 'digital_io',
        electrical_profile: 'aio_digital',
      };
    });

    Object.entries(project.pwm_modules).forEach(([name, module]) => {
      const trip = module.trip;
      if (!trip?.enabled) {
        delete module.trip;
        module.trip_route_ids = [];
        return;
      }
      const routeId = `${name}_TRIP`;
      project.trip_routes[routeId] = {
        source_kind: 'external_tz',
        source: String(trip.source || 'TZ1').toUpperCase().replace(/N$/, ''),
        source_pin: Number(trip.pin),
        targets: [name],
        mode: trip.mode || 'one_shot',
        action_a: trip.action_a || 'force_low',
        action_b: trip.action_b || 'force_low',
      };
      module.trip_route_ids = [routeId];
      delete module.trip;
    });

    project.migration_history.push({
      from_schema: Number(source.schema_version || 1),
      to_schema: 2,
      migration: 'R3.2.x pin/ADC/comparator/PWM-trip to R3.3 module graph',
    });
    if (unresolvedPins.length) {
      project.unresolved = {
        reason: 'legacy pin entries require explicit R3.3 module review',
        physical_pins: unresolvedPins,
      };
    }
    return project;
  }

  function normalizeProject(value, device = 'TMS320F28034', packageName = 'PNT80') {
    const source = value && typeof value === 'object' ? value : {};
    if (Number(source.schema_version || 1) < 2) {
      return migrateV1(source, device, packageName);
    }
    const project = createEmptyProject(
      source.device || device,
      source.package || packageName,
    );
    project.migration_history = Array.isArray(source.migration_history)
      ? clone(source.migration_history) : [];
    project.system_clock = clone(source.system_clock || null);
    for (const name of PROJECT_COLLECTIONS) {
      project[name] = source[name] && typeof source[name] === 'object'
        ? clone(source[name]) : {};
    }
    const adc = source.adc && typeof source.adc === 'object' ? source.adc : {};
    project.adc = {
      reference_mode: adc.reference_mode ?? null,
      socs: adc.socs && typeof adc.socs === 'object' ? clone(adc.socs) : {},
      interrupts: adc.interrupts && typeof adc.interrupts === 'object'
        ? clone(adc.interrupts) : {},
    };
    project.protection = clone(source.protection || null);
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

  function exactAio(pinmux, physicalPin, functionName) {
    const route = pinDef(pinmux, physicalPin)?.aio_function;
    return route && String(route.function).toUpperCase() ===
      String(functionName).toUpperCase() ? route : null;
  }

  function optionErrors(option, label) {
    const errors = [];
    if (!option) return [`${label} 不存在于器件 MUX 数据库`];
    if (!option.signal_verified) errors.push(`${label} 的信号归属没有 golden 证据`);
    if (!option.mux_value_verified) errors.push(`${label} 的 MUX 数值没有 golden 证据`);
    if (!option.pin_config_supported) errors.push(`${label} 尚不支持生成引脚配置`);
    return errors;
  }

  function routeErrors(candidate, label) {
    const errors = [];
    if (!candidate) return [`${label} 不存在于 official golden 数据库`];
    if (!candidate.signal_verified) errors.push(`${label} 的信号归属没有 golden 证据`);
    if (!candidate.pin_config_supported) errors.push(`${label} 只读，不能写入 ProjectConfig`);
    if (candidate.read_only_special_role) errors.push(`${label} 是只读特殊角色`);
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
      route_kind: 'gpio_mux',
      signal_verified: !!option.signal_verified,
      mux_value_verified: !!option.mux_value_verified,
      pin_config_supported: !!option.pin_config_supported,
      peripheral_init_supported: extra.peripheral_init_supported ??
        !!option.peripheral_init_supported,
      electrical_profile: extra.electrical_profile ||
        option.electrical_profile || option.generator_profile || null,
      ...extra,
    };
  }

  function aioPinRecord(pinmux, candidate, functionName, extra = {}) {
    const physicalPin = Number(candidate.physical_pin);
    const def = pinDef(pinmux, physicalPin);
    const route = exactAio(pinmux, physicalPin, functionName);
    return {
      physical_pin: physicalPin,
      signal: def?.primary_signal || functionName,
      gpio_num: null,
      mux: null,
      function: String(functionName).toUpperCase(),
      type: 'aio',
      route_kind: 'aio',
      signal_verified: !!route?.signal_verified,
      mux_value_verified: true,
      pin_config_supported: !!route?.pin_config_supported,
      peripheral_init_supported: true,
      electrical_profile: 'aio_digital',
      ...extra,
    };
  }

  function moduleCollection(instance) {
    return MODULE_COLLECTIONS[String(instance || '').toUpperCase()] || null;
  }

  function removeModuleOwnership(project, instance) {
    const name = String(instance || '').toUpperCase();
    const collection = moduleCollection(name);
    Object.keys(project.pins).forEach(key => {
      const owner = String(project.pins[key]?.module || '').toUpperCase();
      if (owner === name || owner === `TRIP.${name}_TRIP`) delete project.pins[key];
    });
    if (collection) delete project[collection][name];
    Object.keys(project.trip_routes).forEach(id => {
      const route = project.trip_routes[id];
      route.targets = (route.targets || []).filter(target => target !== name);
      if (!route.targets.length) delete project.trip_routes[id];
    });
    delete project.pwm_sync_graph[name];
    delete project.pwm_event_triggers[name];
  }

  function removeEditedOwnership(project, editor) {
    const editingModule = editor?.draft?.editingModule;
    if (editingModule) {
      removeModuleOwnership(project, editingModule);
      return;
    }
    const editingPin = Number(editor?.draft?.editingPin);
    if (!Number.isInteger(editingPin)) return;
    const existing = project.pins[String(editingPin)];
    if (!existing) return;
    if (existing.module && moduleCollection(existing.module)) {
      removeModuleOwnership(project, existing.module);
    } else {
      delete project.pins[String(editingPin)];
    }
  }

  function findCandidate(index, functionName, physicalPin = null) {
    return (index[String(functionName).toUpperCase()] || []).find(candidate =>
      physicalPin == null ||
      Number(candidate.physical_pin) === Number(physicalPin)) || null;
  }

  function findFreeCandidate(index, functionName, project, excludedPins = []) {
    const excluded = new Set(excludedPins.map(Number));
    return (index[String(functionName).toUpperCase()] || []).find(candidate => {
      const pin = Number(candidate.physical_pin);
      return !excluded.has(pin) && !project.pins[String(pin)];
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

  function signalDescriptor(functionName, signalGroups) {
    const target = String(functionName || '').toUpperCase();
    for (const [groupName, group] of Object.entries(signalGroups?.groups || {})) {
      for (const [role, definition] of Object.entries(group.roles || {})) {
        if (String(definition.function).toUpperCase() === target) {
          return {
            groupName,
            instance: group.instance,
            role,
            definition,
            group,
          };
        }
      }
    }
    return null;
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

  function buildPwmPlan(nextProject, editor, candidate, pinmux, index, internalRoutes) {
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
        errors.push(...optionErrors(
          exactOption(pinmux, partner.physical_pin, partnerFn, partner.mux),
          `Pin${partner.physical_pin}/${partnerFn}`,
        ));
        if (channel === 'A') pinB = Number(partner.physical_pin);
        else pinA = Number(partner.physical_pin);
      }
    }

    const tripEnabled = draft.trip_enabled !== false;
    const tripSource = String(draft.trip_source || 'TZ1').toUpperCase().replace(/N$/, '');
    const tripDefinition = internalRoutes?.trip_sources?.[tripSource] || {
      kind: /^TZ[1-3]$/.test(tripSource) ? 'external_tz' : 'unknown',
      requires_physical_pin: /^TZ[1-3]$/.test(tripSource),
    };
    let tripCandidate = null;
    if (tripEnabled && tripDefinition.requires_physical_pin) {
      tripCandidate = findFreeCandidate(
        index, tripSource, nextProject, [pinA, pinB].filter(Number.isInteger),
      );
      if (!tripCandidate) {
        errors.push(`${tripSource} 没有空闲物理脚，事务未提交`);
      } else {
        errors.push(...optionErrors(
          exactOption(pinmux, tripCandidate.physical_pin, tripSource, tripCandidate.mux),
          `Pin${tripCandidate.physical_pin}/${tripSource}`,
        ));
      }
    } else if (tripEnabled && tripDefinition.kind === 'unknown') {
      errors.push(`${tripSource} 不在内部 Trip 路由数据库`);
    }
    if (errors.length) return { errors };

    nextProject.pins[String(selectedPin)] = pinRecord(
      pinmux, candidate, selectedFn,
      {
        module: moduleName,
        role: channel.toLowerCase(),
        derived: false,
        electrical_profile: 'epwm_output',
        peripheral_init_supported: true,
      },
    );
    if (partner) {
      const partnerFn = `${moduleName}${channel === 'A' ? 'B' : 'A'}`;
      nextProject.pins[String(partner.physical_pin)] = pinRecord(
        pinmux, partner, partnerFn,
        {
          module: moduleName,
          role: channel === 'A' ? 'b' : 'a',
          derived: true,
          electrical_profile: 'epwm_output',
          peripheral_init_supported: true,
        },
      );
    }

    const routeId = `${moduleName}_TRIP`;
    if (tripEnabled) {
      if (tripCandidate) {
        nextProject.pins[String(tripCandidate.physical_pin)] = pinRecord(
          pinmux, tripCandidate, tripSource,
          {
            module: `TRIP.${routeId}`,
            role: 'source',
            derived: true,
            electrical_profile: 'trip_async_input',
            peripheral_init_supported: true,
          },
        );
      }
      nextProject.trip_routes[routeId] = {
        source_kind: tripDefinition.kind,
        source: tripSource,
        source_pin: tripCandidate ? Number(tripCandidate.physical_pin) : null,
        targets: [moduleName],
        mode: draft.trip_mode || 'one_shot',
        action_a: 'force_low',
        action_b: 'force_low',
      };
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
      trip_route_ids: tripEnabled ? [routeId] : [],
    };
    return { errors: [] };
  }

  function requiredRoles(instance, draft) {
    switch (instance) {
      case 'I2CA':
        return ['sda', 'scl'];
      case 'SPIA':
      case 'SPIB': {
        const roles = ['clk'];
        const wire = draft.wire_mode || '4wire';
        const role = draft.role || 'master';
        const dataMode = draft.data_mode || 'full_duplex';
        if (wire === '3wire') roles.push(role === 'master' ? 'simo' : 'somi');
        else {
          if (['tx', 'full_duplex'].includes(dataMode)) roles.push('simo');
          if (['rx', 'full_duplex'].includes(dataMode)) roles.push('somi');
        }
        if (['hardware_ste', 'hardware_ste_pin'].includes(draft.ste_strategy)) {
          roles.push('ste');
        }
        return roles;
      }
      case 'SCIA': {
        const mode = draft.mode || 'full_duplex';
        if (mode === 'tx_only') return ['tx'];
        if (mode === 'rx_only') return ['rx'];
        return ['tx', 'rx'];
      }
      case 'LINA': {
        const direction = draft.direction || 'full_duplex';
        if (direction === 'tx_only') return ['tx'];
        if (direction === 'rx_only') return ['rx'];
        return ['tx', 'rx'];
      }
      case 'CANA': {
        const mode = draft.mode || 'normal';
        if (mode === 'self_test_loopback') return [];
        if (mode === 'listen_only' || mode === 'rx_test') return ['rx'];
        if (mode === 'tx_test') return ['tx'];
        return ['tx', 'rx'];
      }
      case 'EQEP1':
        return ['a', 'b'];
      case 'ECAP1':
        return ['io'];
      case 'HRCAP1':
      case 'HRCAP2':
        return ['input'];
      default:
        return [];
    }
  }

  function moduleSettings(instance, draft, signals) {
    if (instance === 'I2CA') return {
      role: draft.role || 'master',
      bus_hz: Number(draft.bus_hz || 100000),
      own_address: Number(draft.own_address ?? 0x20),
      target_address: Number(draft.target_address ?? 0x50),
      fifo: draft.fifo !== false,
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'SPIA' || instance === 'SPIB') return {
      role: draft.role || 'master',
      wire_mode: draft.wire_mode || '4wire',
      data_mode: draft.data_mode || 'full_duplex',
      ste_strategy: draft.ste_strategy || 'no_cs',
      cpol: Number(draft.cpol || 0),
      cpha: Number(draft.cpha || 0),
      word_length: Number(draft.word_length || 8),
      baud_hz: Number(draft.baud_hz || 1000000),
      lspclk_hz: Number(draft.lspclk_hz || 15000000),
      fifo: draft.fifo !== false,
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'SCIA') return {
      mode: draft.mode || 'full_duplex',
      baud: Number(draft.baud || 115200),
      data_bits: Number(draft.data_bits || 8),
      parity: draft.parity || 'none',
      stop_bits: Number(draft.stop_bits || 1),
      fifo: draft.fifo !== false,
      rx_interrupt: !!draft.rx_interrupt,
      tx_interrupt: !!draft.tx_interrupt,
      direction_control: draft.direction_control || null,
      signals,
    };
    if (instance === 'LINA') return {
      mode: draft.mode || 'lin',
      direction: draft.direction || 'full_duplex',
      baud: Number(draft.baud || 19200),
      checksum: draft.checksum || 'enhanced',
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'CANA') return {
      mode: draft.mode || 'normal',
      baud_hz: Number(draft.baud_hz || 500000),
      brp: Number(draft.brp || 5),
      sjw: Number(draft.sjw || 1),
      tseg1: Number(draft.tseg1 || 8),
      tseg2: Number(draft.tseg2 || 3),
      mailboxes: clone(draft.mailboxes || {}),
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'EQEP1') return {
      mode: draft.mode || 'quadrature',
      qualification: draft.qualification || 'sync',
      polarity: draft.polarity || 'normal',
      swap_ab: !!draft.swap_ab,
      position_max: Number(draft.position_max || 0xFFFFFFFF),
      index_action: draft.index_action || 'none',
      unit_timer_period: Number(draft.unit_timer_period || 0),
      capture_divider: Number(draft.capture_divider || 1),
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'ECAP1') return {
      mode: draft.mode || 'capture',
      edge_sequence: draft.edge_sequence || 'rising_falling',
      prescaler: Number(draft.prescaler || 1),
      capture_mode: draft.capture_mode || 'continuous',
      period: Number(draft.period || 1000),
      compare: Number(draft.compare || 500),
      shadow_update: draft.shadow_update !== false,
      interrupt: draft.interrupt || 'none',
      signals,
    };
    if (instance === 'HRCAP1' || instance === 'HRCAP2') return {
      mode: draft.mode || 'capture',
      clock_hz: Number(draft.clock_hz || 100000000),
      discard_first_capture: draft.discard_first_capture !== false,
      calibration: {
        mode: draft.calibration_mode || 'none',
        hrcap_instance: draft.calibration_instance || null,
        library: draft.hccal_library || null,
        period_ms: Number(draft.calibration_period_ms || 1000),
      },
      signals,
    };
    return { signals };
  }

  function buildPeripheralPlan(
    nextProject, editor, candidate, pinmux, index, signalGroups,
  ) {
    const descriptor = signalDescriptor(editor.functionId, signalGroups);
    if (!descriptor) return null;
    const { instance, role: selectedRole, group } = descriptor;
    if (!moduleCollection(instance) || instance.startsWith('EPWM')) return null;
    const draft = editor.draft;
    const required = requiredRoles(instance, draft);
    const pinlessMode = instance === 'CANA' &&
      (draft.mode || 'normal') === 'self_test_loopback';
    const roles = new Set(pinlessMode ? required : [selectedRole, ...required]);
    Object.keys(group.roles || {}).forEach(role => {
      if (draft[`pin_${role}`] != null || draft.role_pins?.[role] != null) roles.add(role);
    });
    const errors = [];
    const signals = {};
    const usedPins = [];

    for (const role of roles) {
      const roleDef = group.roles?.[role];
      if (!roleDef) continue;
      let physicalPin;
      if (role === selectedRole) {
        physicalPin = Number(candidate.physical_pin);
      } else {
        physicalPin = Number(draft[`pin_${role}`] ?? draft.role_pins?.[role]);
      }
      if (!Number.isInteger(physicalPin)) {
        if (required.includes(role)) {
          errors.push(`${instance} 缺少 ${roleDef.function} 物理脚`);
        }
        continue;
      }
      const route = findCandidate(index, roleDef.function, physicalPin);
      if (!route) {
        errors.push(`Pin${physicalPin} 不提供 ${roleDef.function}`);
        continue;
      }
      const option = exactOption(pinmux, physicalPin, roleDef.function, route.mux);
      errors.push(...optionErrors(option, `Pin${physicalPin}/${roleDef.function}`));
      const occupied = nextProject.pins[String(physicalPin)];
      if (occupied) errors.push(`Pin${physicalPin} 已被 ${occupied.function} 占用`);
      if (usedPins.includes(physicalPin)) errors.push(`Pin${physicalPin} 不能承担两个互斥数字角色`);
      usedPins.push(physicalPin);
      signals[role] = {
        physical_pin: physicalPin,
        function: roleDef.function,
        qualification: roleDef.electrical_profile === 'eqep_sync_input'
          ? (draft.qualification || 'sync') : undefined,
      };
    }
    if (errors.length) return { errors };

    const collection = moduleCollection(instance);
    const settings = moduleSettings(instance, draft, signals);
    nextProject[collection][instance] = settings;
    Object.entries(signals).forEach(([role, route]) => {
      const roleDef = group.roles[role];
      const candidateRoute = findCandidate(index, roleDef.function, route.physical_pin);
      nextProject.pins[String(route.physical_pin)] = pinRecord(
        pinmux,
        candidateRoute,
        roleDef.function,
        {
          module: instance,
          role,
          electrical_profile: roleDef.electrical_profile,
          peripheral_init_supported: true,
        },
      );
      if (route.qualification) {
        nextProject.pins[String(route.physical_pin)].qualification = route.qualification;
      }
    });
    return { errors: [] };
  }

  function buildGpioOrRoutePlan(nextProject, editor, candidate, pinmux) {
    const draft = editor.draft;
    const functionName = String(editor.functionId).toUpperCase();
    const selectedPin = Number(candidate.physical_pin);
    const option = exactOption(pinmux, selectedPin, functionName, candidate.mux);
    const errors = optionErrors(option, `Pin${selectedPin}/${functionName}`);
    if (nextProject.pins[String(selectedPin)]) errors.push(`Pin${selectedPin} 已被占用`);
    if (errors.length) return { errors };
    const extra = {
      electrical_profile: option.generator_profile ||
        (/^GPIO\d+$/.test(functionName)
          ? (draft.direction === 'input' ? 'gpio_input' : 'gpio_output')
          : null),
    };
    if (Number(option.mux) === 0) {
      extra.direction = draft.direction || 'output';
      extra.initial_level = draft.initial_level || 'low';
      extra.pullup = draft.pullup || 'disable';
      extra.qualification = draft.qualification || 'sync';
    }
    nextProject.pins[String(selectedPin)] = pinRecord(
      pinmux, candidate, functionName, extra,
    );
    return { errors: [] };
  }

  function buildAdcPlan(nextProject, editor, candidate) {
    const draft = editor.draft;
    const selectedPin = Number(candidate.physical_pin);
    const functionName = String(editor.functionId).toUpperCase();
    const errors = routeErrors(candidate, `Pin${selectedPin}/${functionName}`);
    const soc = Number(draft.soc ?? 0);
    const acqps = Number(draft.acqps ?? 14);
    if (!Number.isInteger(soc) || soc < 0 || soc > 15) errors.push('ADC SOC 必须在 0～15');
    if (!Number.isInteger(acqps) || acqps < 0 || acqps > 63) errors.push('ADC ACQPS 必须在 0～63');
    if (nextProject.pins[String(selectedPin)]?.type === 'aio') {
      errors.push(`Pin${selectedPin} 已启用数字 AIO，不能同时提交模拟 ADC 模式`);
    }
    if (errors.length) return { errors };
    const key = `SOC${soc}`;
    const interrupt = String(draft.interrupt || 'ADCINT1').toUpperCase();
    nextProject.adc.reference_mode = draft.reference_mode ||
      nextProject.adc.reference_mode || 'external';
    nextProject.adc.socs[key] = {
      soc,
      physical_pin: selectedPin,
      channel: functionName,
      trigger: String(draft.trigger || 'SOFTWARE').toUpperCase(),
      acqps,
      route_kind: 'analog',
      gpio_registers_forbidden: true,
    };
    if (interrupt !== 'NONE') {
      nextProject.adc.interrupts[interrupt] = {
        enabled: true,
        eoc: key,
        continuous: !!draft.interrupt_continuous,
      };
    }
    return { errors: [] };
  }

  function buildComparatorPlan(nextProject, editor, candidate) {
    const draft = editor.draft;
    const selectedPin = Number(candidate.physical_pin);
    const functionName = String(editor.functionId).toUpperCase();
    const errors = routeErrors(candidate, `Pin${selectedPin}/${functionName}`);
    if (nextProject.pins[String(selectedPin)]?.type === 'aio') {
      errors.push(`Pin${selectedPin} 已启用数字 AIO，不能同时提交比较器模拟输入`);
    }
    const match = /^COMP([1-3])[AB]$/.exec(functionName);
    if (!match) errors.push(`${functionName} 不是 COMP1～COMP3 模拟输入`);
    if (errors.length) return { errors };
    const instance = `COMP${match[1]}`;
    const inputSide = draft.input_side || 'positive';
    const otherSide = inputSide === 'positive' ? 'negative' : 'positive';
    const previous = nextProject.comparators[instance] || {};
    nextProject.comparators[instance] = {
      ...previous,
      [inputSide]: {
        kind: 'external',
        function: functionName,
        physical_pin: selectedPin,
      },
      [otherSide]: previous[otherSide] || {
        kind: 'internal_dac',
        value: Number(draft.dac_value ?? 512),
      },
      inversion: !!draft.inversion,
      hysteresis: draft.hysteresis !== false,
      qualification: draft.qualification || 'sync',
      internal_destinations: clone(draft.internal_destinations || []),
      external_output_pin: draft.external_output_pin || null,
    };
    return { errors: [] };
  }

  function buildAioPlan(nextProject, editor, candidate, pinmux) {
    const draft = editor.draft;
    const selectedPin = Number(candidate.physical_pin);
    const functionName = String(editor.functionId).toUpperCase();
    const errors = routeErrors(candidate, `Pin${selectedPin}/${functionName}`);
    if (Object.values(nextProject.adc.socs)
      .some(soc => Number(soc.physical_pin) === selectedPin)) {
      errors.push(`Pin${selectedPin} 已用于 ADC 模拟采样`);
    }
    if (Object.values(nextProject.comparators).some(module =>
      ['positive', 'negative'].some(side =>
        module?.[side]?.kind === 'external' &&
        Number(module[side].physical_pin) === selectedPin))) {
      errors.push(`Pin${selectedPin} 已用于 Comparator 模拟输入`);
    }
    if (nextProject.pins[String(selectedPin)]) errors.push(`Pin${selectedPin} 已被占用`);
    if (errors.length) return { errors };
    nextProject.pins[String(selectedPin)] = aioPinRecord(
      pinmux, candidate, functionName,
      {
        module: `AIO.${functionName}`,
        role: 'digital_io',
        direction: draft.direction || 'output',
        initial_level: draft.initial_level || 'low',
        aiomux_value: 0,
        gpio_registers_forbidden: true,
      },
    );
    return { errors: [] };
  }

  function buildCommitPlan({
    project,
    editor,
    pinmux,
    reverseIndex,
    signalGroups,
    internalRoutes,
  }) {
    const errors = validateDraftShape(editor);
    const currentProject = normalizeProject(project);
    const nextProject = clone(currentProject);
    const before = JSONCore.stringify(currentProject);
    if (errors.length) return { ok: false, errors, before, nextProject: null };

    removeEditedOwnership(nextProject, editor);
    const candidate = candidateForEditor(editor);
    const index = normalizeIndex(reverseIndex);
    const match = PWM_RE.exec(String(editor.functionId || ''));
    let result;
    if (match) {
      result = buildPwmPlan(
        nextProject, editor, candidate, pinmux, index, internalRoutes,
      );
    } else if (candidate.type === 'adc_input') {
      result = buildAdcPlan(nextProject, editor, candidate);
    } else if (candidate.type === 'comparator_input') {
      result = buildComparatorPlan(nextProject, editor, candidate);
    } else if (candidate.type === 'aio') {
      result = buildAioPlan(nextProject, editor, candidate, pinmux);
    } else {
      result = buildPeripheralPlan(
        nextProject, editor, candidate, pinmux, index, signalGroups,
      ) || buildGpioOrRoutePlan(nextProject, editor, candidate, pinmux);
    }
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
    if (pin.module && moduleCollection(pin.module)) {
      removeModuleOwnership(next, pin.module);
    } else {
      delete next.pins[String(Number(physicalPin))];
    }
    return next;
  }

  function removeModuleAtomically(project, instance) {
    const next = normalizeProject(project);
    removeModuleOwnership(next, instance);
    return next;
  }

  return {
    createEmptyProject,
    normalizeProject,
    exactOption,
    signalDescriptor,
    buildCommitPlan,
    validateCommitPlan,
    applyAtomically,
    removePinAtomically,
    removeModuleAtomically,
  };
});
