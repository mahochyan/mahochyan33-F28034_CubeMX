const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const MUX3_FIXES = [
  [1, 'COMP1OUT'], [8, 'ADCSOCAO'], [10, 'ADCSOCBO'], [13, 'SPISOMIB'],
  [16, 'TZ2N'], [17, 'TZ3N'], [20, 'COMP1OUT'], [21, 'COMP2OUT'],
  [22, 'LINTXA'], [23, 'LINRXA'], [24, 'SPISIMOB'], [25, 'SPISOMIB'],
  [26, 'SPICLKB'], [27, 'SPISTEB'], [34, 'COMP3OUT'],
  [42, 'COMP1OUT'], [43, 'COMP2OUT'],
];

function parseStoredZip(bytes) {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034B50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files[name] = decoder.decode(bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

async function waitReady(page) {
  await page.goto('./');
  await expect.poll(() => page.evaluate(
    () => document.documentElement.dataset.appReady,
  )).toBe('true');
}

async function finishWizard(page) {
  const wizard = page.locator('.inline-wizard');
  await expect(wizard).toBeVisible();
  for (let step = 0; step < 20; step += 1) {
    const finish = wizard.locator('[data-action="finish"]');
    if (await finish.count()) {
      await finish.click();
      return;
    }
    await wizard.locator('[data-action="next"]').click();
  }
  throw new Error('wizard did not reach summary');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
});

test('subpath boot uses only static assets and renders package-driven PNT80', async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('websocket', socket => errors.push(`unexpected socket ${socket.url()}`));

  await waitReady(page);
  await expect(page.locator('#chip-svg .pin')).toHaveCount(80);
  await expect(page.locator('#dataSource')).toContainText('MUX golden 127/127');
  expect(errors).toEqual([]);
  expect(requests.length).toBeGreaterThan(10);
  for (const url of requests) {
    const parsed = new URL(url);
    expect(parsed.pathname.startsWith('/test-repo/')).toBe(true);
    expect(parsed.pathname).not.toMatch(/\/api(?:\/|$)/i);
  }
  expect(requests.filter(url => new URL(url).pathname.endsWith('.json'))).toEqual([]);
  expect(requests.some(url => new URL(url).pathname.endsWith('/device_bundle.js')))
    .toBe(true);
});

test('Pin69 EPWM1A user flow commits A/B/Trip, persists and exports preview-identical ZIP',
  async ({ page }) => {
    await waitReady(page);
    await page.locator('#chip-svg .pin[data-pin="69"] .hit').click();
    const epwm = page.locator('.function-node[data-function="EPWM1A"]');
    await expect(epwm).toBeVisible();
    await epwm.locator('.function-row').click();
    await finishWizard(page);

    await expect(page.locator('#statusText')).toContainText('原子提交');
    await expect.poll(() => page.evaluate(() => Object.keys(Store.project.pins).sort()))
      .toEqual(['47', '68', '69']);
    const project = await page.evaluate(() => Store.exportConfig());
    expect(project.schema_version).toBe(1);
    expect(project.pwm_modules.EPWM1.pin_a).toBe(69);
    expect(project.pwm_modules.EPWM1.pin_b).toBe(68);
    expect(project.pwm_modules.EPWM1.trip.pin).toBe(47);

    await page.locator('#rightTabs [data-tab="code"]').click();
    await expect(page.locator('#codePanel')).toContainText('NOT APPROVED FOR POWER-STAGE ENABLE');
    await expect(page.locator('#codePanel')).toContainText('EPWM1_ReleaseClamp');
    await expect(page.locator('#codePanel')).toContainText('给初学者');
    await expect(page.locator('#codePanel')).toContainText('第 1 步');
    await expect(page.locator('#codePanel')).toContainText('第 6 步');

    const preview = await page.evaluate(() => ConfigStudioApp.getLatestPreview().files);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloadPromise;
    const downloaded = await download.path();
    const extracted = parseStoredZip(new Uint8Array(fs.readFileSync(downloaded)));
    expect(extracted).toEqual(preview);

    await page.reload();
    await expect.poll(() => page.evaluate(
      () => document.documentElement.dataset.appReady,
    )).toBe('true');
    await expect.poll(() => page.evaluate(() => Store.project.pwm_modules.EPWM1?.pin_b))
      .toBe(68);
  });

