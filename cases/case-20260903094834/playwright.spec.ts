import { expect, test } from '@playwright/test';

const targetUrl = 'https://test.jdydevelop.com/open#/dev/private_plugin';
const account = '1875931049@qq.com';
const password = 'Jdy123456';

test.use({
  browserName: 'chromium',
  channel: 'chrome',
  storageState: 'playwright/.auth/jdy.json',
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
});

test('开放平台-插件管理：浏览自建插件区域', async ({ page }) => {
  test.setTimeout(120_000);

  const loginAccountInput = page.getByPlaceholder(
    /手机号\/邮箱|Phone number\/Email/,
  );
  const privatePluginEntry = page.getByRole('menuitem', {
    name: '自建插件',
    exact: true,
  });

  await test.step('进入开放平台自建插件页面（未登录时恢复登录态）', async () => {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // 未登录会被重定向到登录页；storageState 失效时以测试账号恢复登录，并回到本用例目标页。
    await expect(loginAccountInput.or(privatePluginEntry).first()).toBeVisible({
      timeout: 30_000,
    });

    if (await loginAccountInput.isVisible()) {
      await loginAccountInput.fill(account);
      await page.getByPlaceholder(/密码|Password/).fill(password);
      await page.getByRole('button', { name: /登录|Log in/ }).click();
    }

    await expect(page).toHaveURL(/\/open#\/dev\/private_plugin$/, {
      timeout: 30_000,
    });
    await expect(privatePluginEntry).toBeVisible();
  });

  await test.step('验证自建插件空态文案与新建插件入口的位置', async () => {
    const emptyState = page.getByText('暂未自建任何插件，试试新建', {
      exact: true,
    });
    const createPluginButton = page.getByRole('button', {
      name: '新建插件',
      exact: true,
    });

    await expect(emptyState).toBeVisible();
    await expect(emptyState).toBeInViewport();
    await expect(createPluginButton).toBeVisible();
    await expect(createPluginButton).toBeEnabled();
    await expect(createPluginButton).toBeInViewport();

    const [emptyBox, buttonBox] = await Promise.all([
      emptyState.boundingBox(),
      createPluginButton.boundingBox(),
    ]);

    expect(emptyBox, '空态文案应具有可见区域').not.toBeNull();
    expect(buttonBox, '新建插件按钮应具有可见区域').not.toBeNull();

    // 预期：新建插件按钮位于正中间文案的右上方。
    expect(buttonBox!.x).toBeGreaterThan(emptyBox!.x + emptyBox!.width / 2);
    expect(buttonBox!.y).toBeLessThan(emptyBox!.y);
  });
});
