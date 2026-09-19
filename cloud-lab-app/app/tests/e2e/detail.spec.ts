import { test, expect } from '@playwright/test';

test('detail page loads with status and basic info', async ({ page }) => {
	await page.goto('/attack-ranges/test-123');

	await expect(page.locator('.status-badge').first()).toBeVisible();
	await expect(page.locator('.status-badge').first()).toContainText('running');
	await expect(page.locator('.basic-info-section')).toBeVisible();
	await expect(page.locator('.detail-grid')).toBeVisible();
});
