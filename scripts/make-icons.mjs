// Renders icons/icon.svg to the PNG sizes the browsers need.
// Usage: node scripts/make-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/chrome.mjs';

const dir = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = await readFile(dir + 'icon.svg', 'utf8');
const { page, close } = await launch();
try {
  await page('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const size of [16, 32, 48, 128]) {
    await page('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    await page('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await new Promise((r) => setTimeout(r, 300));
    const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    await writeFile(`${dir}icon-${size}.png`, Buffer.from(data, 'base64'));
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await close();
}
