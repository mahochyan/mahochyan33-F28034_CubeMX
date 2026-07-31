const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./r33_fixture.cjs');
const Checker = require('../src/core/constraint_checker.js');
const Peripheral = require('../src/core/peripheral_constraints.js');

const {
  Project, pinmux, family, signalGroups, internalRoutes, context,
  editor, plan, commit,
} = fixture;

test('device graph exposes all four semantic layers', () => {
  assert.ok(Object.keys(fixture.peripheralInstances.instances).length >= 20);
  assert.ok(Object.keys(signalGroups.groups).length >= 10);
  assert.ok(Object.keys(internalRoutes.adc_triggers).length >= 18);
  const project = Project.createEmptyProject();
  project.i2c_modules.I2CA = {
    role: 'master', bus_hz: 100000, signals: {},
  };
  const claims = require('../src/core/resource_graph.js').claimsForProject(project);
  assert.ok(claims.some(item => item.kind === 'peripheral_instance'));
  assert.ok(claims.some(item => item.kind === 'clock_domain'));
});

test('I2CA transaction commits SDA and SCL as one module object', () => {
  const project = commit(
    Project.createEmptyProject(),
    editor('SCLA', 3, {
      role: 'master', pin_sda: 2, pin_scl: 3, bus_hz: 100000,
    }),
  );
  assert.deepEqual(
    Object.keys(project.i2c_modules.I2CA.signals).sort(), ['scl', 'sda']);
  assert.equal(project.pins['2'].module, 'I2CA');
  assert.equal(project.pins['3'].module, 'I2CA');
  assert.equal(Checker.validateProject(project, pinmux, family, context).ok, true);
});

test('I2CA missing its paired signal cannot commit', () => {
  const transaction = plan(
    Project.createEmptyProject(),
    editor('SCLA', 3, { role: 'master', bus_hz: 100000 }),
  );
  assert.equal(transaction.ok, false);
  assert.match(transaction.errors.join('；'), /缺少 SDAA/);
});

test('SPI cannot mix SPIA and SPIB signals and 3-wire releases unused data line', () => {
  const mixed = Project.createEmptyProject();
  mixed.spi_modules.SPIA = {
    role: 'master', wire_mode: '4wire', data_mode: 'full_duplex',
    ste_strategy: 'no_cs', baud_hz: 1000000, lspclk_hz: 15000000,
    signals: {
      clk: { function: 'SPICLKA', physical_pin: 41 },
      simo: { function: 'SPISIMOB', physical_pin: 38 },
      somi: { function: 'SPISOMIA', physical_pin: 42 },
    },
  };
  let result = Peripheral.validateProject(mixed, { internalRoutes });
  assert.ok(result.findings.some(item => item.rule === 'SIGNAL_INSTANCE_MIXED'));

  const valid = commit(
    Project.createEmptyProject(),
    editor('SPICLKA', 41, {
      role: 'master', wire_mode: '3wire', data_mode: 'full_duplex',
      ste_strategy: 'no_cs', pin_clk: 41, pin_simo: 46,
      baud_hz: 1000000, lspclk_hz: 15000000,
    }),
  );
  assert.ok(valid.spi_modules.SPIA.signals.simo);
  assert.equal(valid.spi_modules.SPIA.signals.somi, undefined);
});

