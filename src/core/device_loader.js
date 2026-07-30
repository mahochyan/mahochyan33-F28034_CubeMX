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

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function readJson(fetcher, url) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const separator = url.includes('?') ? '&' : '?';
        const response = await fetcher(`${url}${separator}attempt=${attempt}`, {
          cache: attempt === 1 ? 'default' : 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < 3) await wait(attempt * 250);
      }
    }
    throw new Error(
      `${url} 加载失败（已重试 3 次）：${lastError?.message || '网络错误'}`,
    );
  }

  async function loadDeviceData(
    device = 'TMS320F28034',
    fetcher = fetch,
    basePath = './src/devices',
  ) {
    const embedded = globalThis.__F28034_DEVICE_BUNDLE__;
    if (embedded && embedded.device === device) {
      return {
        ...embedded,
        reverseIndex: buildReverseIndex(embedded.pinmux),
      };
    }
    const base = `${basePath.replace(/\/$/, '')}/${encodeURIComponent(device)}`;
    // Development fallback. Sequential requests are friendlier to proxies than
    // seven simultaneous JSON connections.
    const deviceInfo = await readJson(fetcher, `${base}/device.json`);
    const pinmux = await readJson(fetcher, `${base}/pinmux.json`);
    const golden = await readJson(fetcher, `${base}/pinmux_golden.json`);
    const family = await readJson(fetcher, `${base}/family.json`);
    const constraints = await readJson(fetcher, `${base}/constraints.json`);
    const wizards = await readJson(fetcher, `${base}/wizard_schema.json`);
    const packageData = await readJson(fetcher, `${base}/packages/pnt80.json`);
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
