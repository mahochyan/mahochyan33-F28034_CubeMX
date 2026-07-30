const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests_e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/test-repo/',
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tools/serve_dist.cjs',
    url: 'http://127.0.0.1:4173/test-repo/',
    reuseExistingServer: true,
  },
});
