const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pinmux = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'src', 'devices', 'TMS320F28034', 'pinmux.json'), 'utf8',
));
const Loader = require('../src/core/device_loader.js');

test('JTAG has four special shared routes and zero GPBMUX candidates', () => {
  const expected = new Map([
    [57, 'TCK'], [58, 'TDO'], [59, 'TDI'], [60, 'TMS'],
  ]);
  for (const [pin, functionName] of expected) {
    const def = pinmux.pins[String(pin)];
    const route = def.special_routes.find(item => item.function === functionName);
    assert.ok(route, `Pin${pin}/${functionName}`);
    assert.equal(route.controlled_by, 'TRST');
    assert.equal(route.read_only_special_role, true);
    assert.equal(
      def.mux_options.some(item => item.function === functionName),
      false,
      `${functionName} must not be GPBMUX`,
    );
  }
});
test('XCLK routes have two inputs and one output requiring XCLKOUTDIV', () => {
  const clock = pinmux.special_routes;
  assert.deepEqual(
    clock.clock_input_route.sources.map(item => item.pin).sort((a, b) => a - b),
    [55, 57],
  );
  assert.equal(clock.clock_input_route.selector, 'XCLKINSEL');
  assert.deepEqual(clock.clock_output_route, {
    pin: 41,
    gpio: 18,
    function: 'XCLKOUT',
    mux: 3,
    additional_control: 'XCLKOUTDIV',
  });
});

test('XINT1-3 and low-power wake cover GPIO0 through GPIO31 exactly', () => {
  const expected = Array.from({ length: 32 }, (_, index) => index);
  assert.deepEqual(
    pinmux.special_routes.external_interrupts.routes,
    ['XINT1', 'XINT2', 'XINT3'],
  );
  assert.deepEqual(
    pinmux.special_routes.external_interrupts.source_gpios,
    expected,
  );
  assert.deepEqual(pinmux.special_routes.low_power_wake.source_gpios, expected);
  assert.deepEqual(pinmux.special_routes.low_power_wake.modes, ['STANDBY', 'HALT']);
});

test('boot roles are read-only metadata and appear in the reverse index', () => {
  const roles = pinmux.special_routes.boot_roles.map(item => item.role);
  assert.deepEqual(roles, [
    'BOOT_MODE_STRAP',
    'SCI_BOOT_RX',
    'SCI_BOOT_TX',
    'SPI_BOOT',
    'I2C_BOOT',
    'CAN_BOOT',
    'PARALLEL_BOOT',
    'AIO6_28X_CONTROL',
    'AIO12_HOST_CONTROL',
  ]);
  const index = Loader.buildReverseIndex(pinmux);
  for (const role of roles) {
    assert.ok(index[role]?.length > 0, role);
    assert.ok(index[role].every(item => item.read_only_special_role), role);
  }
});
