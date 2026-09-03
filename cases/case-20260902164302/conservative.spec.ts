import { test, expect } from '@playwright/test';

test.use({
  storageState: 'playwright/.auth/jdy.json',
  channel: 'chrome',
});

test('插件新建入口', async ({ page }) => {
  await page.goto('https://test.jdydevelop.com/dashboard#/');

  const accountInput = page.getByRole('textbox', { name: '手机号/邮箱' });
  if (await accountInput.isVisible()) {
    await accountInput.fill('1875931049@qq.com');
    await accountInput.press('Tab');
    await page.getByPlaceholder('密码').fill('Jdy123456');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveTitle('工作台');
  }

  await page.goto('https://test.jdydevelop.com/open');
  await expect(page).toHaveURL(/\/open#\/market\/store-plugin/);

  await page.getByRole('menuitem', { name: '插件管理' }).click();
  await expect(page).toHaveURL(/\/open#\/manage\/plugin/);

  await page.getByRole('menuitem', { name: '自建插件' }).click();
  await expect(page).toHaveURL(/\/open#\/dev\/private_plugin/);

  await expect(page.getByText('暂未自建任何插件，试试新建')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建插件' })).toBeVisible();
});
