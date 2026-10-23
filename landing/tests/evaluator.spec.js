import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('fresh visitor understands purpose and starts without credentials', async ({ page, context }, info) => {
  expect(await context.cookies()).toEqual([]);
  await expect(page.locator('.hero-copy')).toContainText('links site progress reports to Primavera P6');
  await expect(page.locator('.hero-caption')).toContainText('No credentials needed');
  await mkdir('../docs/evaluator-screenshots', { recursive: true });
  await page.screenshot({ path: `../docs/evaluator-screenshots/${info.project.name}-home.png` });
  await page.getByRole('link', { name: 'Explore SETU Demo' }).click();
  await expect(page.locator('#sample-stage')).toContainText('Example Supervisor observation');
  await page.locator('#product').screenshot({ path: `../docs/evaluator-screenshots/${info.project.name}-demo.png`, style: '.site-nav{visibility:hidden}' });
});

for (const example of ['0', '1', '2']) {
  test(`example ${example}: six stages, decision, audit, back and restart`, async ({ page }, info) => {
    await page.locator('#sample-report').selectOption(example);
    for (let i = 1; i <= 6; i++) {
      await expect(page.locator('#stage-progress')).toHaveText(`Step ${i} of 6`);
      await expect(page.locator('[data-stage][aria-current="step"]')).toHaveCount(1);
      if (i < 6) await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(page.locator('#sample-stage')).toContainText(`DEMO-AUDIT-00${Number(example)+1}`);
    await expect(page.locator('#sample-stage')).toContainText('Baseline remains');
    await expect(page.locator('#sample-stage')).toContainText('not saved to a database');
    await expect(page.locator('#sample-stage')).toContainText(example === '2' ? 'Reject suggested link' : 'Request clarification');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    if (example === '0') {
      await page.locator('#product').screenshot({ path: `../docs/evaluator-screenshots/${info.project.name}-audit.png`, style: '.site-nav{visibility:hidden}' });
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#sample-stage')).toContainText('Sample planner review');
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(page.locator('#sample-report')).toHaveValue('0');
    await expect(page.locator('#stage-progress')).toHaveText('Step 1 of 6');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  });
}

test('homepage anchors, source links and live-app barriers are explained', async ({ page }) => {
  const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(n => ({href:n.getAttribute('href'),text:n.textContent})));
  for (const link of links) {
    expect(link.href).not.toBe('#');
    if (link.href.startsWith('#')) await expect(page.locator(link.href)).toHaveCount(1);
    if (link.href.includes('setu-app.pages.dev')) expect(link.text).toMatch(/sign-in/i);
  }
  await expect(page.getByRole('link', {name:'Landing page source →'})).toHaveAttribute('href','https://github.com/dinamsingh/Setu/tree/main/landing');
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(n=>n.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of await page.locator('a[href^="#"]:visible:not(.skip)').all()) {
    await link.click();
    const href = await link.getAttribute('href');
    await expect(page.locator(href)).toBeAttached();
  }
});

test('keyboard navigation, focus and mobile menu', async ({ page }, info) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', {name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', {name:'Open navigation'}).click();
    await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('#menu-toggle')).toBeFocused();
  }
  await page.locator('[data-stage="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sample-stage')).toBeFocused();
  await expect(page.locator('#stage-progress')).toHaveText('Step 2 of 6');
});

test('no console errors, failed assets, backend requests or persistence', async ({ page, context }) => {
  const errors = [], requests = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  page.on('request', r => requests.push({url:r.url(),method:r.method()}));
  page.on('response', r => {if(r.status()>=400) failed.push(r.url());});
  await page.reload();
  for (let i=0;i<5;i++) await page.locator('#next-stage').click();
  expect(errors).toEqual([]); expect(failed).toEqual([]);
  expect(requests.every(r=>r.method==='GET' && new URL(r.url).hostname==='127.0.0.1')).toBe(true);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.reload();
  await expect(page.locator('#stage-progress')).toHaveText('Step 1 of 6');
});

test('WCAG A/AA checks across all six stages and responsive widths', async ({ page }) => {
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (let i=0;i<6;i++) {
    await page.locator(`[data-stage="${i}"]`).click();
    const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(scan.violations, JSON.stringify(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))).toEqual([]);
  }
});

test('malformed fixture has an honest recoverable error state', async ({ page }) => {
  await page.route('**/assets/evaluator-demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: "document.getElementById('landing-samples').textContent='invalid';\n" + await response.text() });
  });
  await page.reload();
  await expect(page.locator('#sample-stage')).toContainText('Demo could not load');
  await expect(page.locator('#sample-stage')).toContainText('No report was submitted');
  await expect(page.locator('#next-stage')).toBeDisabled();
});

test('script-unavailable visitor gets observation and text walkthrough', async ({ browser }) => {
  const context=await browser.newContext({javaScriptEnabled:false});
  const page=await context.newPage();
  await page.route('**/assets/evaluator-demo.js', route => route.abort());
  await page.goto('http://127.0.0.1:4178');
  await expect(page.getByRole('link', {name:'read the complete six-step text walkthrough →'})).toBeVisible();
  await expect(page.locator('#report-text')).toContainText('Spool erection');
  await context.close();
});
