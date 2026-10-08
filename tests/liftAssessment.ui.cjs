const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('../node_modules/esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  await esbuild.build({ entryPoints: ['src/App.jsx'], bundle: true, jsx: 'automatic', write: false, format: 'esm', loader: { '.png': 'dataurl', '.jpg': 'dataurl' }, logLevel: 'silent' });
  const compiled = await esbuild.build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import LiftAssessment from './src/components/LiftAssessment';import CraneLoadTables from './src/components/CraneLoadTables';createRoot(document.getElementById('root')).render(<><LiftAssessment/><CraneLoadTables onPreview={()=>{}}/></>);", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, jsx: 'automatic', write: false, format: 'iife', define: { 'import.meta.url': JSON.stringify('http://127.0.0.1:4175/src/lib/craneCatalog.js') }, logLevel: 'silent' });
  const css = fs.readFileSync('src/styles.css', 'utf8') + fs.readFileSync('src/design.css', 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(`<html data-theme="light"><head><style>${css}</style></head><body><main class="app-shell"><div class="content" id="root"></div></main></body></html>`);
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    await page.getByRole('heading', { name: 'Izaje', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Evaluar capacidad del izaje' }).click();
    await page.getByRole('heading', { name: 'Pendiente de verificar' }).waitFor();
    await page.getByLabel('Modelo de grúa', { exact: true }).selectOption('f660-25');
    await page.getByLabel('Alcance / radio de la tabla (m)').selectOption('13.8');
    await page.getByLabel('Peso de la carga (kg)', { exact: true }).fill('2500');
    await page.getByLabel(/Verifiqué que todas/).check();
    await page.getByLabel(/Verifiqué este punto/).check();
    await page.getByRole('heading', { name: 'Dentro de las capacidades ingresadas' }).waitFor();
    await page.getByLabel('Alcance / radio de la tabla (m)').selectOption('5.85');
    await page.getByRole('heading', { name: 'Pendiente de verificar' }).waitFor();
    assert.equal(await page.getByLabel('Alcance / radio de la tabla (m)').locator('option:checked').textContent(), '5,85 m');
    await page.getByLabel(/Verifiqué este punto/).check();
    await page.getByLabel('Peso de la carga (kg)', { exact: true }).fill('3000');
    await page.getByRole('heading', { name: 'No cumple la capacidad' }).waitFor();
    await page.getByRole('group', { name: 'Cantidad de eslingas' }).getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: '60°', exact: true }).click();
    await page.getByLabel(/Verifiqué que todas/).check();
    await page.getByLabel(/La carga está equilibrada/).check();
    await page.getByRole('heading', { name: 'Dentro de las capacidades ingresadas' }).waitFor();
    await page.getByRole('group', { name: 'Posicionamiento de eslingas' }).getByRole('button', { name: /Lazo/ }).click();
    await page.getByRole('heading', { name: 'Pendiente de verificar' }).waitFor();
    await page.getByLabel(/Verifiqué que todas/).check();
    await page.getByLabel(/La carga está equilibrada/).check();
    await page.getByLabel(/El ángulo de estrangulación/).check();
    await page.getByRole('heading', { name: 'Dentro de las capacidades ingresadas' }).waitFor();
    await page.getByRole('group', { name: 'Largo de eslinga' }).getByRole('button', { name: '10 m', exact: true }).click();
    await page.getByRole('heading', { name: 'Pendiente de verificar' }).waitFor();
    await page.getByLabel(/Verifiqué que todas/).check();
    await page.getByLabel(/La carga está equilibrada/).check();
    await page.getByLabel(/Capacidad de referencia/).selectOption('label');
    await page.getByLabel('Capacidad por eslinga en lazo (kg)').fill('2000');
    await page.getByLabel(/Verifiqué que todas/).check();
    await page.getByRole('group', { name: 'Posicionamiento de eslingas' }).getByRole('button', { name: /Canasta/ }).click();
    assert.equal(await page.getByLabel('Capacidad por eslinga en canasta (kg)').inputValue(), '');
    await page.getByRole('heading', { name: 'Pendiente de verificar' }).waitFor();
    await page.getByLabel('Marca', { exact: true }).selectOption('Palfinger');
    await page.getByLabel('Serie', { exact: true }).selectOption('PK 32080');
    await page.getByLabel('Versión / submodelo').selectOption('pk32080-b');
    assert.equal(await page.locator('.lift-capacity-table tbody tr').count(), 5);
    fs.mkdirSync('tmp/lift-qa', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      for (const [width, height] of [[375,812], [812,375], [1024,768]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0,0));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })).slice(0,20)));
        assert.equal(overflow, false, `${theme} ${width}: horizontal overflow`);
        const undersized = await page.locator('.lift-workspace button:visible').evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().height < 44 || button.getBoundingClientRect().width < 44).length);
        assert.equal(undersized, 0, 'Touch targets too small');
        await page.screenshot({ path: `tmp/lift-qa/${theme}-${width}.png` });
      }
    }
    await page.setViewportSize({ width:375, height:812 });
    await page.evaluate(() => { const sizes = [...document.querySelectorAll('.lift-workspace *')].map((element) => [element, parseFloat(getComputedStyle(element).fontSize)]); for (const [element, size] of sizes) element.style.fontSize = `${size * 2}px`; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Large text overflow');
    await page.screenshot({ path: 'tmp/lift-qa/large-text.png' });
    assert.deepEqual(errors, []);
    console.log('App compiles; capacity flow, stale confirmations, exact radii, crane library and responsive themes verified.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
