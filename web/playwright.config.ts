import { defineConfig, devices } from '@playwright/test';

const probeIgnore = process.env.ROBOZIUM_E2E_RUNNER_PROBE === '1'
  ? [] : ['**/runner-probe.spec.ts'];

const DESKTOP_PROJECTS = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'firefox',
    testIgnore: [...probeIgnore, '**/visual-regression.spec.ts'],
    timeout: 60_000,
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    testIgnore: [...probeIgnore, '**/visual-regression.spec.ts'],
    timeout: 60_000,
    use: { ...devices['Desktop Safari'] },
  },
];

const isolatedHubRoot = process.env.ROBOZIUM_E2E_HUB_BASE_DIR;
const webPort = process.env.ROBOZIUM_E2E_WEB_PORT ?? '3100';
const webBaseUrl = `http://127.0.0.1:${webPort}`;

if (!isolatedHubRoot) {
  throw new Error(
    'Playwright requires an isolated E2E hub. Run `npm run test:e2e` instead of invoking Playwright directly.',
  );
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: probeIgnore,
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 3 : 0,
  failOnFlakyTests: !!process.env.CI,
  updateSnapshots: 'none',
  outputDir: `${process.env.ROBOZIUM_E2E_REPORT_DIR}/test-results`,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html', { outputFolder: `${process.env.ROBOZIUM_E2E_REPORT_DIR}/playwright-report`, open: 'never' }], ['junit', { outputFile: `${process.env.ROBOZIUM_E2E_REPORT_DIR}/playwright.xml` }], ['./e2e/completion-reporter.ts']],
  /* CI runners (esp. WebKit, which is software-rendered on Linux) are
   * meaningfully slower than a local machine. Give actions/assertions more
   * room there so a loaded runner doesn't fail on wall-clock alone. */
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {
    timeout: process.env.CI ? 10_000 : 5_000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: webBaseUrl,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    actionTimeout: process.env.CI ? 15_000 : 0,
  },

  projects: [...DESKTOP_PROJECTS],
});
