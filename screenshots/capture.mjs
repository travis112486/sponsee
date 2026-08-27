import { chromium } from 'playwright';

const outDir = '/Users/hermes-mac/.paperclip/instances/default/projects/0a3b79b9-32aa-495a-9519-802ed7d54d5d/480bc58e-30e0-4fc1-9807-65e92147dca3/_default/sponsee/screenshots';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Pipeline page
  await page.goto('http://localhost:3000/pipeline', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${outDir}/01-pipeline.png`, fullPage: false });
  console.log('Pipeline screenshot saved');

  // Click first deal to go to detail
  const firstDeal = page.locator('.group.cursor-pointer').first();
  if (await firstDeal.count() > 0) {
    await firstDeal.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/02-deal-detail.png`, fullPage: false });
    console.log('Deal detail screenshot saved');
  }

  // Payments page
  await page.goto('http://localhost:3000/payments', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/03-payments.png`, fullPage: false });
  console.log('Payments screenshot saved');

  // Click More on the first invoice to show chase panel
  const moreBtn = page.locator('button:has-text("More")').first();
  if (await moreBtn.count() > 0) {
    await moreBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${outDir}/04-chase-panel.png`, fullPage: false });
    console.log('Chase panel screenshot saved');
  }

  await browser.close();
  console.log('All screenshots captured');
})();
