const { test, expect } = require('@playwright/test');

async function ready(page) {
  await page.goto('./');
  await expect.poll(() => page.evaluate(
    () => document.documentElement.dataset.appReady,
  )).toBe('true');
}

async function openFromPin(page, pin, functionName) {
  await page.locator(`#chip-svg .pin[data-pin="${pin}"] .hit`).click();
  const node = page.locator(`.function-node[data-function="${functionName}"]`);
  await expect(node).toBeVisible();
  await node.locator('.function-row').click();
  await expect(node.locator('.inline-wizard')).toBeVisible();
}

async function complete(page, values = {}) {
  const wizard = page.locator('.inline-wizard');
  for (let index = 0; index < 40; index += 1) {
    const control = wizard.locator('[data-field]').first();
    if (await control.count()) {
      const field = await control.getAttribute('data-field');
      if (Object.prototype.hasOwnProperty.call(values, field)) {
        const value = values[field];
        const tag = await control.evaluate(node => node.tagName);
        const type = await control.getAttribute('type');
        if (tag === 'SELECT') await control.selectOption(String(value));
        else if (type === 'radio') {
          await wizard.locator(
            `input[data-field="${field}"][value="${value}"]`).check();
        } else if (type === 'checkbox') {
          if (value) await control.check();
          else await control.uncheck();
        } else {
          await control.fill(String(value));
        }
        await expect.poll(() => page.evaluate(
          fieldName => Store.activeEditor.draft?.[fieldName], field,
        )).toEqual(
          ['number', 'range'].includes(type) || tag === 'SELECT' &&
            field.startsWith('pin_') ? Number(value) : value,
        );
      } else if (await control.evaluate(node => node.tagName) === 'SELECT' &&
                 !(await control.inputValue())) {
        const firstText = await control.locator('option').first().textContent();
        const required = !String(firstText).includes('可选');
        if (required && await control.locator('option:not([disabled])').count() > 1) {
          await control.selectOption({ index: 1 });
        }
      }
    }
    const finish = wizard.locator('[data-action="finish"]');
    if (await finish.count()) {
      for (const [field, value] of Object.entries(values)) {
        await expect.poll(() => page.evaluate(
          fieldName => Store.activeEditor.draft?.[fieldName], field,
        )).toEqual(value);
      }
      await finish.click();
      await expect.poll(() => page.evaluate(
        () => document.getElementById('statusText').textContent,
      )).toMatch(/原子提交|不能提交/);
      return;
    }
    await wizard.locator('[data-action="next"]').click();
  }
  throw new Error('R3.3 wizard did not finish');
}

async function generatedFile(page, name) {
  await expect.poll(() => page.evaluate(fileName =>
    ConfigStudioApp.getLatestPreview()?.files?.[fileName] || null, name,
  )).not.toBeNull();
  return page.evaluate(fileName =>
    ConfigStudioApp.getLatestPreview().files[fileName], name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
});

test('I2CA user transaction links SDA/SCL, module object and generated file',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 3, 'SCLA');
    await complete(page, { role: 'master', pin_sda: 2, bus_hz: 100000 });
    await expect.poll(() => page.evaluate(
      () => Object.keys(Store.project.i2c_modules),
    )).toEqual(['I2CA']);
    await expect.poll(() => page.evaluate(
      () => Object.keys(Store.project.i2c_modules.I2CA.signals).sort(),
    )).toEqual(['scl', 'sda']);
    expect(await generatedFile(page, 'i2c_init.c')).toContain('I2caRegs.I2CMDR');
    const files = await page.evaluate(
      () => ConfigStudioApp.getLatestPreview().files);
    expect(files['pinmux_init.c']).toContain('Pin2');
    expect(files['pinmux_init.c']).toContain('Pin3');
    await expect(page.locator('#assignedPanel')).toContainText('I2CA');
  });

test('SPIA 3-wire wizard releases SOMI and creates a single SPIA object',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 41, 'SPICLKA');
    await complete(page, {
      role: 'master', wire_mode: '3wire', data_mode: 'full_duplex',
      ste_strategy: 'no_cs', pin_simo: 46, baud_hz: 1000000,
    });
    const module = await page.evaluate(() => Store.project.spi_modules.SPIA);
    expect(Object.keys(module.signals).sort()).toEqual(['clk', 'simo']);
    expect(module.signals.somi).toBeUndefined();
    const code = await generatedFile(page, 'spi_init.c');
    expect(code).toContain('SpiaRegs.SPICCR');
  });

test('SPISIMOA entry opens the SPIA wizard and groups the completed module',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 46, 'SPISIMOA');
    await expect(page.locator('.inline-wizard')).toContainText(
      'SPIA/SPIB 完整模块配置');
    await complete(page, {
      role: 'master', wire_mode: '3wire', data_mode: 'full_duplex',
      ste_strategy: 'no_cs', pin_clk: 41,
      baud_hz: 1000000,
    });
    const module = await page.evaluate(() => Store.project.spi_modules.SPIA);
    expect(module.signals.simo.physical_pin).toBe(46);
    expect(module.signals.clk.physical_pin).toBe(41);
    await expect(
      page.locator('.assigned-item[data-module="SPIA"]'),
    ).toContainText('SPIA · 2 个物理信号');
    await expect(
      page.locator('.assigned-item[data-module="SPIA"]'),
    ).toContainText('完整模块对象');
  });

