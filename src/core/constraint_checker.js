/* Pure browser-side validation for the single R3.2 ProjectConfig schema. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ConstraintChecker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_SYSCLK = 60000000;
  const TBPRD_MAX = 0xFFFF;
  const DB_MAX = 1023;

  function finding(severity, rule, message, extra = {}) {
    return { severity, rule, message, ...extra };
  }

  function pins(project) {
    return Object.entries(project?.pins || {}).map(([key, value]) => ({
      physical_pin: Number(value?.physical_pin ?? key),
      ...(value || {}),
    }));
  }

  function exactOption(pinmux, pin) {
    const def = pinmux?.pins?.[String(pin.physical_pin)];
    if (!def) return { def: null, option: null };
    const option = (def.mux_options || []).find(item =>
      Number(item.mux) === Number(pin.mux) &&
      String(item.function).toUpperCase() === String(pin.function).toUpperCase(),
    ) || null;
    return { def, option };
  }

  function validatePins(project, pinmux, findings) {
    const seen = new Map();
    for (const pin of pins(project)) {
      const pnum = pin.physical_pin;
      if (seen.has(pnum)) {
        findings.push(finding(
          'ERROR', 'PIN_CONFLICT',
          `Pin${pnum} 同时被 ${seen.get(pnum)} 和 ${pin.function} 占用`,
          { pin: pnum, function: pin.function },
        ));
      }
      seen.set(pnum, pin.function);
      const { def, option } = exactOption(pinmux, pin);
      if (!def) {
        findings.push(finding('ERROR', 'PIN_NOT_FOUND',
          `Pin${pnum} 不在器件数据库中`, { pin: pnum }));
        continue;
      }
      if (!def.configurable) {
        findings.push(finding('ERROR', 'FIXED_PIN',
          `Pin${pnum} ${def.primary_signal} 是固定功能脚`, { pin: pnum }));
        continue;
      }
      if (!option) {
        findings.push(finding(
          'ERROR', 'MUX_FUNCTION_MISMATCH',
          `Pin${pnum} 的 MUX${pin.mux}/${pin.function} 不是 golden 数据库中的同一选项`,
          { pin: pnum, function: pin.function },
        ));
        continue;
      }
      if (!option.signal_verified) {
        findings.push(finding(
          'ERROR', 'SIGNAL_UNVERIFIED',
          `Pin${pnum} ${option.function} 的信号归属没有 golden 证据`,
          { pin: pnum, function: option.function },
        ));
      }
      if (!option.mux_value_verified) {
        findings.push(finding(
          'ERROR', 'MUX_VALUE_UNVERIFIED',
          `Pin${pnum} ${option.function} 的 MUX 数值没有 golden 证据`,
          { pin: pnum, function: option.function },
        ));
      }
      if (!option.pin_config_supported) {
        findings.push(finding(
          'ERROR', 'PIN_CONFIG_UNSUPPORTED',
          `Pin${pnum} ${option.function} 尚不支持生成引脚配置`,
          { pin: pnum, function: option.function },
        ));
      } else if (!option.peripheral_init_supported) {
        findings.push(finding(
          'WARNING', 'PINMUX_ONLY',
          `${option.function} 只生成引脚复用；当前版本不生成该外设完整初始化`,
          { pin: pnum, function: option.function },
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
        `系统时钟必须在 1..${MAX_SYSCLK}Hz，当前值为 ${clock.sysclk_hz ?? clock.target_mhz}`,
      ));
      return MAX_SYSCLK;
    }
    return hz;
  }

  function validatePwm(project, sysclk, findings) {
    const allPins = pins(project);
    for (const [name, module] of Object.entries(project?.pwm_modules || {})) {
      const label = name.toUpperCase();
      if (!/^EPWM[1-7]$/.test(label)) {
        findings.push(finding('ERROR', 'PWM_MODULE_UNSUPPORTED',
          `${name} 不是 F28034 支持的 ePWM 模块`, { function: name }));
        continue;
      }
      const freq = Number(module.frequency_hz);
      const countMode = module.count_mode || 'up_down';
      const tbprd = sysclk / ((countMode === 'up_down' ? 2 : 1) * freq);
      if (!Number.isFinite(tbprd) || tbprd < 1 || tbprd > TBPRD_MAX) {
        findings.push(finding(
          'ERROR', 'PWM_TBPRD_OVERFLOW',
          `${label} 的 TBPRD=${Number.isFinite(tbprd) ? Math.round(tbprd) : '非法'} 超出 1..${TBPRD_MAX}`,
          { function: label },
        ));
      }
      const duty = Number(module.duty);
      if (!(duty > 0 && duty < 1)) {
        findings.push(finding('ERROR', 'PWM_DUTY_ILLEGAL',
          `${label} 占空比必须在 0 和 1 之间`, { function: label }));
      }
      if (module.mode === 'complementary') {
        if (module.pin_a == null || module.pin_b == null) {
          findings.push(finding(
            'ERROR', 'EPWM_PAIR_INCOMPLETE',
            `${label} 互补模式必须同时配置 A/B`, { function: label },
          ));
        }
        const db = module.deadband || {};
        const red = Number(db.red_ns);
        const fed = Number(db.fed_ns);
        const redTicks = Math.round(red * sysclk / 1e9);
        const fedTicks = Math.round(fed * sysclk / 1e9);
        if (!db.enabled || !(red > 0) || !(fed > 0)) {
          findings.push(finding(
            'ERROR', 'PWM_DEADBAND_ZERO',
            `${label} 互补输出必须有非零 RED/FED 死区`, { function: label },
          ));
        } else if (redTicks > DB_MAX || fedTicks > DB_MAX) {
          findings.push(finding(
            'ERROR', 'PWM_DEADBAND_OVERFLOW',
            `${label} 死区计数超出 10-bit 上限 ${DB_MAX}`, { function: label },
          ));
        }
      }
      const trip = module.trip || {};
      if (trip.enabled) {
        const source = String(trip.source || '').toUpperCase().replace(/N$/, '');
        const match = allPins.find(pin =>
          String(pin.function || '').toUpperCase().replace(/N$/, '') === source &&
          pin.module === name && pin.role === 'trip');
        if (!match || Number(match.physical_pin) !== Number(trip.pin)) {
          findings.push(finding(
            'ERROR', 'PWM_TRIP_PIN_MISSING',
            `${label} 选择了 ${source}，但 ProjectConfig 没有对应的 Trip 物理脚`,
            { function: label },
          ));
        }
      } else {
        findings.push(finding(
          'WARNING', 'PWM_NO_HARDWARE_TRIP',
          `${label} 未启用硬件 Trip；禁止据此直接开启功率级`,
          { function: label },
        ));
      }
    }
  }

  function validateTimers(project, sysclk, findings) {
    for (const [name, timer] of Object.entries(project?.timers || {})) {
      if (name.toUpperCase() !== 'TIMER0') {
        findings.push(finding('ERROR', 'TIMER_UNSUPPORTED',
          `当前只支持 TIMER0，不能生成 ${name}`, { function: name }));
        continue;
      }
      const prd = Math.round(sysclk * Number(timer.period_us) / 1e6) - 1;
      if (!Number.isFinite(prd) || prd <= 0 || prd > 0xFFFFFFFF) {
        findings.push(finding('ERROR', 'TIMER_PERIOD_ILLEGAL',
          `${name} period_us 无法转换为有效 PRD`, { function: name }));
      }
    }
  }

  function validateAdc(project, findings) {
    if (!project?.adc) return;
    const soc = Number(project.adc.soc);
    const acqps = Number(project.adc.acqps);
    if (!Number.isInteger(soc) || soc < 0 || soc > 15) {
      findings.push(finding('ERROR', 'ADC_SOC_ILLEGAL', 'ADC SOC 必须在 0..15'));
    }
    if (!Number.isInteger(acqps) || acqps < 0 || acqps > 63) {
      findings.push(finding('ERROR', 'ADC_ACQPS_ILLEGAL', 'ADC ACQPS 必须在 0..63'));
    } else if (acqps < 7) {
      findings.push(finding(
        'WARNING', 'ADC_ACQPS_TOO_SHORT',
        `ACQPS=${acqps} 小于 7，采样窗可能过短`,
      ));
    }
  }

  function validateAnalogRoutes(project, pinmux, findings) {
    if (project?.adc) {
      let pin = Number(project.adc.physical_pin);
      let def = Number.isInteger(pin) ? pinmux?.pins?.[String(pin)] : null;
      if (!def) {
        def = Object.values(pinmux?.pins || {}).find(item =>
          (item.analog_paths || []).some(route =>
            route.type === 'adc_input' &&
            String(route.function).toUpperCase() ===
              String(project.adc.channel).toUpperCase()));
        pin = Number(def?.physical_pin);
      }
      const present = (def?.analog_paths || []).some(route =>
        route.type === 'adc_input' &&
        String(route.function).toUpperCase() ===
          String(project.adc.channel).toUpperCase());
      if (!present) {
        findings.push(finding(
          'ERROR', 'ADC_PHYSICAL_ROUTE_MISMATCH',
          `Pin${pin} 不提供 ${project.adc.channel} 官方模拟路径`,
        ));
      }
      if (project?.aio?.[String(pin)]) {
        findings.push(finding(
          'ERROR', 'ANALOG_AIO_CONFLICT',
          `Pin${pin} 不能同时选择 ADC 模拟模式和数字 AIO`,
        ));
      }
    }
    for (const [name, route] of Object.entries(project?.comparator_inputs || {})) {
      const pin = Number(route.physical_pin);
      const def = pinmux?.pins?.[String(pin)];
      const present = (def?.analog_paths || []).some(item =>
        item.type === 'comparator_input' &&
        String(item.function).toUpperCase() === String(name).toUpperCase());
      if (!present) {
        findings.push(finding(
          'ERROR', 'COMPARATOR_PHYSICAL_ROUTE_MISMATCH',
          `Pin${pin} 不提供 ${name} 官方比较器输入路径`,
        ));
      }
      if (project?.aio?.[String(pin)]) {
        findings.push(finding(
          'ERROR', 'ANALOG_AIO_CONFLICT',
          `Pin${pin} 不能同时选择 Comparator 模拟模式和数字 AIO`,
        ));
      }
    }
    for (const [key, aio] of Object.entries(project?.aio || {})) {
      const pin = Number(aio.physical_pin ?? key);
      const def = pinmux?.pins?.[String(pin)];
      if (!def?.aio_function ||
          String(def.aio_function.function).toUpperCase() !==
            String(aio.function).toUpperCase()) {
        findings.push(finding(
          'ERROR', 'AIO_PHYSICAL_ROUTE_MISMATCH',
          `Pin${pin} 不提供 ${aio.function} 官方 AIO 路径`,
        ));
      }
    }
  }

  function validateProject(project, pinmux, family) {
    const findings = [];
    if (!project || Number(project.schema_version) !== 1) {
      findings.push(finding(
        'ERROR', 'SCHEMA_VERSION',
        '只接受 schema_version=1 的 R3.2 ProjectConfig',
      ));
    }
    if (project?.device && pinmux?.device &&
        !String(pinmux.device).toUpperCase().startsWith(String(project.device).toUpperCase())) {
      findings.push(finding('ERROR', 'DEVICE_MISMATCH',
        `ProjectConfig 器件 ${project.device} 与数据包 ${pinmux.device} 不一致`));
    }
    validatePins(project || {}, pinmux || {}, findings);
    const sysclk = systemClockHz(project || {}, findings);
    if (Number(family?.max_sysclk_mhz || 60) * 1e6 < sysclk) {
      findings.push(finding('ERROR', 'PLL_ILLEGAL',
        `SYSCLK=${sysclk}Hz 超过器件系列上限`));
    }
    validatePwm(project || {}, sysclk, findings);
    validateTimers(project || {}, sysclk, findings);
    validateAdc(project || {}, findings);
    validateAnalogRoutes(project || {}, pinmux || {}, findings);
    if (project?.unresolved) {
      findings.push(finding('ERROR', 'UNRESOLVED_PARAM',
        'ProjectConfig 仍包含 unresolved 标记'));
    }
    if (!findings.length) {
      findings.push(finding('INFO', 'OK', '未发现约束冲突'));
    }
    const blocking = findings.filter(item => item.severity === 'ERROR');
    return { ok: blocking.length === 0, blocking, findings };
  }

  return { validateProject };
});
