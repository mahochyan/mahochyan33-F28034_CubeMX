const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
global.DeterministicJSON = require('../src/core/deterministic_json.js');
const Core = require('../src/core/project_config.js');
const pinmux = JSON.parse(fs.readFileSync(
  path.join(root, 'src/devices/TMS320F28034/pinmux.json'), 'utf8'));

function reverseIndex() {
  const index = {};
  for (const def of Object.values(pinmux.pins)) {
    for (const option of def.mux_options || []) {
      (index[option.function] ||= []).push({
        physical_pin: def.physical_pin,
        mux: option.mux,
        type: option.type,
        signal_verified: option.signal_verified,
        mux_value_verified: option.mux_value_verified,
        pin_config_supported: option.pin_config_supported,
        peripheral_init_supported: option.peripheral_init_supported,
      });
    }
  }
  return index;
}

const index = reverseIndex();

function epwmEditor(overrides = {}) {
  return {
    source: 'tree',
    functionId: 'EPWM1A',
    candidatePins: index.EPWM1A,
    selectedPin: 69,
    status: 'editing',
    draft: {
      function: 'EPWM1A',
      selectedPin: 69,
      mode: 'complementary',
      frequency_hz: 100000,
      count_mode: 'up_down',
      duty: 0.5,
      aq_profile: 'set_cau_clear_cad',
      red_ns: 200,
      fed_ns: 200,
      trip_enabled: true,
      trip_source: 'TZ1',
      trip_mode: 'one_shot',
      ...overrides,
    },
  };
}

test('successful complementary commit is one complete ProjectConfig', () => {
  const current = Core.createEmptyProject();
  const plan = Core.buildCommitPlan({
    project: current, editor: epwmEditor(), pinmux, reverseIndex: index,
  });
  assert.equal(plan.ok, true, plan.errors?.join('; '));
  const next = Core.applyAtomically(current, plan);
  assert.equal(next.schema_version, 1);
  assert.equal(next.pwm_modules.EPWM1.pin_a, 69);
  assert.equal(next.pwm_modules.EPWM1.pin_b, 68);
  assert.equal(next.pwm_modules.EPWM1.trip.pin, 47);
  assert.equal(Object.keys(current.pins).length, 0, 'input object must stay unchanged');
});

test('trip conflict changes neither current ProjectConfig nor plan state', () => {
  const current = Core.createEmptyProject();
  for (const physicalPin of [47, 75]) {
    current.pins[String(physicalPin)] = {
      physical_pin: physicalPin, function: 'GPIO',
    };
  }
  const before = JSON.stringify(current);
  const plan = Core.buildCommitPlan({
    project: current, editor: epwmEditor(), pinmux, reverseIndex: index,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(' '), /TZ1.*没有空闲/);
  assert.equal(JSON.stringify(current), before);
  assert.equal(plan.nextProject, null);
});

test('editing complementary to single removes old B and old trip', () => {
  const firstPlan = Core.buildCommitPlan({
    project: Core.createEmptyProject(), editor: epwmEditor(),
    pinmux, reverseIndex: index,
  });
  const configured = Core.applyAtomically(Core.createEmptyProject(), firstPlan);
  const editor = epwmEditor({
    editingPin: 69,
    mode: 'single',
    trip_enabled: false,
  });
  const plan = Core.buildCommitPlan({
    project: configured, editor, pinmux, reverseIndex: index,
  });
  assert.equal(plan.ok, true, plan.errors?.join('; '));
  const next = Core.applyAtomically(configured, plan);
  assert.ok(next.pins['69']);
  assert.equal(next.pins['68'], undefined);
  assert.equal(next.pins['47'], undefined);
  assert.equal(next.pwm_modules.EPWM1.pin_b, null);
  assert.deepEqual(next.pwm_modules.EPWM1.trip, { enabled: false });
});

test('editing TZ1 to TZ2 removes old trip pin and assigns a TZ2 pin', () => {
  const blank = Core.createEmptyProject();
  const first = Core.buildCommitPlan({
    project: blank, editor: epwmEditor(), pinmux, reverseIndex: index,
  });
  const configured = Core.applyAtomically(blank, first);
  const editor = epwmEditor({
    editingPin: 69,
    trip_source: 'TZ2',
  });
  const changed = Core.buildCommitPlan({
    project: configured, editor, pinmux, reverseIndex: index,
  });
  assert.equal(changed.ok, true, changed.errors?.join('; '));
  const next = Core.applyAtomically(configured, changed);
  assert.equal(next.pins['47'], undefined);
  assert.equal(next.pwm_modules.EPWM1.trip.source, 'TZ2');
  assert.equal(next.pins[String(next.pwm_modules.EPWM1.trip.pin)].function, 'TZ2N');
});

test('stale plan is rejected atomically', () => {
  const current = Core.createEmptyProject();
  const plan = Core.buildCommitPlan({
    project: current, editor: epwmEditor(), pinmux, reverseIndex: index,
  });
  current.pins['1'] = { physical_pin: 1, function: 'GPIO22' };
  assert.throws(() => Core.applyAtomically(current, plan), /已变化/);
});
