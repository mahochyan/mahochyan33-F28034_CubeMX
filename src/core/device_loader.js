/* Relative-path device loader for GitHub Pages subpaths. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeviceLoader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function buildReverseIndex(pinmux) {
    const result = {};
    Object.values(pinmux?.pins || {}).forEach(def => {
      (def.mux_options || []).forEach(option => {
        (result[option.function] = result[option.function] || []).push({
          physical_pin: Number(def.physical_pin),
          mux: Number(option.mux),
          type: option.type,
          signal_verified: !!option.signal_verified,
          mux_value_verified: !!option.mux_value_verified,
          pin_config_supported: !!option.pin_config_supported,
          peripheral_init_supported: !!option.peripheral_init_supported,
          generator_profile: option.generator_profile || null,
        });
      });
    });
    Object.values(result).forEach(entries =>
      entries.sort((a, b) => a.physical_pin - b.physical_pin || a.mux - b.mux));
    return result;
  }

  async function readJson(fetcher, url) {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`${url} 加载失败：HTTP ${response.status}`);
    return response.json();
  }

  async function loadDeviceData(
    device = 'TMS320F28034',
    fetcher = fetch,
    basePath = './src/devices',
  ) {
    const base = `${basePath.replace(/\/$/, '')}/${encodeURIComponent(device)}`;
    const [deviceInfo, pinmux, golden, family, constraints, wizards, packageData] =
      await Promise.all([
        readJson(fetcher, `${base}/device.json`),
        readJson(fetcher, `${base}/pinmux.json`),
        readJson(fetcher, `${base}/pinmux_golden.json`),
        readJson(fetcher, `${base}/family.json`),
        readJson(fetcher, `${base}/constraints.json`),
        readJson(fetcher, `${base}/wizard_schema.json`),
        readJson(fetcher, `${base}/packages/pnt80.json`),
      ]);
    return {
      device,
      deviceInfo,
      pinmux,
      golden,
      family,
      constraints,
      wizards,
      packageData,
      reverseIndex: buildReverseIndex(pinmux),
    };
  }

  return { buildReverseIndex, loadDeviceData };
});
