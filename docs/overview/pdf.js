const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'overview.html')); await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: path.join(__dirname, 'overview.pdf'), format: 'Letter', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await b.close(); })();