test('CANA internal loopback creates no physical CAN pin claims',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 32, 'CANTXA');
    await complete(page, { mode: 'self_test_loopback' });
    const state = await page.evaluate(() => ({
      module: Store.project.can_modules.CANA,
      pins: Object.values(Store.project.pins)
        .filter(pin => pin.module === 'CANA'),
      code: ConfigStudioApp.getLatestPreview().files['can_init.c'],
    }));
    expect(state.module.mode).toBe('self_test_loopback');
    expect(state.pins).toEqual([]);
    const code = await generatedFile(page, 'can_init.c');
    expect(code).toContain('CCR = 1U');
    expect(code).toContain('CCE != 1U');
  });

test('EQEP1A entry requires EQEP1B and commits one grouped EQEP1 module',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 78, 'EQEP1A');
    await expect(page.locator('.inline-wizard')).toContainText(
      'eQEP1 完整模块配置');
    await complete(page, {
      mode: 'quadrature', pin_b: 79,
      qualification: 'sync',
    });
    const code = await generatedFile(page, 'eqep_init.c');
    const state = await page.evaluate(() => ({
      module: Store.project.eqep_modules.EQEP1,
    }));
    expect(Object.keys(state.module.signals).sort()).toEqual(['a', 'b']);
    expect(state.module.signals.b.physical_pin).toBe(79);
    expect(code).toContain('EQep1Regs.QDECCTL');
    await expect(
      page.locator('.assigned-item[data-module="EQEP1"]'),
    ).toContainText('EQEP1 · 2 个物理信号');
  });

test('two browser ADC transactions retain SOC0 and SOC1',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 18, 'ADCINA0');
    await complete(page, { soc: 0, trigger: 'SOFTWARE', acqps: 14 });
    await openFromPin(page, 23, 'ADCINB0');
    await complete(page, {
      soc: 1, trigger: 'SOFTWARE', acqps: 20, interrupt: 'ADCINT2',
    });
    await expect.poll(() => page.evaluate(() =>
      ConfigStudioApp.getLatestPreview()?.files?.['adc_init.c'] || '',
    )).toContain('ADCSOC1CTL');
    const state = await page.evaluate(() => ({
      socs: Object.keys(Store.project.adc.socs).sort(),
      socMap: Store.project.adc.socs,
      status: document.getElementById('statusText').textContent,
      code: ConfigStudioApp.getLatestPreview().files['adc_init.c'],
    }));
    expect(state.socMap).toEqual({
      SOC0: expect.objectContaining({ channel: 'ADCINA0', soc: 0 }),
      SOC1: expect.objectContaining({ channel: 'ADCINB0', soc: 1 }),
    });
    expect(state.code).toContain('ADCSOC0CTL');
    expect(state.code).toContain('ADCSOC1CTL');
  });

test('internal comparator Trip does not allocate a fake physical pin',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 16, 'COMP1A');
    await complete(page, { input_side: 'positive', dac_value: 512 });
    await openFromPin(page, 69, 'EPWM1A');
    await complete(page, {
      mode: 'single', trip_enabled: true, trip_source: 'COMP1OUT',
    });
    await generatedFile(page, 'pwm_routing_init.c');
    const state = await page.evaluate(() => ({
      route: Store.project.trip_routes.EPWM1_TRIP,
      pins: Object.values(Store.project.pins),
      routing: ConfigStudioApp.getLatestPreview().files['pwm_routing_init.c'],
    }));
    expect(state.route.source_pin).toBeNull();
    expect(state.pins.some(pin => pin.function === 'COMP1OUT')).toBe(false);
    expect(state.routing).toContain('内部 COMP1OUT');
  });

test('HRCAP high-resolution calibration is rejected while EPWM7 is an application PWM',
  async ({ page }) => {
    await ready(page);
    await openFromPin(page, 64, 'EPWM7A');
    await complete(page, { mode: 'single', trip_enabled: false });
    const before = await page.evaluate(() => Store.exportJSON());
    await openFromPin(page, 37, 'HRCAP1');
    await complete(page, {
      mode: 'high_resolution', calibration_mode: 'runtime',
      calibration_instance: 'HRCAP2', hccal_library: 'TI_HCCal',
    });
    await expect(page.locator('#statusText')).toContainText('EPWM7_CALIBRATION');
    await expect(page.locator('#chip-svg .pin[data-pin="64"]')).toHaveClass(/st-err/);
    await expect(page.locator('#chip-svg .pin[data-pin="37"]')).toHaveClass(/st-err/);
    await expect(
      page.locator('.function-node[data-function="EPWM7A"]'),
    ).toHaveClass(/resource-conflict/);
    await expect(
      page.locator('.function-node[data-function="HRCAP1"]'),
    ).toHaveClass(/resource-conflict/);
    expect(await page.evaluate(() => Store.exportJSON())).toBe(before);
    expect(await page.evaluate(
      () => Store.project.hrcap_modules.HRCAP1)).toBeUndefined();
  });
