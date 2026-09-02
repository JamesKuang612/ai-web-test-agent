import { test, expect } from '@playwright/test';

test.use({
  storageState: 'playwright/.auth/jdy.json',
  channel: 'chrome',
});

test('搜索应用，不存在时创建，并最终验证应用存在', async ({ page }) => {
  const initialUrl = 'https://www.jiandaoyun.com/dashboard#/';
  const appName = 'jdy-v0-benchmark-20260902-1245';

  await page.goto(initialUrl);

  const searchBox = page.getByPlaceholder('请输入名称来搜索');
  const appLink = page.getByRole('link', { name: appName, exact: true });
  const noResults = page.getByText('没有搜索到相关结果', { exact: true });

  await expect(searchBox).toBeVisible();
  await searchBox.fill(appName);
  await expect(searchBox).toHaveValue(appName);
  await expect(appLink.or(noResults)).toBeVisible();

  if (await noResults.isVisible()) {
    await expect(noResults).toBeVisible();

    await searchBox.fill('');
    await expect(searchBox).toHaveValue('');

    // 保留成功 Explore 中用于退出搜索状态并恢复“新建应用”按钮的交互。
    await searchBox.press('Escape');
    await page.getByText('我的应用', { exact: true }).click();

    const newApplicationButton = page.getByRole('button', {
      name: /新建应用/,
    });

    await expect(newApplicationButton).toBeVisible();
    await newApplicationButton.click();

    const createBlankApplication = page.getByText('创建空白应用', {
      exact: true,
    });

    await expect(createBlankApplication).toBeVisible();
    await createBlankApplication.click();

    const applicationNameInput = page.getByPlaceholder(
      '给应用命名，例如“客户管理系统”',
    );

    await expect(applicationNameInput).toBeVisible();
    await applicationNameInput.fill(appName);
    await expect(applicationNameInput).toHaveValue(appName);

    const confirmButton = page.getByRole('button', {
      name: '确定',
      exact: true,
    });

    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page).toHaveURL(/\/dashboard#\/app\/[^/?#]+$/);
    await expect(
      page.getByText(appName, { exact: true }).first(),
    ).toBeVisible();
  } else {
    await expect(appLink).toBeVisible();
  }

  // 返回工作台重新搜索，验证应用已持久化且可访问。
  await page.goto(initialUrl);

  const verificationSearchBox = page.getByPlaceholder('请输入名称来搜索');
  const verifiedAppLink = page.getByRole('link', {
    name: appName,
    exact: true,
  });

  await expect(verificationSearchBox).toBeVisible();
  await verificationSearchBox.fill(appName);
  await expect(verificationSearchBox).toHaveValue(appName);

  await expect(verifiedAppLink).toBeVisible();
  await expect(verifiedAppLink).toHaveAttribute(
    'href',
    /\/dashboard#\/app\/[^/?#]+$/,
  );
  await expect(
    page.getByText('没有搜索到相关结果', { exact: true }),
  ).toBeHidden();
});
