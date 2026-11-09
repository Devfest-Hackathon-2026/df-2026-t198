export async function openJudgeLogin(page) {
  await page.getByLabel('メールアドレス').waitFor({ state: 'attached' });
  const summary = page.locator('.demo-judge-login:not([open]) > summary');
  if (await summary.count()) await summary.click();
}
