#!/usr/bin/env node
// Renders icon.svg to the PNG sizes installers actually use.
//
// iOS ignores SVG for the home screen icon, so without apple-touch-icon.png an
// installed app gets a screenshot of the page instead of the mark. Android
// reads the PNGs named in manifest.webmanifest.
//
//   npm install playwright && node tools/make-icons.mjs
//
// Run only when icon.svg changes; the PNGs are checked in.

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SIZES = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const svg = readFileSync('icon.svg', 'utf8');
const browser = await chromium.launch();

for (const [name, size] of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  writeFileSync(name, await page.screenshot({ omitBackground: false }));
  console.log(`wrote ${name} (${size}x${size})`);
  await page.close();
}

await browser.close();
