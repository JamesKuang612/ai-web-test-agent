import { expect, test } from '@playwright/test';

const formUrl = 'https://test.jdydevelop.com/f/659950e5ae52aa707ac89b03';
const expectedRuntimeIp = '47.97.99.12';

test.use({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
});

test('市场插件IP：插件运行时的出口IP（Python/Nodejs）', async ({ page }) => {
  test.setTimeout(120_000);

  const fieldByLabel = (label: string) =>
    page
      .locator('.fx-field')
      .filter({ has: page.locator('.field-name', { hasText: label }) });

  const pythonOutput = fieldByLabel('插件出口IP-python').locator('textarea');
  const pythonStatus = fieldByLabel('插件出口IP-python')
    .locator('xpath=following-sibling::*[1]')
    .locator('input');
  const nodejsOutput = fieldByLabel('插件出口IP-nodejs').locator('textarea');
  const nodejsStatus = fieldByLabel('插件出口IP-nodejs')
    .locator('xpath=following-sibling::*[1]')
    .locator('input');
  const submitButton = page.locator('button.op-forward');

  await test.step('打开市场插件 IP 测试表单', async () => {
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('市场插件IP', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'python', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'nodejs', exact: true }),
    ).toBeVisible();
  });

  await test.step('运行 Python 插件并验证出口 IP', async () => {
    await page.getByRole('button', { name: 'python', exact: true }).click();
    await expect(pythonOutput).toHaveValue(
      `您的ip地址是：${expectedRuntimeIp}`,
      { timeout: 30_000 },
    );
    await expect(pythonStatus).toHaveValue('正常');
  });

  await test.step('运行 Nodejs 插件并验证出口 IP', async () => {
    await page.getByRole('button', { name: 'nodejs', exact: true }).click();
    await expect(nodejsOutput).toHaveValue(
      `您的ip地址是：${expectedRuntimeIp}`,
      { timeout: 30_000 },
    );
    await expect(nodejsStatus).toHaveValue('正常');
  });

  await test.step('提交表单并确认提交成功', async () => {
    await expect(submitButton).toBeVisible();
    await submitButton.click();
    await expect(page.getByText('提交成功', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});