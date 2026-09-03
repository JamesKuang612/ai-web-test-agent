import { expect, test } from '@playwright/test';

test.use({
  browserName: 'chromium',
  channel: 'chrome',
  storageState: 'playwright/.auth/jdy.json',
  viewport: { width: 1440, height: 900 },
});

test('插件新建-入口', async ({ page }) => {
  test.setTimeout(90_000);

  await test.step('进入开放平台的自建插件页面', async () => {
    await page.goto('https://test.jdydevelop.com/open#/dev/private_plugin');

    const accountInput = page.getByPlaceholder(/手机号\/邮箱|Phone number\/Email/);
    const privatePluginEntry = page.getByRole('menuitem', {
      name: '自建插件',
      exact: true,
    });

    await expect(accountInput.or(privatePluginEntry).first()).toBeVisible({
      timeout: 30_000,
    });

    // storageState 失效时，以测试账号恢复登录，并回到本用例目标页面。
    if (await accountInput.isVisible()) {
      await accountInput.fill('1875931049@qq.com');
      await page.getByPlaceholder(/密码|Password/).fill('Jdy123456');
      await page.getByRole('button', { name: /登录|Log in/ }).click();
      await expect(page).toHaveURL(/\/open#\/dev\/private_plugin$/, {
        timeout: 30_000,
      });
    }

    await expect(page).toHaveURL(/\/open#\/dev\/private_plugin$/);
    await expect(privatePluginEntry).toBeVisible();
  });

  await test.step('验证自建插件空态及新建入口的位置', async () => {
    const emptyState = page.getByText('暂未自建任何插件，试试新建', {
      exact: true,
    });
    const createPluginButton = page.getByRole('button', {
      name: '新建插件',
      exact: true,
    });

    await expect(emptyState).toBeVisible();
    await expect(createPluginButton).toBeVisible();
    await expect(createPluginButton).toBeEnabled();

    const [emptyBox, buttonBox] = await Promise.all([
      emptyState.boundingBox(),
      createPluginButton.boundingBox(),
    ]);

    expect(emptyBox, '空态文案应具有可见区域').not.toBeNull();
    expect(buttonBox, '新建插件按钮应具有可见区域').not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThan(emptyBox!.x + emptyBox!.width / 2);
    expect(buttonBox!.y).toBeLessThan(emptyBox!.y);
  });
});
