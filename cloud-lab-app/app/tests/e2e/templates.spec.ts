import { test, expect } from '@playwright/test';

test('templates page loads correctly', async ({ page }) => {
	await page.goto('/');

	await expect(page.locator('.main-content h1')).toContainText('Templates');
	await expect(page.locator('#provider-select')).toBeVisible();
	await expect(page.locator('.template-card')).toHaveCount(2);
});

test('provider filter shows only selected provider', async ({ page }) => {
	await page.goto('/');

	await page.selectOption('#provider-select', 'aws');

	await expect(page.locator('section[data-provider="aws"]')).toBeVisible();
	await expect(page.locator('section[data-provider="azure"]')).toBeHidden();

	await page.selectOption('#provider-select', 'azure');

	await expect(page.locator('section[data-provider="aws"]')).toBeHidden();
	await expect(page.locator('section[data-provider="azure"]')).toBeVisible();
});
