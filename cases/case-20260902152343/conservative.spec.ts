import { test, expect } from '@playwright/test';

test.use({
  browserName: 'chromium',
  channel: 'chrome',
  storageState: 'playwright/.auth/jdy.json',
  viewport: { width: 1440, height: 900 },
});

// 尚未验证；标准 page fixture 为每个测试创建新的 browser context。
test('0个已安装插件及0个自建插件时显示空状态', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('https://test.jdydevelop.com/dashboard#/');

  // 产品菜单图标没有可访问名称，使用本次观察到的语义类名。
  const productMenu = page.locator('.fx-product-menu-icon');
  const accountInput = page.getByRole('textbox', {
    name: '手机号/邮箱',
    exact: true,
  });

  await expect(accountInput.or(productMenu).first()).toBeVisible({
    timeout: 30_000,
  });

  // 本次探索中存储的登录态失效，需要重新登录。
  if (await accountInput.isVisible()) {
    await accountInput.fill('1875931049@qq.com');
    await page.getByRole('textbox', {
      name: '密码',
      exact: true,
    }).fill('Jdy123456');
    await page.getByRole('button', {
      name: '登录',
      exact: true,
    }).click();
  }

  await productMenu.click({ timeout: 30_000 });
  await page.getByText('开放平台', { exact: true }).click();

  // 核对自建插件为空的前置条件。
  await page.getByRole('menuitem', {
    name: '自建插件',
    exact: true,
  }).click();
  await expect(page).toHaveURL(
    'https://test.jdydevelop.com/open#/dev/private_plugin',
  );
  await expect(
    page.getByText('暂未自建任何插件，试试新建', { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole('menuitem', {
    name: '插件管理',
    exact: true,
  }).click();
  await expect(page).toHaveURL(
    'https://test.jdydevelop.com/open#/manage/plugin',
  );
  await expect(
    page.getByText('已安装插件', { exact: true }),
  ).toBeVisible();

  // 页面实际使用半角逗号，文案断言兼容中英文逗号。
  await expect(
    page.getByText(/^暂未安装任何插件[,，]去插件市场看看$/),
  ).toBeVisible({ timeout: 15_000 });

  const marketLink = page.getByRole('link', {
    name: '插件市场',
    exact: true,
  });
  await expect(marketLink).toBeVisible();
  await expect(marketLink).toHaveAttribute('href', '/open#/market');
});
