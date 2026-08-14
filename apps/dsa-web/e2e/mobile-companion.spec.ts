import { expect, test, type Page } from '@playwright/test';

const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;

if (!smokePassword) test.skip(true, 'Set DSA_WEB_SMOKE_PASSWORD to run mobile smoke tests.');

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForTimeout(500);
  const password = page.locator('#password');
  if (!await password.isVisible().catch(() => false)) return;
  await expect(password).toBeVisible();
  await password.fill(smokePassword!);
  await page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ }).click();
  await page.waitForURL('/');
}

test.describe('mobile daily companion', () => {
  test('keeps five-entry navigation visible without horizontal overflow', async ({ page }) => {
    await login(page);
    await page.goto('/m');
    const nav = page.getByRole('navigation', { name: '移动端主导航' });
    await expect(nav).toBeVisible();
    for (const label of ['首页', '自选', '问股', '任务', '我的']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const navBox = await nav.boundingBox();
    expect(navBox?.y).toBeGreaterThan(0);
    expect((navBox?.y || 0) + (navBox?.height || 0)).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  });

  test('opens watchlist, chat, tasks, and me inside the mobile shell', async ({ page }) => {
    await login(page);
    await page.goto('/m');
    const nav = page.getByRole('navigation', { name: '移动端主导航' });
    for (const [label, heading] of [['自选', '我的自选'], ['问股', '问股'], ['任务', '任务'], ['我的', '我的']] as const) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
