import { defineConfig, devices } from '@playwright/test';

const DESKTOP_PROJECTS = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'firefox',
    testIgnore: '**/visual-regression.spec.ts',
    timeout: 60_000,
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    testIgnore: '**/visual-regression.spec.ts',
    timeout: 60_000,
    use: { ...devices['Desktop Safari'] },
  },
] as const;

const runAllBrowserProjects = process.env.ROBOSPRAWL_E2E_ALL_BROWSERS === '1';
const isolatedHubRoot = process.env.ROBOSPRAWL_E2E_HUB_BASE_DIR;
const webPort = process.env.ROBOSPRAWL_E2E_WEB_PORT ?? '3100';
const webBaseUrl = `http://127.0.0.1:${webPort}`;

if (!isolatedHubRoot) {
  throw new Error(
    'Playwright requires an isolated E2E hub. Run `npm run test:e2e` instead of invoking Playwright directly.',
  );
}

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
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
    trace: 'on-first-retry',

    actionTimeout: process.env.CI ? 15_000 : 0,
  },

  /* Configure projects for major browsers.
   * Default to a single browser to avoid shared-backend cross-project artifacts.
   * Opt into all desktop browsers with ROBOSPRAWL_E2E_ALL_BROWSERS=1.
   */
  projects: runAllBrowserProjects ? [...DESKTOP_PROJECTS] : [DESKTOP_PROJECTS[0]],

  /* Run a non-watch server to avoid EMFILE from dev watcher load. */
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${webPort}`,
    url: webBaseUrl,
    reuseExistingServer: false,
  },
});
