import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  projects: [
    {
      name: 'local',
      testMatch: /local\/.*\.spec\.ts/,
    },
    {
      name: 'rotation',
      testMatch: /rotation\/.*\.spec\.ts/,
    },
    {
      name: 'external',
      testMatch: /external\/.*\.spec\.ts/,
      timeout: 90_000,
      retries: 2,
    },
    {
      name: 'baseline',
      testMatch: /baseline\/.*\.spec\.ts/,
      timeout: 90_000,
      retries: 2,
    },
    {
      name: 'phase-b',
      testMatch: /phase-b\/.*\.spec\.ts/,
      timeout: 60_000,
      retries: 0,
    },
  ],
});
