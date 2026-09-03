import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('example.com 页面标题包含 Example Domain', async ({ page }) => {
  test.setTimeout(60_000);

  await test.step('打开 https://example.com 并确认导航状态', async () => {
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/^https:\/\/example\.com\/?$/);
    await expect(page).toHaveTitle('Example Domain');
  });

  await test.step('验证页面 H1 标题为 Example Domain', async () => {
    const heading = page.getByRole('heading', {
      name: 'Example Domain',
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Example Domain', { exact: true });
  });
});
