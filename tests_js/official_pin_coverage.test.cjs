const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEVICE = path.join(
  ROOT, 'devices', 'ti', 'c2000', 'parts', 'tms320f28034',
);
const golden = JSON.parse(fs.readFileSync(
  path.join(DEVICE, 'official_pin_golden.json'), 'utf8',
));
const runtime = JSON.parse(fs.readFileSync(
  path.join(DEVICE, 'pinmux.json'), 'utf8',
));
const packageData = JSON.parse(fs.readFileSync(
  path.join(DEVICE, 'packages', 'pnt80.json'), 'utf8',
));

function runtimeOfficialFunctions(def) {
  return new Set(def.official_functions || []);
}

test('SPRS584Q official source names all five mandatory tables/figure', () => {
  assert.equal(golden.source.document, 'SPRS584Q');
  assert.equal(golden.source.revision, 'Q');
  assert.equal(golden.source.sections.physical_package, 'Figure 5-3');
  assert.equal(golden.source.sections.signal_descriptions, 'Table 5-1');
  assert.equal(golden.source.sections.gpioa_mux, 'Table 7-40');
  assert.equal(golden.source.sections.gpiob_mux, 'Table 7-41');
  assert.equal(golden.source.sections.analog_mux, 'Table 7-42');
  assert.match(golden.source.url, /^https:\/\/www\.ti\.com\//);
});
test('physical PN80 coverage is exactly Pin1 through Pin80 with no signal gaps', () => {
  const expectedPins = golden.physical_pins.map(item => item.physical_pin);
  const runtimePins = Object.keys(runtime.pins).map(Number);
  assert.deepEqual(expectedPins, Array.from({ length: 80 }, (_, index) => index + 1));
  assert.deepEqual(runtimePins, expectedPins);
  assert.equal(new Set(runtimePins).size, 80);
  assert.equal(packageData.total_pins, 80);
  assert.equal(packageData.pins.length, 80);

  for (const expected of golden.physical_pins) {
    const def = runtime.pins[String(expected.physical_pin)];
    assert.ok(def, `Pin${expected.physical_pin}`);
    assert.deepEqual(
      runtimeOfficialFunctions(def),
      new Set(expected.official_functions),
      `Pin${expected.physical_pin} visible official functions`,
    );
  }
});

test('all configurable pins have at least one runtime function and fixed pins are read-only', () => {
  for (const [pin, def] of Object.entries(runtime.pins)) {
    const routes = [
      ...(def.mux_options || []),
      ...(def.analog_paths || []),
      ...(def.aio_function ? [def.aio_function] : []),
      ...(def.special_routes || []),
      ...(def.capabilities || []),
      ...(def.boot_roles || []),
      ...(def.fixed_function ? [def.fixed_function] : []),
    ];
    if (def.configurable) {
      assert.ok(routes.length > 0, `P0: Pin${pin} configurable=true but empty`);
    } else {
      assert.equal(def.fixed, true, `Pin${pin} fixed flag`);
      assert.equal(def.fixed_function.support.fixed_pin, true, `Pin${pin} fixed role`);
      assert.equal(def.fixed_function.read_only_special_role, true, `Pin${pin} read-only`);
    }
  }
});

test('GPIO0 through GPIO44 preserve four slots and match 127 non-Reserved entries', () => {
  assert.equal(Object.keys(golden.gpio_slots).length, 45);
  for (let gpio = 0; gpio <= 44; gpio += 1) {
    assert.deepEqual(
      Object.keys(golden.gpio_slots[`GPIO${gpio}`]),
      ['0', '1', '2', '3'],
      `GPIO${gpio} four slots`,
    );
  }
  const expected = new Map(golden.options.map(entry => [
    `${entry.gpio}:${entry.mux}`, entry.function,
  ]));
  const actual = new Map();
  for (const def of Object.values(runtime.pins)) {
    for (const option of def.mux_options || []) {
      actual.set(`${def.gpio_num}:${option.mux}`, option.function);
    }
  }
  assert.equal(expected.size, 127);
  assert.equal(actual.size, 127);
  assert.deepEqual(actual, expected);
});
