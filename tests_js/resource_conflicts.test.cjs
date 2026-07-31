const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./r33_fixture.cjs');
const Graph = require('../src/core/resource_graph.js');
const Peripheral = require('../src/core/peripheral_constraints.js');

const { Project, internalRoutes } = fixture;

test('HRCAP calibration and application EPWM7 are an automatic ERROR', () => {
  const project = Project.createEmptyProject();
  project.pwm_modules.EPWM7 = {
    mode: 'single', pin_a: 44, pin_b: null,
    frequency_hz: 100000, duty: 0.5,
  };
  project.hrcap_modules.HRCAP1 = {
    mode: 'high_resolution',
    calibration: {
      mode: 'runtime', hrcap_instance: 'HRCAP2', library: 'TI_HCCal',
    },
    signals: { input: { function: 'HRCAP1', physical_pin: 37 } },
  };
  const result = Peripheral.validateProject(project, { internalRoutes });
  const conflict = result.findings.find(item =>
    item.rule === 'RESOURCE_CONFLICT' &&
    item.resource === 'SHARED.EPWM7_CALIBRATION');
  assert.ok(conflict);
  assert.deepEqual(conflict.owners.sort(), ['EPWM7', 'HRCAP1.CALIBRATION']);
});

test('ordinary HRCAP capture does not claim the EPWM7 calibration resource', () => {
  const project = Project.createEmptyProject();
  project.pwm_modules.EPWM7 = { mode: 'single' };
  project.hrcap_modules.HRCAP1 = {
    mode: 'capture',
    calibration: { mode: 'none' },
    signals: { input: { function: 'HRCAP1', physical_pin: 37 } },
  };
  const result = Graph.detectConflicts(project);
  assert.equal(result.findings
    .some(item => item.resource === 'SHARED.EPWM7_CALIBRATION'), false);
});

test('EPWM SOCA, comparator Trip and internal PWM sync never claim a pin', () => {
  const project = Project.createEmptyProject();
  project.pwm_event_triggers.EPWM1 = {
    SOCA: { enabled: true, source: 4, prescale: 1 },
  };
  project.adc.socs.SOC0 = {
    soc: 0, channel: 'ADCINA0', trigger: 'EPWM1_SOCA', acqps: 14,
  };
  project.trip_routes.COMP_TRIP = {
    source_kind: 'comparator', source: 'COMP1OUT', source_pin: null,
    targets: ['EPWM1'], mode: 'one_shot',
  };
  project.pwm_sync_graph.EPWM2 = {
    role: 'slave', sync_source: 'EPWM1',
  };
  const internalClaims = Graph.claimsForProject(project)
    .filter(item => ['internal_trigger'].includes(item.kind));
  assert.ok(internalClaims.length >= 3);
  assert.ok(internalClaims.every(item => item.physical_pin == null));
});

test('ADC EPWM trigger requires its source PWM event to be fully enabled', () => {
  const project = Project.createEmptyProject();
  project.pwm_modules.EPWM1 = {
    mode: 'single', pin_a: 69, frequency_hz: 100000, duty: 0.5,
  };
  project.adc.socs.SOC0 = {
    soc: 0, channel: 'ADCINA0', trigger: 'EPWM1_SOCA', acqps: 14,
  };
  let findings = Peripheral.validateProject(project, { internalRoutes }).findings;
  assert.ok(findings.some(item => item.rule === 'ADC_EPWM_TRIGGER_INCOMPLETE'));

  project.pwm_event_triggers.EPWM1 = {
    SOCA: { enabled: true, source: 'CTR_ZERO', prescale: 1 },
  };
  findings = Peripheral.validateProject(project, { internalRoutes }).findings;
  assert.equal(findings.some(item =>
    item.rule === 'ADC_EPWM_TRIGGER_INCOMPLETE'), false);
});

test('one internal comparator Trip source may protect multiple configured PWM targets', () => {
  const project = Project.createEmptyProject();
  project.pwm_modules.EPWM1 = {
    mode: 'single', pin_a: 69, frequency_hz: 100000, duty: 0.5,
  };
  project.pwm_modules.EPWM2 = {
    mode: 'single', pin_a: 72, frequency_hz: 100000, duty: 0.5,
  };
  project.comparators.COMP1 = {
    positive: { kind: 'external', function: 'COMP1A', physical_pin: 16 },
    negative: { kind: 'internal_dac', value: 512 },
  };
  project.trip_routes.PRIMARY_OCP = {
    source_kind: 'comparator',
    source: 'COMP1OUT',
    source_pin: null,
    targets: ['EPWM1', 'EPWM2'],
    mode: 'one_shot',
  };
  const result = Peripheral.validateProject(project, { internalRoutes });
  assert.equal(result.findings.some(item =>
    item.rule.startsWith('TRIP_')), false);
  const claim = result.claims.find(item =>
    item.kind === 'internal_trigger' && item.owner === 'TRIP.PRIMARY_OCP');
  assert.deepEqual(project.trip_routes.PRIMARY_OCP.targets, ['EPWM1', 'EPWM2']);
  assert.equal(claim.physical_pin, null);
});

test('ePWM sync graph rejects a cycle', () => {
  const project = Project.createEmptyProject();
  project.pwm_sync_graph = {
    EPWM1: { role: 'slave', sync_source: 'EPWM2', phase_ticks: 0 },
    EPWM2: { role: 'slave', sync_source: 'EPWM1', phase_ticks: 0 },
  };
  const findings = Peripheral.validateProject(project, { internalRoutes }).findings;
  assert.ok(findings.some(item => item.rule === 'PWM_SYNC_CYCLE'));
});
