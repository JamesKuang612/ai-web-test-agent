import { test, expect } from '@playwright/test';

test.use({
  storageState: 'playwright/.auth/jdy.json',
  channel: 'chrome',
});

test('确保目标应用存在', async ({ page }) => {
  const dashboardUrl = 'https://www.jiandaoyun.com/dashboard#/';
  const appName = 'jdy-v0-benchmark-20260902-1245';

  const searchBox = page.getByPlaceholder('请输入名称来搜索');
  const appLink = page
    .getByRole('link', { name: appName, exact: true })
    .first();
  const noResults = page.getByText('没有搜索到相关结果', { exact: true });

  await page.goto(dashboardUrl);
  await expect(searchBox).toBeVisible();
  await searchBox.fill(appName);
  await expect(appLink.or(noResults)).toBeVisible();

  if (await appLink.isVisible()) {
    await expect(appLink).toHaveAttribute('href', /\/dashboard#\/app\/[^/?#]+$/);
    return;
  }

  await expect(noResults).toBeVisible();

  await page.goto(dashboardUrl);

  const newAppButton = page.getByRole('button', { name: /新建应用/ });
  await expect(newAppButton).toBeVisible();
  await newAppButton.click();

  const createBlankApp = page.getByText('创建空白应用', { exact: true });
  await expect(createBlankApp).toBeVisible();
  await createBlankApp.click();

  const nameInput = page.getByPlaceholder('给应用命名，例如“客户管理系统”');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(appName);

  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard#\/app\/[^/?#]+$/);

  await page.goto(dashboardUrl);
  await expect(searchBox).toBeVisible();
  await searchBox.fill(appName);

  await expect(appLink).toBeVisible();
  await expect(appLink).toHaveAttribute('href', /\/dashboard#\/app\/[^/?#]+$/);
});
