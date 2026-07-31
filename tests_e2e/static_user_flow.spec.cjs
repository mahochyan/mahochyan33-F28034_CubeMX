const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

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
    const select = wizard.locator('select[data-field]');
    if (await select.count() && !(await select.inputValue())) {
      const options = select.locator('option:not([disabled])');
      if (await options.count() > 1) {
        await select.selectOption({ index: 1 });
      }
    }
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
  await expect(page.locator('#dataSource')).toContainText('PN80 80/80');
  await expect(page.locator('#dataSource')).toContainText('MUX 127/127');
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

test('pin click shows only its functions and Show All clears the selected pin',
  async ({ page }) => {
    await waitReady(page);
    const allFunctionCount = await page.locator('.function-node').count();
    const allGroupCount = await page.locator('.function-group').count();
    expect(allFunctionCount).toBeGreaterThan(40);
    expect(allGroupCount).toBeGreaterThan(10);

    await page.locator('#chip-svg .pin[data-pin="69"] .hit').click();
    await expect.poll(() => page.evaluate(() => Store.selectedPin)).toBe(69);
    await expect(page.locator('#chip-svg .pin[data-pin="69"]')).toHaveClass(/cur/);
    const visibleFunctions = await page.locator('.function-node:visible')
      .evaluateAll(nodes => nodes.map(node => node.dataset.function).sort());
    expect(visibleFunctions).toEqual([
      'EPWM1A', 'GPIO0', 'HALT_WAKE', 'HRPWM1A', 'PARALLEL_BOOT',
      'STANDBY_WAKE', 'XINT1', 'XINT2', 'XINT3',
    ]);

    await page.locator('#btnClearPinFilter').click();
    await expect.poll(() => page.evaluate(() => Store.selectedPin)).toBe(null);
    await expect(page.locator('#chip-svg .pin.cur')).toHaveCount(0);
    await expect(page.locator('.function-node')).toHaveCount(allFunctionCount);
    await expect(page.locator('.function-node.pin-filter-hidden')).toHaveCount(0);
    await expect(page.locator('.function-group[hidden]')).toHaveCount(0);
    await expect(page.locator('.function-group:visible')).toHaveCount(allGroupCount);
    await expect(page.locator('#detailPanel')).toContainText('点击左侧芯片图');
    await expect(page.locator('#statusText')).toContainText('已取消 Pin69 选择');
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
    expect(project.schema_version).toBe(2);
    expect(project.pwm_modules.EPWM1.pin_a).toBe(69);
    expect(project.pwm_modules.EPWM1.pin_b).toBe(68);
    expect(project.trip_routes.EPWM1_TRIP.source_pin).toBe(47);

    await page.locator('#rightTabs [data-tab="code"]').click();
    await expect(page.locator('#codePanel')).toContainText('NOT APPROVED FOR POWER-STAGE ENABLE');
    await expect(page.locator('#codePanel')).toContainText('EPWM1_ReleaseClamp');
    await expect(page.locator('#codePanel')).toContainText('给初学者');
    await expect(page.locator('#codePanel')).toContainText('第 1 步');
    await expect(page.locator('#codePanel')).toContainText('第 6 步');
    const usageGuide = page.locator('#usageGuidePanel');
    await expect(usageGuide).toContainText('独立说明，不属于生成代码');
    await expect(usageGuide).toContainText('Pin69 → EPWM1A');
    await expect(usageGuide).toContainText('Pin68 → EPWM1B');
    await expect(usageGuide).toContainText('Pin47 → TZ1');
    await expect(usageGuide).toContainText('Generated_InitAll()');
    await expect(usageGuide).toContainText('EPWM1_ReleaseClamp()');

    const preview = await page.evaluate(() => ConfigStudioApp.getLatestPreview().files);
    expect(await page.locator('#codePanel').textContent()).toBe(preview['pwm_init.c']);
    expect(preview['pwm_init.c']).not.toContain('初学者使用说明');
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

test('SCLA user flow creates I2CA module and JSON import restores it',
  async ({ page }) => {
    await waitReady(page);
    await page.locator('#chip-svg .pin[data-pin="3"] .hit').click();
    const scla = page.locator('.function-node[data-function="SCLA"]');
    await expect(scla).toBeVisible();
    await scla.locator('.function-row').click();
    await finishWizard(page);
    await expect.poll(() => page.evaluate(() => Store.project.pins['3']?.function))
      .toBe('SCLA');
    await expect.poll(() => page.evaluate(() =>
      !!ConfigStudioApp.getLatestPreview().files['i2c_init.c'],
    )).toBe(true);
    const files = await page.evaluate(() => Object.keys(
      ConfigStudioApp.getLatestPreview().files,
    ));
    expect(files).toContain('pinmux_init.c');
    expect(files).toContain('i2c_init.c');
    expect(files).not.toContain('adc_init.c');
    await expect(page.locator('#assignedPanel')).toContainText('I2CA');
    await expect(page.locator('#assignedPanel')).toContainText('完整模块对象');

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

test('browser-loaded official database has 127 numeric MUX routes and no JTAG MUX candidates',
  async ({ page }) => {
    await waitReady(page);
    const result = await page.evaluate(() => {
      const options = Object.values(Store.pinmux.pins).flatMap(def =>
        (def.mux_options || []).map(option => ({
          gpio: def.gpio_num,
          mux: option.mux,
          function: option.function,
        })));
      const jtag = Object.values(Store.pinmux.pins).flatMap(def =>
        (def.mux_options || [])
          .filter(option => ['TDI', 'TMS', 'TDO', 'TCK'].includes(option.function))
          .map(option => ({ gpio: def.gpio_num, function: option.function })));
      return { options, jtag };
    });
    expect(result.options).toHaveLength(127);
    expect(new Set(result.options.map(item => `${item.gpio}:${item.mux}`)).size)
      .toBe(127);
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
          electrical_profile: 'gpio_output',
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
      () => JSON.parse(localStorage.getItem('c2000.config.r3.3')),
    )).toEqual(JSON.parse(occupiedProject));
  });
