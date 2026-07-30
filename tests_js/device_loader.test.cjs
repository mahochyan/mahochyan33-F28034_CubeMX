const test = require('node:test');
const assert = require('node:assert/strict');

const Loader = require('../src/core/device_loader.js');

test('embedded production bundle starts without any runtime fetch call', async () => {
  global.__F28034_DEVICE_BUNDLE__ = {
    device: 'TMS320F28034',
    deviceInfo: { default_package: 'PNT80' },
    pinmux: {
      pins: {
        69: {
          physical_pin: 69,
          mux_options: [{
            mux: 1,
            function: 'EPWM1A',
            type: 'epwm',
            signal_verified: true,
            mux_value_verified: true,
            pin_config_supported: true,
            peripheral_init_supported: true,
          }],
        },
      },
    },
    golden: {},
    family: {},
    constraints: {},
    wizards: {},
    packageData: {},
  };
  let fetchCalls = 0;
  const result = await Loader.loadDeviceData(
    'TMS320F28034',
    async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run');
    },
  );
  assert.equal(fetchCalls, 0);
  assert.equal(result.reverseIndex.EPWM1A[0].physical_pin, 69);
  delete global.__F28034_DEVICE_BUNDLE__;
});
