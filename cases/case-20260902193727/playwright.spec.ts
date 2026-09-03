import { expect, test } from '@playwright/test';

const formUrl = 'https://test.jdydevelop.com/f/659950e5ae52aa707ac89b03';
const expectedPythonRuntimeIp = '47.97.99.12';

test.use({ viewport: { width: 1440, height: 900 } });

test('插件运行时的出口IP：Python runtime 返回预期 IP', async ({ page }) => {
  test.setTimeout(60_000);

  await test.step('打开市场插件 IP 测试表单', async () => {
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('市场插件IP', { exact: true })).toBeVisible();
  });

  await test.step('运行 Python 插件并验证出口 IP', async () => {
    const textboxes = page.getByRole('textbox');
    const output = textboxes.nth(0);
    const status = textboxes.nth(1);

    await page.getByRole('button', { name: 'python', exact: true }).click();

    await expect(output).toHaveValue(`您的ip地址是：${expectedPythonRuntimeIp}`, {
      timeout: 30_000,
    });
    await expect(status).toHaveValue('正常');
  });
});
