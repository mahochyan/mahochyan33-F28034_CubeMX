/* R3.3 declarative resource claims and cross-module conflict graph. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ResourceGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function claim(owner, resource, mode = 'exclusive', kind = 'shared_resource', extra = {}) {
    return { owner, resource, mode, kind, ...extra };
  }

  function moduleClaims(project, collection, clockDomain, claims) {
    Object.keys(project?.[collection] || {}).sort().forEach(instance => {
      claims.push(
        claim(instance, `PERIPHERAL.${instance}`, 'exclusive', 'peripheral_instance'),
        claim(instance, `CLOCK.${clockDomain}`, 'shared', 'clock_domain'),
      );
    });
  }

  function claimsForProject(project) {
    const claims = [];
    Object.entries(project?.pins || {}).forEach(([key, pin]) => {
      const physicalPin = Number(pin?.physical_pin ?? key);
      const owner = pin?.module || pin?.function || `PIN${physicalPin}`;
      claims.push(claim(owner, `PIN${physicalPin}`, 'exclusive', 'physical_pin', {
        physical_pin: physicalPin,
        function: pin?.function || null,
      }));
      if (pin?.gpio_num != null) {
        claims.push(claim(
          owner,
          `DIGITAL_MUX.GPIO${Number(pin.gpio_num)}`,
          'exclusive',
          'digital_mux',
        ));
      }
    });

    moduleClaims(project, 'i2c_modules', 'LSPCLK', claims);
    moduleClaims(project, 'spi_modules', 'LSPCLK', claims);
    moduleClaims(project, 'sci_modules', 'LSPCLK', claims);
    moduleClaims(project, 'lin_modules', 'LSPCLK', claims);
    moduleClaims(project, 'can_modules', 'SYSCLK', claims);
    moduleClaims(project, 'eqep_modules', 'SYSCLK', claims);
    moduleClaims(project, 'ecap_modules', 'SYSCLK', claims);
    moduleClaims(project, 'hrcap_modules', 'HCCAPCLK', claims);
    moduleClaims(project, 'comparators', 'SYSCLK', claims);
    moduleClaims(project, 'pwm_modules', 'TBCLK', claims);

    if (project?.pwm_modules?.EPWM7) {
      claims.push(claim(
        'EPWM7',
        'SHARED.EPWM7_CALIBRATION',
        'exclusive',
        'shared_calibration_resource',
        { purpose: 'application_pwm' },
      ));
    }
    Object.entries(project?.hrcap_modules || {}).forEach(([name, module]) => {
      const calibration = module?.calibration || {};
      if (module?.mode === 'high_resolution' &&
          ['startup', 'runtime'].includes(calibration.mode)) {
        claims.push(
          claim(
            `${name}.CALIBRATION`,
            'SHARED.EPWM7_CALIBRATION',
            'exclusive',
            'shared_calibration_resource',
            { purpose: 'hrcap_calibration' },
          ),
          claim(
            `${name}.CALIBRATION`,
            `SHARED.${calibration.hrcap_instance || name}_CALIBRATION_INSTANCE`,
            'exclusive',
            'shared_calibration_resource',
          ),
        );
      }
    });

    Object.entries(project?.pwm_event_triggers || {}).forEach(([module, triggers]) => {
      for (const event of ['SOCA', 'SOCB']) {
        if (triggers?.[event]?.enabled) {
          claims.push(claim(
            `${module}.${event}`,
            `INTERNAL_TRIGGER.${module}.${event}`,
            'shared',
            'internal_trigger',
            { physical_pin: null },
          ));
        }
      }
    });
    Object.entries(project?.adc?.socs || {}).forEach(([socName, soc]) => {
      const trigger = String(soc?.trigger || 'SOFTWARE').toUpperCase();
      if (/^EPWM[1-7]_SOC[AB]$/.test(trigger)) {
        claims.push(claim(
          `ADC.${socName}`,
          `INTERNAL_TRIGGER.${trigger.replace('_', '.')}`,
          'shared',
          'internal_trigger',
          { physical_pin: null },
        ));
      }
    });
    Object.entries(project?.trip_routes || {}).forEach(([routeId, route]) => {
      claims.push(claim(
        `TRIP.${routeId}`,
        `TRIP_SOURCE.${route.source}`,
        'shared',
        'internal_trigger',
        { physical_pin: route.source_kind === 'external_tz' ? route.source_pin : null },
      ));
    });
    Object.entries(project?.interrupt_routes || {}).forEach(([vector, route]) => {
      if (route?.enabled === false) return;
      claims.push(claim(
        route?.owner || vector,
        `INTERRUPT.${vector}`,
        'exclusive',
        'interrupt_vector',
      ));
    });
    return claims;
  }

  function finding(severity, rule, message, extra = {}) {
    return { severity, rule, message, ...extra };
  }

  function detectConflicts(project) {
    const claims = claimsForProject(project);
    const byResource = new Map();
    for (const item of claims) {
      const list = byResource.get(item.resource) || [];
      list.push(item);
      byResource.set(item.resource, list);
    }
    const findings = [];
    for (const [resource, entries] of byResource) {
      const owners = [...new Set(entries.map(item => item.owner))];
      if (owners.length > 1 && entries.some(item => item.mode === 'exclusive')) {
        findings.push(finding(
          'ERROR',
          'RESOURCE_CONFLICT',
          `${resource} 被 ${owners.join('、')} 同时声明，资源模式不兼容`,
          { resource, owners, claims: entries },
        ));
      }
    }

    for (const [name] of Object.entries(project?.i2c_modules || {})) {
      findings.push(finding(
        'INFO',
        'I2C_EXTERNAL_PULLUP',
        `${name} 的 SDA/SCL 需要板级外部上拉电阻`,
        { function: name },
      ));
    }
    for (const [name, module] of Object.entries(project?.can_modules || {})) {
      if (module?.mode !== 'self_test_loopback') {
        findings.push(finding(
          'INFO',
          'CAN_TRANSCEIVER_REQUIRED',
          `${name} 连接真实 CAN 总线需要外部 CAN 收发器`,
          { function: name },
        ));
      }
    }
    for (const [name, module] of Object.entries(project?.lin_modules || {})) {
      if (module?.mode === 'lin') {
        findings.push(finding(
          'INFO',
          'LIN_TRANSCEIVER_REQUIRED',
          `${name} 的 MCU 引脚不是 LIN 总线电平，通常需要外部 LIN 收发器`,
          { function: name },
        ));
      }
    }
    Object.values(project?.pins || {}).forEach(pin => {
      if ([35, 36, 37, 38].includes(Number(pin?.gpio_num)) &&
          pin?.direction === 'output') {
        findings.push(finding(
          'WARNING',
          'JTAG_OUTPUT_RISK',
          `GPIO${pin.gpio_num} 与 JTAG 共享；调试连接有效时配置为普通输出存在风险`,
          { pin: pin.physical_pin, function: pin.function },
        ));
      }
    });
    return { claims, findings };
  }

  return { claim, claimsForProject, detectConflicts };
});
