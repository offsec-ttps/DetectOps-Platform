import { test, expect } from '@playwright/test';

test('attack ranges page loads with table', async ({ page }) => {
	await page.goto('/attack-ranges');

	await expect(page.locator('.main-content h1')).toContainText('Running Attack Ranges');
	await expect(page.locator('.table-row')).toHaveCount(2);
	await expect(page.locator('.status-badge')).toHaveCount(2);
});

test('clicking row navigates to detail page', async ({ page }) => {
	await page.goto('/attack-ranges');

	await page.locator('.table-row').first().click();

	await expect(page).toHaveURL(/\/attack-ranges\/test-123/);
});
