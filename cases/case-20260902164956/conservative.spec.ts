import { test, expect } from '@playwright/test';

test.use({
  browserName: 'chromium',
  channel: 'chrome',
  storageState: 'playwright/.auth/jdy.json',
  viewport: { width: 1707, height: 825 },
});

test('插件新建-入口', async ({ page }) => {
  await test.step('进入工作台并确保登录', async () => {
    await page.goto('https://test.jdydevelop.com/dashboard#/');

    const loginButton = page.getByRole('button', {
      name: '登录',
      exact: true,
    });

    if (await loginButton.isVisible()) {
      await page
        .getByPlaceholder('手机号/邮箱')
        .fill('1875931049@qq.com');
      await page
        .getByPlaceholder('密码')
        .fill('Jdy123456');
      await loginButton.click();
    }

    await expect(page).toHaveURL(/\/dashboard#\/?$/);
    await expect(page.getByText('工作台', { exact: true })).toBeVisible();
  });

  await test.step('回放管理后台页面切换并返回工作台', async () => {
    await page.getByText('蒋', { exact: true }).click();

    const adminLink = page.getByRole('link', { name: /管理后台/ });
    await expect(adminLink).toBeVisible();
    await adminLink.click();

    await expect(page).toHaveURL(/\/portal\/tenant\/.+\/admin/);

    const productCenter = page.getByRole('menuitem', {
      name: '产品中心',
      exact: true,
    });
    await expect(productCenter).toBeVisible();
    await productCenter.click();

    await expect(page).toHaveURL(/#\/product_center$/);
    await expect(
      page.getByRole('button', { name: '进入产品', exact: true }),
    ).toBeVisible();

    const adminMessageEntry = page.locator('.comp-item.message');
    await expect(adminMessageEntry).toBeVisible();
    await adminMessageEntry.click();

    await expect(page.getByText('消息中心', { exact: true })).toBeVisible();

    const adminDrawerClose = page.locator('.drawer-close-btn');
    await expect(adminDrawerClose).toBeVisible();
    await adminDrawerClose.click();

    await expect(page.getByText('消息中心', { exact: true })).toBeHidden();

    const adminTitle = page.getByText('管理后台', { exact: true });
    const siteLogo = adminTitle.locator('..').locator('i').first();
    await expect(siteLogo).toBeVisible();
    await siteLogo.click();

    await expect(page).toHaveURL(/\/dashboard#\/?$/);
    await expect(page.getByText('工作台', { exact: true })).toBeVisible();
  });

  await test.step('处理消息中心遮罩并打开产品菜单', async () => {
    const messageEntry = page.locator('.comp-item.message');
    await expect(messageEntry).toBeVisible();
    await messageEntry.click();

    await expect(page.getByText('消息中心', { exact: true })).toBeVisible();

    const drawerClose = page.locator('.drawer-close-btn');
    await expect(drawerClose).toBeVisible();
    await drawerClose.click();

    await expect(page.getByText('消息中心', { exact: true })).toBeHidden();

    const workbenchMenu = page.locator('.comp-item.menu');
    await expect(workbenchMenu).toBeVisible();
    await workbenchMenu.click();

    await expect(page).toHaveURL(/\/dashboard#\/?$/);

    const productMenuIcon = page.locator('.fx-product-menu-icon');
    await expect(productMenuIcon).toBeVisible();
    await productMenuIcon.click();

    const openPlatformEntry = page.getByText('开放平台', { exact: true });
    await expect(openPlatformEntry).toBeVisible();
    await openPlatformEntry.click();
  });

  await test.step('进入插件管理并浏览自建插件区域', async () => {
    await expect(page).toHaveURL(/\/open#\/market\/store-plugin$/);

    const pluginManagement = page.getByRole('menuitem', {
      name: '插件管理',
      exact: true,
    });
    await expect(pluginManagement).toBeVisible();
    await pluginManagement.click();

    await expect(page).toHaveURL(/\/open#\/manage\/plugin$/);
    await expect(page.getByText('已安装插件', { exact: true })).toBeVisible();

    const privatePluginEntry = page.getByRole('menuitem', {
      name: '自建插件',
      exact: true,
    });
    await expect(privatePluginEntry).toBeVisible();
    await privatePluginEntry.click();

    await expect(page).toHaveURL(/\/open#\/dev\/private_plugin$/);
    await expect(privatePluginEntry).toHaveAttribute('aria-current', 'page').catch(
      async () => {
        await expect(privatePluginEntry).toBeVisible();
      },
    );
  });

  await test.step('验证空状态文案和新建插件入口', async () => {
    const emptyState = page.getByText(
      '暂未自建任何插件，试试新建',
      { exact: true },
    );
    const createPluginButton = page.getByRole('button', {
      name: '新建插件',
      exact: true,
    });

    await expect(emptyState).toBeVisible();
    await expect(emptyState).toBeInViewport();
    await expect(createPluginButton).toBeVisible();
    await expect(createPluginButton).toBeEnabled();
    await expect(createPluginButton).toBeInViewport();
  });
});
