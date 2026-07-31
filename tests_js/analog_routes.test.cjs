const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const pinmux = read('src/devices/TMS320F28034/pinmux.json');
const family = read('src/devices/TMS320F28034/family.json');
const signalGroups = read('src/devices/TMS320F28034/signal_groups.json');
const internalRoutes = read('src/devices/TMS320F28034/internal_routes.json');
const peripheralInstances =
  read('src/devices/TMS320F28034/peripheral_instances.json');
const Loader = require('../src/core/device_loader.js');
const Project = require('../src/core/project_config.js');
const Codegen = require('../src/core/codegen.js');
const index = Loader.buildReverseIndex(pinmux);
const context = {
  pinmux, family, signalGroups, internalRoutes, peripheralInstances,
};

function editor(functionId, physicalPin, draft = {}) {
  return {
    source: 'test',
    functionId,
    candidatePins: index[functionId],
    selectedPin: physicalPin,
    draft: { function: functionId, selectedPin: physicalPin, ...draft },
    stepIndex: 0,
    status: 'editing',
  };
}

test('Table 7-42 has 16 ADC, 6 comparator and 6 AIO routes with no extras', () => {
  const adc = [];
  const comparator = [];
  const aio = [];
  for (const def of Object.values(pinmux.pins)) {
    adc.push(...def.analog_paths.filter(item => item.type === 'adc_input'));
    comparator.push(...def.analog_paths.filter(item => item.type === 'comparator_input'));
    if (def.aio_function) aio.push(def.aio_function);
  }
  assert.equal(adc.length, 16);
  assert.equal(comparator.length, 6);
  assert.equal(aio.length, 6);
  assert.deepEqual(
    new Set(comparator.map(item => item.function)),
    new Set(['COMP1A', 'COMP1B', 'COMP2A', 'COMP2B', 'COMP3A', 'COMP3B']),
  );
  assert.deepEqual(
    new Set(aio.map(item => item.function)),
    new Set(['AIO2', 'AIO4', 'AIO6', 'AIO10', 'AIO12', 'AIO14']),
  );
});
test('Pin12 models ADCINA6 and COMP3A in parallel plus independent AIO6', () => {
  const pin12 = pinmux.pins['12'];
  assert.deepEqual(
    pin12.analog_paths.map(item => item.function),
    ['ADCINA6', 'COMP3A'],
  );
  assert.ok(pin12.analog_paths.every(item => item.always_available));
  assert.equal(pin12.aio_function.function, 'AIO6');
  assert.equal(pin12.aio_function.aiomux_field, 'GpioCtrlRegs.AIOMUX1.bit.AIO6');
  assert.equal(pin12.mux_options.length, 0);
});

test('ADC transaction generates SOC and ADCINT but no GPIO register writes', () => {
  const blank = Project.createEmptyProject();
  const plan = Project.buildCommitPlan({
    project: blank,
    editor: editor('ADCINA6', 12, {
      soc: 3, trigger: 'EPWM1_SOCA', acqps: 14, interrupt: 'ADCINT1',
    }),
    pinmux,
    reverseIndex: index,
    signalGroups,
    internalRoutes,
  });
  assert.equal(plan.ok, true, plan.errors?.join('；'));
  const project = Project.applyAtomically(blank, plan);
  assert.equal(project.adc.socs.SOC3.channel, 'ADCINA6');
  assert.equal(project.adc.socs.SOC3.physical_pin, 12);
  assert.equal(Object.keys(project.pins).length, 0);
  project.pwm_modules.EPWM1 = {
    mode: 'single', pin_a: 69, pin_b: null, count_mode: 'up_down',
    frequency_hz: 100000, duty: 0.5, aq_profile: 'set_cau_clear_cad',
    deadband: { enabled: false }, trip_route_ids: [],
  };
  project.pwm_event_triggers.EPWM1 = {
    SOCA: { enabled: true, source: 4, prescale: 1 },
  };
  const result = Codegen.generateProject(project, context);
  assert.match(result.files['adc_init.c'], /ADCSOC3CTL\.bit\.CHSEL/);
  assert.match(result.files['adc_init.c'], /INTSEL1N2\.bit\.INT1SEL/);
  assert.doesNotMatch(result.files['adc_init.c'], /GPA(?:MUX|DIR|PUD)/);
  assert.doesNotMatch(result.files['pinmux_init.c'], /Pin12/);
});

test('Comparator input is saved as pin-path-only and never enters GPIO pinmux', () => {
  const blank = Project.createEmptyProject();
  const plan = Project.buildCommitPlan({
    project: blank,
    editor: editor('COMP3A', 12),
    pinmux,
    reverseIndex: index,
    signalGroups,
    internalRoutes,
  });
  assert.equal(plan.ok, true, plan.errors?.join('；'));
  const project = Project.applyAtomically(blank, plan);
  assert.equal(project.comparators.COMP3.positive.function, 'COMP3A');
  assert.equal(project.comparators.COMP3.positive.physical_pin, 12);
  assert.equal(Object.keys(project.pins).length, 0);
  const result = Codegen.generateProject(project, context);
  assert.doesNotMatch(result.files['pinmux_init.c'], /Pin12/);
  assert.match(result.files['comparator_init.c'], /Comp3Regs/);
});

test('AIO generation uses only AIOMUX/AIODIR/AIO data fields', () => {
  const blank = Project.createEmptyProject();
  const plan = Project.buildCommitPlan({
    project: blank,
    editor: editor('AIO6', 12, {
      direction: 'output', initial_level: 'low',
    }),
    pinmux,
    reverseIndex: index,
    signalGroups,
    internalRoutes,
  });
  assert.equal(plan.ok, true, plan.errors?.join('；'));
  const project = Project.applyAtomically(blank, plan);
  const result = Codegen.generateProject(project, context);
  const source = result.files['pinmux_init.c'];
  assert.match(source, /GpioCtrlRegs\.AIOMUX1\.bit\.AIO6 = 0U/);
  assert.match(source, /GpioCtrlRegs\.AIODIR\.bit\.AIO6 = 1U/);
  assert.match(source, /GpioDataRegs\.AIOCLEAR\.bit\.AIO6 = 1U/);
  assert.doesNotMatch(source, /GpioCtrlRegs\.GPA(?:MUX|DIR|PUD)\w*\.bit\.AIO6\s*=/);
});
