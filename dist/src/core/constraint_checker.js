/* R3.3 schema-v2 validation: package pins + peripheral graph + resources. */
(function (root, factory) {
  const peripheral = root.PeripheralConstraints ||
    (typeof require === 'function' ? require('./peripheral_constraints.js') : null);
  const api = factory(peripheral);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ConstraintChecker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PeripheralConstraints) {
  'use strict';

  const MAX_SYSCLK = 60000000;
  const TBPRD_MAX = 0xFFFF;
  const DB_MAX = 1023;

  function finding(severity, rule, message, extra = {}) {
    return { severity, rule, message, ...extra };
  }

  function configuredPins(project) {
    return Object.entries(project?.pins || {}).map(([key, value]) => ({
      physical_pin: Number(value?.physical_pin ?? key),
      ...(value || {}),
    }));
  }

  function routeForPin(pinmux, pin) {
    const def = pinmux?.pins?.[String(pin.physical_pin)];
    if (!def) return { def: null, route: null };
    if (pin.route_kind === 'aio') {
      const route = def.aio_function &&
        String(def.aio_function.function).toUpperCase() ===
          String(pin.function).toUpperCase() ? def.aio_function : null;
      return { def, route };
    }
    const route = (def.mux_options || []).find(item =>
      Number(item.mux) === Number(pin.mux) &&
      String(item.function).toUpperCase() ===
        String(pin.function).toUpperCase()) || null;
    return { def, route };
  }

  function validatePins(project, pinmux, findings) {
    const seen = new Map();
    for (const pin of configuredPins(project)) {
      const pnum = pin.physical_pin;
      if (seen.has(pnum)) {
        findings.push(finding(
          'ERROR', 'PIN_CONFLICT',
          `Pin${pnum} 同时被 ${seen.get(pnum)} 和 ${pin.function} 占用`,
          { pin: pnum, function: pin.function },
        ));
      }
      seen.set(pnum, pin.function);
      const { def, route } = routeForPin(pinmux, pin);
      if (!def) {
        findings.push(finding('ERROR', 'PIN_NOT_FOUND',
          `Pin${pnum} 不在 PNT80 器件数据库中`, { pin: pnum }));
        continue;
      }
      if (!def.configurable) {
        findings.push(finding('ERROR', 'FIXED_PIN',
          `Pin${pnum} ${def.primary_signal} 是固定功能脚，不能配置`, { pin: pnum }));
        continue;
      }
      if (!route) {
        findings.push(finding(
          'ERROR', 'PIN_ROUTE_MISMATCH',
          `Pin${pnum}/${pin.function} 不是官方数据库中的同一路由`,
          { pin: pnum, function: pin.function },
        ));
        continue;
      }
      if (!route.signal_verified || !route.pin_config_supported) {
        findings.push(finding(
          'ERROR', 'PIN_ROUTE_UNVERIFIED',
          `Pin${pnum}/${pin.function} 的证据或代码生成支持不完整`,
          { pin: pnum, function: pin.function },
        ));
      }
      if (pin.route_kind !== 'aio' && !route.mux_value_verified) {
        findings.push(finding(
          'ERROR', 'MUX_VALUE_UNVERIFIED',
          `Pin${pnum}/${pin.function} 的 MUX 数值没有 golden 证据`,
          { pin: pnum, function: pin.function },
        ));
      }
      if (!pin.electrical_profile) {
        findings.push(finding(
          'ERROR', 'ELECTRICAL_PROFILE_MISSING',
          `Pin${pnum}/${pin.function} 没有显式电气配置，生成器不得按名称猜测`,
          { pin: pnum, function: pin.function },
        ));
      }
    }
  }

  function systemClockHz(project, findings) {
    const clock = project?.system_clock;
    if (!clock || ['existing', 'keep_existing'].includes(clock.mode)) return MAX_SYSCLK;
    const hz = Number(clock.sysclk_hz ?? Number(clock.target_mhz) * 1000000);
    if (!Number.isFinite(hz) || hz <= 0 || hz > MAX_SYSCLK) {
      findings.push(finding(
        'ERROR', 'PLL_ILLEGAL',
        `系统时钟必须在 1..${MAX_SYSCLK}Hz，当前为 ${clock.sysclk_hz ?? clock.target_mhz}`,
      ));
      return MAX_SYSCLK;
    }
    return hz;
  }

  function validatePwm(project, sysclk, findings) {
    for (const [name, module] of Object.entries(project?.pwm_modules || {})) {
      if (!/^EPWM[1-7]$/.test(name)) {
        findings.push(finding('ERROR', 'PWM_MODULE_UNSUPPORTED',
          `${name} 不是 F28034 的 ePWM 实例`, { function: name }));
        continue;
      }
      const frequency = Number(module.frequency_hz);
      const tbprd = sysclk /
        ((module.count_mode === 'up_down' ? 2 : 1) * frequency);
      if (!Number.isFinite(tbprd) || tbprd < 1 || tbprd > TBPRD_MAX) {
        findings.push(finding(
          'ERROR', 'PWM_TBPRD_OVERFLOW',
          `${name} 的 TBPRD 超出 1..${TBPRD_MAX}`, { function: name },
        ));
      }
      if (!(Number(module.duty) > 0 && Number(module.duty) < 1)) {
        findings.push(finding('ERROR', 'PWM_DUTY_ILLEGAL',
          `${name} 占空比必须在 0 和 1 之间`, { function: name }));
      }
      if (module.mode === 'complementary') {
        if (module.pin_a == null || module.pin_b == null) {
          findings.push(finding('ERROR', 'EPWM_PAIR_INCOMPLETE',
            `${name} 互补模式必须同时配置 A/B`));
        }
        const red = Number(module.deadband?.red_ns);
        const fed = Number(module.deadband?.fed_ns);
        const redTicks = Math.round(red * sysclk / 1e9);
        const fedTicks = Math.round(fed * sysclk / 1e9);
        if (!(red > 0) || !(fed > 0)) {
          findings.push(finding('ERROR', 'PWM_DEADBAND_ZERO',
            `${name} 互补输出必须有非零 RED/FED 死区`));
        } else if (redTicks > DB_MAX || fedTicks > DB_MAX) {
          findings.push(finding('ERROR', 'PWM_DEADBAND_OVERFLOW',
            `${name} 死区计数超出 ${DB_MAX}`));
        }
      }
      if (!(module.trip_route_ids || []).length) {
        findings.push(finding(
          'WARNING', 'PWM_NO_HARDWARE_TRIP',
          `${name} 未关联硬件 Trip；不得据此直接开启功率级`,
          { function: name },
        ));
      }
    }
  }

  function analogRoute(pinmux, physicalPin, functionName, type) {
    const def = pinmux?.pins?.[String(Number(physicalPin))];
    return (def?.analog_paths || []).some(route =>
      route.type === type &&
      String(route.function).toUpperCase() === String(functionName).toUpperCase());
  }

  function validateAnalog(project, pinmux, findings) {
    for (const [socName, soc] of Object.entries(project?.adc?.socs || {})) {
      if (!analogRoute(
        pinmux, soc.physical_pin, soc.channel, 'adc_input',
      )) {
        findings.push(finding(
          'ERROR', 'ADC_PHYSICAL_ROUTE_MISMATCH',
          `${socName}: Pin${soc.physical_pin} 不提供 ${soc.channel} 官方模拟路径`,
        ));
      }
      if (project?.pins?.[String(Number(soc.physical_pin))]?.route_kind === 'aio') {
        findings.push(finding(
          'ERROR', 'ANALOG_AIO_CONFLICT',
          `Pin${soc.physical_pin} 不能同时作为 ADC 模拟输入和数字 AIO`,
        ));
      }
    }
    for (const [name, comparator] of Object.entries(project?.comparators || {})) {
      for (const side of ['positive', 'negative']) {
        const source = comparator?.[side];
        if (source?.kind !== 'external') continue;
        if (!analogRoute(
          pinmux, source.physical_pin, source.function, 'comparator_input',
        )) {
          findings.push(finding(
            'ERROR', 'COMPARATOR_PHYSICAL_ROUTE_MISMATCH',
            `${name}.${side}: Pin${source.physical_pin} 不提供 ${source.function} 官方模拟路径`,
          ));
        }
      }
    }
  }

  function validateTimers(project, sysclk, findings) {
    for (const [name, timer] of Object.entries(project?.timers || {})) {
      if (name !== 'TIMER0') {
        findings.push(finding('ERROR', 'TIMER_UNSUPPORTED',
          `当前仅支持 TIMER0，不能生成 ${name}`));
        continue;
      }
      const prd = Math.round(sysclk * Number(timer.period_us) / 1e6) - 1;
      if (!Number.isFinite(prd) || prd <= 0 || prd > 0xFFFFFFFF) {
        findings.push(finding('ERROR', 'TIMER_PERIOD_ILLEGAL',
          `${name} period_us 无法转换为合法 PRD`));
      }
    }
  }

  function validateProject(project, pinmux, family, context = {}) {
    const findings = [];
    if (!project || Number(project.schema_version) !== 2) {
      findings.push(finding(
        'ERROR', 'SCHEMA_VERSION',
        'R3.3 只接受 schema_version=2；旧工程必须先显式迁移',
      ));
    }
    if (project?.device && pinmux?.device &&
        !String(pinmux.device).toUpperCase()
          .startsWith(String(project.device).toUpperCase())) {
      findings.push(finding('ERROR', 'DEVICE_MISMATCH',
        `工程器件 ${project.device} 与数据包 ${pinmux.device} 不一致`));
    }
    validatePins(project || {}, pinmux || {}, findings);
    const sysclk = systemClockHz(project || {}, findings);
    if (Number(family?.max_sysclk_mhz || 60) * 1e6 < sysclk) {
      findings.push(finding('ERROR', 'PLL_ILLEGAL',
        `SYSCLK=${sysclk}Hz 超过器件系列上限`));
    }
    validatePwm(project || {}, sysclk, findings);
    validateTimers(project || {}, sysclk, findings);
    validateAnalog(project || {}, pinmux || {}, findings);

    const peripheral = PeripheralConstraints.validateProject(project || {}, {
      signalGroups: context.signalGroups || {},
      internalRoutes: context.internalRoutes || {},
      peripheralInstances: context.peripheralInstances || {},
    });
    findings.push(...peripheral.findings);

    if (project?.unresolved) {
      findings.push(finding('ERROR', 'UNRESOLVED_PARAM',
        'ProjectConfig 仍包含 unresolved 标记'));
    }
    if (!findings.length) {
      findings.push(finding('INFO', 'OK', '未发现约束冲突'));
    }
    const blocking = findings.filter(item => item.severity === 'ERROR');
    return {
      ok: blocking.length === 0,
      blocking,
      findings,
      resource_claims: peripheral.claims,
    };
  }

  return { validateProject };
});