test('SCIA, CANA, eQEP and eCAP enforce module-mode requirements', () => {
  const sciTx = commit(
    Project.createEmptyProject(),
    editor('SCITXDA', 34, { mode: 'tx_only', pin_tx: 34, baud: 115200 }),
  );
  assert.equal(Checker.validateProject(sciTx, pinmux, family, context).ok, true);

  const sciBad = Project.createEmptyProject();
  sciBad.sci_modules.SCIA = {
    mode: 'full_duplex', baud: 115200,
    signals: { tx: { function: 'SCITXDA', physical_pin: 34 } },
  };
  assert.ok(Peripheral.validateProject(sciBad, { internalRoutes }).findings
    .some(item => item.rule === 'SIGNAL_GROUP_INCOMPLETE'));

  const loopback = commit(
    Project.createEmptyProject(),
    editor('CANTXA', 32, {
      mode: 'self_test_loopback', baud_hz: 500000,
      brp: 5, sjw: 1, tseg1: 8, tseg2: 3,
    }),
  );
  assert.deepEqual(loopback.can_modules.CANA.signals, {});
  assert.equal(Object.keys(loopback.pins).length, 0);

  const eqep = Project.createEmptyProject();
  eqep.eqep_modules.EQEP1 = {
    mode: 'quadrature',
    signals: {
      a: { function: 'EQEP1A', qualification: 'async' },
      b: { function: 'EQEP1B', qualification: 'sync' },
    },
  };
  assert.ok(Peripheral.validateProject(eqep, { internalRoutes }).findings
    .some(item => item.rule === 'EQEP_ASYNC_FORBIDDEN'));

  const ecap = Project.createEmptyProject();
  ecap.ecap_modules.ECAP1 = {
    mode: 'capture', capture: true, apwm: true,
    signals: { io: { function: 'ECAP1' } },
  };
  assert.ok(Peripheral.validateProject(ecap, { internalRoutes }).findings
    .some(item => item.rule === 'ECAP_MODE_CONFLICT'));
});

test('LINA mode is one exclusive scalar and cannot enable LIN plus SCI compatibility', () => {
  const project = Project.createEmptyProject();
  project.lin_modules.LINA = {
    mode: 'lin+sci_compat',
    direction: 'full_duplex',
    signals: {
      tx: { function: 'LINTXA', physical_pin: 34 },
      rx: { function: 'LINRXA', physical_pin: 33 },
    },
  };
  const findings = Peripheral.validateProject(project, { internalRoutes }).findings;
  assert.ok(findings.some(item => item.rule === 'LIN_MODE'));
});

test('CANA normal rejects either missing TX or missing RX while loopback remains pinless', () => {
  for (const missing of ['tx', 'rx']) {
    const project = Project.createEmptyProject();
    project.can_modules.CANA = {
      mode: 'normal',
      brp: 5, sjw: 1, tseg1: 8, tseg2: 3,
      signals: missing === 'tx'
        ? { rx: { function: 'CANRXA', physical_pin: 33 } }
        : { tx: { function: 'CANTXA', physical_pin: 32 } },
    };
    const findings = Peripheral.validateProject(project, { internalRoutes }).findings;
    assert.ok(findings.some(item =>
      item.rule === 'SIGNAL_GROUP_INCOMPLETE' && item.role === missing));
  }

  const loopback = Project.createEmptyProject();
  loopback.can_modules.CANA = {
    mode: 'self_test_loopback',
    brp: 5, sjw: 1, tseg1: 8, tseg2: 3,
    signals: {},
  };
  const findings = Peripheral.validateProject(loopback, { internalRoutes }).findings;
  assert.equal(findings.some(item =>
    item.rule === 'SIGNAL_GROUP_INCOMPLETE'), false);
});

test('EQEP1 quadrature rejects either missing A or missing B', () => {
  for (const missing of ['a', 'b']) {
    const project = Project.createEmptyProject();
    project.eqep_modules.EQEP1 = {
      mode: 'quadrature',
      signals: missing === 'a'
        ? { b: { function: 'EQEP1B', qualification: 'sync' } }
        : { a: { function: 'EQEP1A', qualification: 'sync' } },
    };
    const findings = Peripheral.validateProject(project, { internalRoutes }).findings;
    assert.ok(findings.some(item =>
      item.rule === 'SIGNAL_GROUP_INCOMPLETE' && item.role === missing));
  }
});

test('schema-v1 migration is explicit and preserves ADC as a SOC collection', () => {
  const migrated = Project.normalizeProject({
    schema_version: 1,
    device: 'TMS320F28034',
    package: 'PNT80',
    pins: {},
    adc: {
      soc: 4, physical_pin: 18, channel: 'ADCINA0',
      trigger: 'SOFTWARE', acqps: 14, interrupt: 'ADCINT1',
    },
  });
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.adc.socs.SOC4.channel, 'ADCINA0');
  assert.equal(migrated.migration_history[0].from_schema, 1);
  assert.equal(migrated.migration_history[0].to_schema, 2);
});
