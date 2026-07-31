const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./r33_fixture.cjs');

const {
  Project, Codegen, context, editor, commit,
} = fixture;

test('multi-SOC ADC generation retains SOC0 and SOC1 deterministically', () => {
  let project = commit(
    Project.createEmptyProject(),
    editor('ADCINA0', 18, {
      soc: 0, trigger: 'SOFTWARE', acqps: 14, interrupt: 'ADCINT1',
    }),
  );
  project = commit(project, editor('ADCINB0', 23, {
    soc: 1, trigger: 'SOFTWARE', acqps: 20, interrupt: 'ADCINT2',
  }));
  const first = Codegen.generateProject(project, context);
  const second = Codegen.generateProject(project, context);
  assert.equal(first.files['adc_init.c'], second.files['adc_init.c']);
  assert.match(first.files['adc_init.c'], /ADCSOC0CTL/);
  assert.match(first.files['adc_init.c'], /ADCSOC1CTL/);
  assert.match(first.files['adc_init.c'], /INT1SEL = 0U/);
  assert.match(first.files['adc_init.c'], /INT2SEL = 1U/);
});

test('cross-module full regeneration keeps PWM and adds complete I2C files', () => {
  let project = commit(Project.createEmptyProject(), editor('EPWM1A', 69, {
    mode: 'single', frequency_hz: 100000, count_mode: 'up_down',
    duty: 0.5, aq_profile: 'set_cau_clear_cad',
    trip_enabled: false,
  }));
  const before = Codegen.generateProject(project, context);
  project = commit(project, editor('SCLA', 3, {
    role: 'master', pin_sda: 2, pin_scl: 3, bus_hz: 100000,
  }));
  const after = Codegen.generateProject(project, context);
  assert.equal(after.files['pwm_init.c'], before.files['pwm_init.c']);
  assert.ok(after.files['i2c_init.c']);
  assert.match(after.files['pinmux_init.c'], /SDAA/);
  assert.match(after.files['pinmux_init.c'], /SCLA/);
  assert.match(after.files['generated_init_all.c'], /Generated_I2c_Init/);
  const diff = Codegen.diffGeneratedFiles(before.files, after.files);
  assert.ok(diff.added.includes('i2c_init.c'));
  assert.ok(diff.modified.includes('pinmux_init.c'));
});

test('removing a module clears owned pins and generated module code', () => {
  let project = commit(Project.createEmptyProject(), editor('SCLA', 3, {
    role: 'master', pin_sda: 2, pin_scl: 3, bus_hz: 100000,
  }));
  const before = Codegen.generateProject(project, context);
  project = Project.removeModuleAtomically(project, 'I2CA');
  const after = Codegen.generateProject(project, context);
  assert.equal(project.pins['2'], undefined);
  assert.equal(project.pins['3'], undefined);
  assert.equal(after.files['i2c_init.c'], undefined);
  const diff = Codegen.diffGeneratedFiles(before.files, after.files);
  assert.ok(diff.removed.includes('i2c_init.c'));
});

test('generation manifest declares ProjectConfig-only full regeneration ownership', () => {
  const result = Codegen.generateProject(Project.createEmptyProject(), context);
  const manifest = JSON.parse(result.files['generation_manifest.json']);
  assert.equal(manifest.source_of_truth, 'ProjectConfig');
  assert.equal(manifest.generation_mode, 'deterministic_full_regeneration');
  assert.equal(manifest.project_schema_version, 2);
  assert.equal(manifest.ownership.adc, 'adc.socs');
});

test('ordinary GPIO accumulation and deletion are reflected by full regeneration', () => {
  let project = commit(
    Project.createEmptyProject(),
    editor('GPIO20', 78, {
      direction: 'output', initial_level: 'low', pullup: 'disable',
    }),
  );
  project = commit(project, editor('GPIO21', 79, {
    direction: 'output', initial_level: 'high', pullup: 'disable',
  }));
  let files = Codegen.generateProject(project, context).files;
  assert.match(files['pinmux_init.c'], /Pin78.*GPIO20/);
  assert.match(files['pinmux_init.c'], /Pin79.*GPIO21/);

  project = Project.removePinAtomically(project, 78);
  files = Codegen.generateProject(project, context).files;
  assert.doesNotMatch(files['pinmux_init.c'], /GPIO20/);
  assert.match(files['pinmux_init.c'], /GPIO21/);
});

test('JSON export/import round trip regenerates every file byte-identically', () => {
  let project = commit(
    Project.createEmptyProject(),
    editor('EPWM1A', 69, {
      mode: 'single', frequency_hz: 100000, count_mode: 'up_down',
      duty: 0.5, aq_profile: 'set_cau_clear_cad', trip_enabled: false,
    }),
  );
  project = commit(project, editor('SCLA', 3, {
    role: 'master', pin_sda: 2, pin_scl: 3, bus_hz: 100000,
  }));
  const before = Codegen.generateProject(project, context).files;
  const imported = Project.normalizeProject(JSON.parse(JSON.stringify(project)));
  const after = Codegen.generateProject(imported, context).files;
  assert.deepEqual(after, before);
});
