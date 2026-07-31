/* R3.3 peripheral-instance, internal-route and shared-resource validation. */
(function (root, factory) {
  const graph = root.ResourceGraph ||
    (typeof require === 'function' ? require('./resource_graph.js') : null);
  const api = factory(graph);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PeripheralConstraints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ResourceGraph) {
  'use strict';

  function finding(severity, rule, message, extra = {}) {
    return { severity, rule, message, ...extra };
  }

  function signal(module, role) {
    return module?.signals?.[role] || null;
  }

  function required(findings, instance, module, role, label = role.toUpperCase()) {
    if (!signal(module, role)) {
      findings.push(finding(
        'ERROR',
        'SIGNAL_GROUP_INCOMPLETE',
        `${instance} 缺少必选信号 ${label}`,
        { function: instance, role },
      ));
      return false;
    }
    return true;
  }

  function validateSignalOwner(findings, instance, module, expected) {
    Object.entries(module?.signals || {}).forEach(([role, route]) => {
      const want = expected?.[role];
      if (want && String(route?.function).toUpperCase() !== want) {
        findings.push(finding(
          'ERROR',
          'SIGNAL_INSTANCE_MIXED',
          `${instance}.${role} 需要 ${want}，不能使用 ${route?.function}`,
          { function: instance, role },
        ));
      }
    });
  }

  function validateI2c(project, findings) {
    Object.entries(project?.i2c_modules || {}).forEach(([name, module]) => {
      required(findings, name, module, 'sda', 'SDAA');
      required(findings, name, module, 'scl', 'SCLA');
      validateSignalOwner(findings, name, module, { sda: 'SDAA', scl: 'SCLA' });
      if (!['master', 'slave'].includes(module?.role)) {
        findings.push(finding('ERROR', 'I2C_ROLE', `${name} 必须选择 master 或 slave`));
      }
      if (!(Number(module?.bus_hz) > 0)) {
        findings.push(finding('ERROR', 'I2C_BUS_HZ', `${name} bus_hz 必须大于 0`));
      }
    });
  }

  function validateSpi(project, findings) {
    Object.entries(project?.spi_modules || {}).forEach(([name, module]) => {
      const suffix = name === 'SPIB' ? 'B' : 'A';
      const expected = {
        simo: `SPISIMO${suffix}`,
        somi: `SPISOMI${suffix}`,
        clk: `SPICLK${suffix}`,
        ste: `SPISTE${suffix}`,
      };
      validateSignalOwner(findings, name, module, expected);
      required(findings, name, module, 'clk', expected.clk);
      const wireMode = module?.wire_mode || '4wire';
      const role = module?.role || 'master';
      const dataMode = module?.data_mode || 'full_duplex';
      if (wireMode === '3wire') {
        if (role === 'master') {
          required(findings, name, module, 'simo', `${expected.simo} / MOMI`);
          if (signal(module, 'somi')) {
            findings.push(finding(
              'ERROR', 'SPI_3WIRE_UNUSED_ROLE',
              `${name} 3-wire master 必须释放 ${expected.somi}`,
            ));
          }
        } else {
          required(findings, name, module, 'somi', `${expected.somi} / SISO`);
          if (signal(module, 'simo')) {
            findings.push(finding(
              'ERROR', 'SPI_3WIRE_UNUSED_ROLE',
              `${name} 3-wire slave 必须释放 ${expected.simo}`,
            ));
          }
        }
      } else {
        if (['tx', 'full_duplex'].includes(dataMode)) required(findings, name, module, 'simo', expected.simo);
        if (['rx', 'full_duplex'].includes(dataMode)) required(findings, name, module, 'somi', expected.somi);
      }
      const ste = module?.ste_strategy || 'no_cs';
      if (ste === 'hardware_ste' || ste === 'hardware_ste_pin') {
        required(findings, name, module, 'ste', expected.ste);
      }
      const lspclk = Number(module?.lspclk_hz || 15000000);
      const baud = Number(module?.baud_hz);
      const brr = Math.round(lspclk / baud - 1);
      if (!(baud > 0) || !Number.isFinite(brr) || brr < 3 || brr > 127) {
        findings.push(finding(
          'ERROR',
          'SPI_BAUD_RANGE',
          `${name} 的 LSPCLK/baud 无法得到合法 SPIBRR(3..127)`,
        ));
      }
    });
  }

  function validateSci(project, findings) {
    Object.entries(project?.sci_modules || {}).forEach(([name, module]) => {
      const mode = module?.mode || 'full_duplex';
      validateSignalOwner(findings, name, module, { tx: 'SCITXDA', rx: 'SCIRXDA' });
      if (['tx_only', 'full_duplex', 'half_duplex'].includes(mode)) {
        required(findings, name, module, 'tx', 'SCITXDA');
      }
      if (['rx_only', 'full_duplex'].includes(mode)) {
        required(findings, name, module, 'rx', 'SCIRXDA');
      }
      if (mode === 'half_duplex' && !module?.direction_control) {
        findings.push(finding(
          'ERROR', 'SCI_HALF_DUPLEX_DIRECTION',
          `${name} half_duplex 必须明确外部连接和方向控制策略`,
        ));
      }
    });
  }

  function validateLin(project, findings) {
    Object.entries(project?.lin_modules || {}).forEach(([name, module]) => {
      if (!['lin', 'sci_compat'].includes(module?.mode)) {
        findings.push(finding('ERROR', 'LIN_MODE', `${name} mode 必须是 lin 或 sci_compat`));
      }
      validateSignalOwner(findings, name, module, { tx: 'LINTXA', rx: 'LINRXA' });
      const direction = module?.direction || 'full_duplex';
      if (['full_duplex', 'tx_only'].includes(direction)) required(findings, name, module, 'tx', 'LINTXA');
      if (['full_duplex', 'rx_only'].includes(direction)) required(findings, name, module, 'rx', 'LINRXA');
      if (direction !== 'full_duplex') {
        findings.push(finding(
          'WARNING', 'LIN_DIAGNOSTIC_DIRECTION',
          `${name} 当前为 ${direction}，不是完整双向 LIN 节点`,
        ));
      }
    });
  }

  function validateCan(project, findings) {
    Object.entries(project?.can_modules || {}).forEach(([name, module]) => {
      const mode = module?.mode || 'normal';
      validateSignalOwner(findings, name, module, { tx: 'CANTXA', rx: 'CANRXA' });
      if (['normal', 'tx_test'].includes(mode)) required(findings, name, module, 'tx', 'CANTXA');
      if (['normal', 'listen_only', 'rx_test'].includes(mode)) required(findings, name, module, 'rx', 'CANRXA');
      if (mode !== 'self_test_loopback') {
        if (!(Number(module?.tseg1) > 0) || !(Number(module?.tseg2) > 0)) {
          findings.push(finding(
            'ERROR', 'CAN_BIT_TIMING_ZERO',
            `${name} 的 TSEG1/TSEG2 必须大于 0`,
          ));
        }
      }
    });
  }

  function validateEqep(project, findings) {
    Object.entries(project?.eqep_modules || {}).forEach(([name, module]) => {
      validateSignalOwner(findings, name, module, {
        a: 'EQEP1A', b: 'EQEP1B', index: 'EQEP1I', strobe: 'EQEP1S',
      });
      required(findings, name, module, 'a', 'EQEP1A');
      required(findings, name, module, 'b', 'EQEP1B');
      Object.values(module?.signals || {}).forEach(route => {
        if (route?.qualification === 'async') {
          findings.push(finding(
            'ERROR', 'EQEP_ASYNC_FORBIDDEN',
            `${name} 输入不得使用 async qualification`,
          ));
        }
      });
    });
  }

  function validateEcap(project, findings) {
    Object.entries(project?.ecap_modules || {}).forEach(([name, module]) => {
      if (!['capture', 'apwm'].includes(module?.mode)) {
        findings.push(finding('ERROR', 'ECAP_MODE', `${name} 必须选择 capture 或 apwm`));
      }
      if (module?.capture && module?.apwm) {
        findings.push(finding(
          'ERROR', 'ECAP_MODE_CONFLICT',
          `${name} capture 与 APWM 不能同时启用`,
        ));
      }
      required(findings, name, module, 'io', 'ECAP1');
    });
  }

  function validateHrcap(project, findings) {
    Object.entries(project?.hrcap_modules || {}).forEach(([name, module]) => {
      required(findings, name, module, 'input', name);
      if (module?.mode === 'high_resolution') {
        const calibration = module?.calibration || {};
        if (!['startup', 'runtime'].includes(calibration.mode)) {
          findings.push(finding(
            'ERROR', 'HRCAP_CALIBRATION_REQUIRED',
            `${name} 高分辨率模式必须选择 startup 或 runtime HCCal 校准`,
          ));
        }
        if (!calibration.library) {
          findings.push(finding(
            'ERROR', 'HRCAP_LIBRARY_REQUIRED',
            `${name} 高分辨率模式必须声明 TI HCCal library 依赖`,
          ));
        }
        if ((calibration.hrcap_instance || name) === name) {
          findings.push(finding(
            'ERROR', 'HRCAP_CALIBRATION_INSTANCE_CONFLICT',
            `${name} 不能同时作为应用捕获通道和专用校准 HRCAP`,
          ));
        }
      }
    });
  }

  function validateAdc(project, internalRoutes, findings) {
    const adc = project?.adc || {};
    const seen = new Set();
    Object.entries(adc.socs || {}).forEach(([key, soc]) => {
      const match = /^SOC([0-9]|1[0-5])$/.exec(key);
      const number = Number(soc?.soc ?? match?.[1]);
      if (!match || Number(match[1]) !== number || seen.has(number)) {
        findings.push(finding('ERROR', 'ADC_SOC_UNIQUE', `${key} 的 SOC 编号无效或重复`));
      }
      seen.add(number);
      if (!/^ADCIN[AB][0-7]$/.test(String(soc?.channel || '').toUpperCase())) {
        findings.push(finding('ERROR', 'ADC_CHANNEL_ILLEGAL', `${key} channel 非法`));
      }
      const acqps = Number(soc?.acqps);
      if (!Number.isInteger(acqps) || acqps < 0 || acqps > 63) {
        findings.push(finding('ERROR', 'ADC_ACQPS_ILLEGAL', `${key} ACQPS 必须在 0..63`));
      } else if (acqps < 7) {
        findings.push(finding('WARNING', 'ADC_ACQPS_TOO_SHORT', `${key} ACQPS=${acqps} 可能过短`));
      }
      const trigger = String(soc?.trigger || 'SOFTWARE').toUpperCase();
      const route = internalRoutes?.adc_triggers?.[trigger];
      if (!route) {
        findings.push(finding('ERROR', 'ADC_TRIGGER_ILLEGAL', `${key} trigger=${trigger} 不在内部路由库`));
      } else if (route.owner?.startsWith('EPWM')) {
        const event = project?.pwm_event_triggers?.[route.owner]?.[route.event];
        if (!project?.pwm_modules?.[route.owner] || !event?.enabled ||
            !event.source || !(Number(event.prescale) > 0)) {
          findings.push(finding(
            'ERROR',
            'ADC_EPWM_TRIGGER_INCOMPLETE',
            `${key} 使用 ${trigger}，但 ${route.owner}.${route.event} 未完整启用事件源和分频`,
          ));
        }
      }
    });
    Object.entries(adc.interrupts || {}).forEach(([name, interrupt]) => {
      if (interrupt?.enabled !== false && !adc.socs?.[interrupt.eoc]) {
        findings.push(finding(
          'ERROR', 'ADCINT_EOC_MISSING',
          `${name} 的 EOC 来源 ${interrupt.eoc} 不存在`,
        ));
      }
    });
  }

  function validateComparators(project, findings) {
    Object.entries(project?.comparators || {}).forEach(([name, module]) => {
      for (const side of ['positive', 'negative']) {
        const source = module?.[side];
        if (!source || !['external', 'internal_dac'].includes(source.kind)) {
          findings.push(finding(
            'ERROR', 'COMPARATOR_SOURCE_INCOMPLETE',
            `${name}.${side} 必须选择 external 或 internal_dac`,
          ));
        }
        if (source?.kind === 'internal_dac' &&
            !(Number(source.value) >= 0 && Number(source.value) <= 1023)) {
          findings.push(finding(
            'ERROR', 'COMPARATOR_DAC_RANGE',
            `${name}.${side} DAC value 必须在 0..1023`,
          ));
        }
      }
    });
  }

  function validateTripRoutes(project, internalRoutes, findings) {
    Object.entries(project?.trip_routes || {}).forEach(([id, route]) => {
      const source = internalRoutes?.trip_sources?.[route?.source];
      if (!source) {
        findings.push(finding('ERROR', 'TRIP_SOURCE_ILLEGAL', `${id} source=${route?.source} 不存在`));
        return;
      }
      if (source.requires_physical_pin && !Number.isInteger(Number(route?.source_pin))) {
        findings.push(finding('ERROR', 'TRIP_EXTERNAL_PIN_MISSING', `${id} 外部 ${route.source} 必须选择物理脚`));
      }
      if (!source.requires_physical_pin && route?.source_pin != null) {
        findings.push(finding(
          'ERROR', 'TRIP_INTERNAL_PIN_FORBIDDEN',
          `${id} 的 ${route.source} 是内部源，不得占用外部物理脚`,
        ));
      }
      const targets = [...new Set(route?.targets || [])];
      if (!targets.length) {
        findings.push(finding('ERROR', 'TRIP_TARGET_MISSING', `${id} 至少需要一个 ePWM target`));
      }
      targets.forEach(target => {
        if (!project?.pwm_modules?.[target]) {
          findings.push(finding('ERROR', 'TRIP_TARGET_UNKNOWN', `${id} target ${target} 未配置`));
        }
      });
      if (source.owner && !project?.comparators?.[source.owner] &&
          source.kind === 'comparator') {
        findings.push(finding('ERROR', 'TRIP_COMPARATOR_MISSING', `${id} 需要先配置 ${source.owner}`));
      }
    });
  }

  function validateSyncGraph(project, findings) {
    const graph = project?.pwm_sync_graph || {};
    const edges = {};
    Object.entries(graph).forEach(([name, node]) => {
      if (node?.role === 'slave' && node.sync_source &&
          node.sync_source !== 'external') {
        (edges[node.sync_source] ||= []).push(name);
      }
    });
    const visiting = new Set();
    const visited = new Set();
    function visit(node) {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const target of edges[node] || []) if (visit(target)) return true;
      visiting.delete(node);
      visited.add(node);
      return false;
    }
    if (Object.keys(graph).some(visit)) {
      findings.push(finding('ERROR', 'PWM_SYNC_CYCLE', 'ePWM 同步图形成环路'));
    }
  }

  function validateProject(project, context = {}) {
    const findings = [];
    validateI2c(project, findings);
    validateSpi(project, findings);
    validateSci(project, findings);
    validateLin(project, findings);
    validateCan(project, findings);
    validateEqep(project, findings);
    validateEcap(project, findings);
    validateHrcap(project, findings);
    validateAdc(project, context.internalRoutes || {}, findings);
    validateComparators(project, findings);
    validateTripRoutes(project, context.internalRoutes || {}, findings);
    validateSyncGraph(project, findings);
    const graph = ResourceGraph.detectConflicts(project);
    findings.push(...graph.findings);
    return { findings, claims: graph.claims };
  }

  return { validateProject };
});
