import puppeteer from 'puppeteer-core';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = '/Users/hermes-mac/.paperclip/instances/default/projects/0a3b79b9-32aa-495a-9519-802ed7d54d5d/480bc58e-30e0-4fc1-9807-65e92147dca3/_default/sponsee/screenshots';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Pipeline page
  await page.goto('http://localhost:3000/pipeline', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `${outDir}/01-pipeline.png` });
  console.log('Pipeline screenshot saved');

  // Click first deal
  const dealCards = await page.$$('.group.cursor-pointer');
  if (dealCards.length > 0) {
    await dealCards[0].click();
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: `${outDir}/02-deal-detail.png` });
    console.log('Deal detail screenshot saved');
  }

  // Payments page
  await page.goto('http://localhost:3000/payments', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `${outDir}/03-payments.png` });
  console.log('Payments screenshot saved');

  // Expand chase panel
  const moreBtns = await page.$$('button');
  for (const btn of moreBtns) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('More')) {
      await btn.click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: `${outDir}/04-chase-panel.png` });
      console.log('Chase panel screenshot saved');
      break;
    }
  }

  await browser.close();
  console.log('All screenshots captured');
})();
