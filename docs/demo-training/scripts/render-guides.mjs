#!/usr/bin/env node
import { createRequire } from 'node:module';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const output = path.join(root, 'output', 'pdf');
const guides = ['index', 'retail', 'warehouse', 'workshop', 'operator'];

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {}
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const name of guides) {
    const source = path.join(root, `${name}.html`);
    const target = path.join(output, `${name}.pdf`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const overflow = await page.locator('.sheet').evaluateAll((sheets) =>
      sheets.flatMap((sheet, index) => {
        const problems = [];
        if (sheet.scrollWidth > sheet.clientWidth + 1) problems.push(`page ${index + 1}: horizontal overflow ${sheet.scrollWidth - sheet.clientWidth}px`);
        if (sheet.scrollHeight > sheet.clientHeight + 1) problems.push(`page ${index + 1}: vertical overflow ${sheet.scrollHeight - sheet.clientHeight}px`);
        return problems;
      }),
    );
    if (overflow.length) throw new Error(`${name}.html layout overflow:\n${overflow.join('\n')}`);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: target,
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    });
    console.log(`${name}.html -> ${path.relative(process.cwd(), target)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
