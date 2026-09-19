import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4321',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: [
		{
			command: 'npx tsx tests/e2e/fixtures/mock-server.ts',
			url: 'http://localhost:4000/templates',
			reuseExistingServer: !process.env.CI,
			timeout: 10000,
		},
		{
			command: 'npm run dev',
			url: 'http://localhost:4321',
			reuseExistingServer: !process.env.CI,
			timeout: 120000,
		},
	],
});
