import { test, expect } from '@playwright/test';

test.use({
  channel: 'chrome',
  storageState: 'playwright/.auth/jdy.json',
});

test('验证 Example Domain 标题', async ({ page }) => {
  await page.goto('https://example.com');

  await expect(
    page.getByRole('heading', { name: 'Example Domain', exact: true }),
  ).toBeVisible();
});
