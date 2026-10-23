import { chromium } from '@playwright/test';
import fs from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const html = fs.readFileSync('index.html','utf8');
const urls = [...new Set([...html.matchAll(/href="(https:\/\/[^"]+)"/g)].map(m=>m[1]))];
const checks = [];
try {
  for (const url of urls) {
    const response = await context.request.get(url, {timeout:30000});
    checks.push({url,status:response.status()});
  }
  const page = await context.newPage();
  await page.goto('https://setu-app.pages.dev/', {waitUntil:'networkidle'});
  const text = await page.locator('body').innerText();
  checks.push({browser:'live prototype unauthenticated shell',url:page.url(),signInExplained:/sign in|sign-in|login/i.test(text),protectedSession:false});
  await page.screenshot({path:'../docs/evaluator-screenshots/live-prototype-sign-in.png'});
  await page.goto('https://github.com/dinamsingh/Setu', {waitUntil:'domcontentloaded'});
  checks.push({browser:'public source repository',url:page.url(),repositoryVisible:await page.getByRole('link',{name:'Setu',exact:true}).count()>0});
  fs.writeFileSync('../docs/evaluator-public-links.json', JSON.stringify(checks,null,2)+'\n');
  console.log(JSON.stringify(checks,null,2));
  if (checks.some(c=>c.status>=400 || c.signInExplained===false || c.repositoryVisible===false)) process.exitCode=1;
} finally { await context.close(); await browser.close(); }