test('SCLA pinmux-only user flow produces no ADC file and JSON import restores project',
  async ({ page }) => {
    await waitReady(page);
    await page.locator('#chip-svg .pin[data-pin="3"] .hit').click();
    const scla = page.locator('.function-node[data-function="SCLA"]');
    await expect(scla).toBeVisible();
    await scla.locator('.function-row').click();
    await finishWizard(page);
    await expect.poll(() => page.evaluate(() => Store.project.pins['3']?.function))
      .toBe('SCLA');
    const files = await page.evaluate(() => Object.keys(
      ConfigStudioApp.getLatestPreview().files,
    ));
    expect(files).toContain('pinmux_init.c');
    expect(files).not.toContain('adc_init.c');

    const jsonDownloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportJSON').click();
    const jsonDownload = await jsonDownloadPromise;
    const jsonPath = await jsonDownload.path();

    page.on('dialog', dialog => dialog.accept());
    await page.locator('#btnClearAll').click();
    await expect.poll(() => page.evaluate(() => Object.keys(Store.project.pins).length))
      .toBe(0);
    await page.locator('#importJSON').setInputFiles(jsonPath);
    await expect.poll(() => page.evaluate(() => Store.project.pins['3']?.function))
      .toBe('SCLA');
  });

test('browser-loaded golden data contains all 17 MUX3 corrections and no JTAG candidates',
  async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(fixes => {
      const missing = [];
      for (const [gpio, expected] of fixes) {
        const def = Object.values(Store.pinmux.pins)
          .find(item => Number(item.gpio_num) === gpio);
        const normalize = value => String(value).toUpperCase().replace(/N$/, '');
        const option = (def?.mux_options || []).find(item =>
          normalize(item.function) === normalize(expected));
        if (!option || Number(option.mux) !== 3) {
          missing.push({ gpio, expected, actual: option?.mux });
        }
      }
      const jtag = Object.values(Store.pinmux.pins).flatMap(def =>
        (def.mux_options || [])
          .filter(option => ['TDI', 'TMS', 'TDO', 'TCK'].includes(option.function))
          .map(option => ({ gpio: def.gpio_num, function: option.function })));
      return { missing, jtag };
    }, MUX3_FIXES);
    expect(result.missing).toEqual([]);
    expect(result.jtag).toEqual([]);
  });

test('Trip resource conflict leaves both memory and localStorage unchanged',
  async ({ page }) => {
    await waitReady(page);
    const occupiedProject = await page.evaluate(() => {
      const project = ProjectConfigCore.createEmptyProject();
      for (const physicalPin of [47, 75]) {
        const def = Store.pinDef(physicalPin);
        const option = def.mux_options.find(item => item.mux === 0);
        project.pins[String(physicalPin)] = {
          physical_pin: physicalPin,
          signal: def.primary_signal,
          gpio_num: def.gpio_num,
          mux: 0,
          function: option.function,
          type: option.type,
          signal_verified: true,
          mux_value_verified: true,
          pin_config_supported: true,
          peripheral_init_supported: false,
          generator_profile: 'gpio_output',
          direction: 'output',
          initial_level: 'low',
          pullup: 'disable',
          qualification: 'sync',
        };
      }
      Store.importJSON(JSON.stringify(project));
      return Store.exportJSON();
    });
    await page.locator('#chip-svg .pin[data-pin="69"] .hit').click();
    await page.locator('.function-node[data-function="EPWM1A"] .function-row').click();
    await finishWizard(page);
    await expect(page.locator('#statusText')).toContainText('没有空闲物理脚');
    expect(await page.evaluate(() => Store.exportJSON())).toBe(occupiedProject);
    expect(await page.evaluate(
      () => JSON.parse(localStorage.getItem('c2000.config.r3.2')),
    )).toEqual(JSON.parse(occupiedProject));
  });
