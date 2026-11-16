import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4196/prototype/',
    browserName: 'chromium',
    headless: true,
    viewport: {width: 1440, height: 1000},
    timezoneId: 'America/Los_Angeles',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4196 --strictPort --base /prototype/',
    url: 'http://127.0.0.1:4196/prototype/',
    reuseExistingServer: !process.env.CI,
  },
})
