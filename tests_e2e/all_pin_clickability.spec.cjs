const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

async function waitReady(page) {
  await page.goto('./');
  await expect.poll(() => page.evaluate(
    () => document.documentElement.dataset.appReady,
  )).toBe('true');
}

test('Pin1 through Pin80 are clickable with zero configurable-empty P0 failures',
  async ({ page }) => {
    await waitReady(page);
    const results = [];
    for (let pin = 1; pin <= 80; pin += 1) {
      const node = page.locator(`#chip-svg .pin[data-pin="${pin}"]`);
      await expect(node).toHaveCount(1);
      const configurable = await node.getAttribute('data-configurable') === '1';
      const functionCount = Number(await node.getAttribute('data-function-count'));
      if (configurable) {
        expect(
          functionCount,
          `P0: Pin${pin} configurable=true but function list is empty`,
        ).toBeGreaterThan(0);
      }
      await node.locator('.hit').click();
      await expect.poll(() => page.evaluate(() => Store.selectedPin)).toBe(pin);
      await expect(page.locator('#detailPanel')).toContainText(`Pin${pin}`);
      await expect(page.locator('.inline-wizard')).toHaveCount(0);
      const visibleFunctions = await page.locator('.function-node:visible')
        .evaluateAll(items => items.map(item => item.dataset.function).sort());
      if (configurable) expect(visibleFunctions.length).toBeGreaterThan(0);
      results.push({
        pin,
        configurable,
        functionCount,
        visibleFunctions: visibleFunctions.join(', '),
        result: 'PASS',
      });
    }

    await page.locator('#chip-svg .pin[data-pin="12"] .hit').click();
    await expect(page.locator('#detailPanel')).toContainText('ADCINA6');
    await expect(page.locator('#detailPanel')).toContainText('COMP3A');
    await expect(page.locator('#detailPanel')).toContainText('AIO6');
    await expect(page.locator('#detailPanel')).toContainText('并行模拟路径');

    for (const [pin, signal] of [[57, 'TCK'], [58, 'TDO'], [59, 'TDI'], [60, 'TMS']]) {
      await page.locator(`#chip-svg .pin[data-pin="${pin}"] .hit`).click();
      await expect(page.locator('#detailPanel')).toContainText(signal);
      const isMux = await page.evaluate(
        ({ pin, signal }) => Store.pinDef(pin).mux_options
          .some(item => item.function === signal),
        { pin, signal },
      );
      expect(isMux, `${signal} must not be an ordinary GPBMUX option`).toBe(false);
    }

    const evidenceDir = path.join(ROOT, 'docs', 'r3_2_2_e2e');
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, 'all_80_pin_clickability.png'),
      fullPage: true,
    });
    const lines = [
      '# All 80 Pins E2E Report',
      '',
      'Real Playwright browser flow against the built `dist/` static site.',
      '',
      '- Physical pins clicked: `80/80`',
      '- Click response failures: `0`',
      '- `configurable=true` with empty functions: `0`',
      '- Fixed pins opening a configuration wizard: `0`',
      '- JTAG signals incorrectly exposed as GPBMUX: `0`',
      '',
      '| Pin | Configurable | Function count | Visible functions after click | Result |',
      '|---:|---|---:|---|---|',
      ...results.map(item =>
        `| ${item.pin} | ${item.configurable} | ${item.functionCount} | ${item.visibleFunctions} | ${item.result} |`),
      '',
      'Evidence screenshot: `docs/r3_2_2_e2e/all_80_pin_clickability.png`.',
      '',
    ];
    fs.writeFileSync(
      path.join(ROOT, 'docs', 'ALL_80_PINS_E2E_REPORT.md'),
      `${lines.join('\n')}\n`,
      'utf8',
    );
  });
