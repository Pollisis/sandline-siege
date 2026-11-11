// Headless browser test. Usage: node tests/e2e.js http://localhost:8765/ outdir
const { chromium } = require(process.env.PW_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || 'screenshots';
const fs = require('fs'); fs.mkdirSync(out, { recursive: true });

async function idle(page) { await page.waitForFunction(() => window.__sand && !window.__sand.busy, null, { timeout: 10000 }); }
async function pickMove(page) {
  return page.evaluate(() => {
    const S = window.__sand.S, t = S.tray, n = t.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && t[i] && t[i] === t[j]) return { from: i, to: j, kind: 'merge' };
    const e = t.indexOf(0), f = t.findIndex((v) => v);
    if (e >= 0 && f >= 0) return { from: f, to: e, kind: 'move' };
    return null;
  });
}
async function screenPt(page, x, y) { return page.evaluate(([x, y]) => window.__sand.toScreen(x, y), [x, y]); }
async function slotPt(page, i) { return page.evaluate((i) => { const s = window.__sand.slotXY(i); return window.__sand.toScreen(s.x, s.y); }, i); }
async function drag(page, from, to) {
  const a = await slotPt(page, from), b = await slotPt(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + (b.x - a.x) * k / 8, a.y + (b.y - a.y) * k / 8);
  await page.mouse.up();
}
async function playTurns(page, n, log) {
  let merges = 0, moves = 0, passes = 0, bubbles = 0;
  for (let i = 0; i < n; i++) {
    await idle(page);
    if (await page.evaluate(() => window.__sand.S.over)) break;
    // grab bubbles (free)
    const bub = await page.evaluate(() => { const S = window.__sand.S; const b = S.bubbles[0]; if (!b || S.tray.indexOf(0) < 0) return null; return window.__sand.toScreen(b.lane * window.__sand.LW + window.__sand.LW / 2, window.__sand.rowY(b.row)); });
    if (bub) { const before = await page.evaluate(() => window.__sand.S.bubbles.length); await page.mouse.click(bub.x, bub.y); await page.waitForTimeout(100); if ((await page.evaluate(() => window.__sand.S.bubbles.length)) < before) bubbles++; }
    const turn0 = await page.evaluate(() => window.__sand.S.turn);
    const m = await pickMove(page);
    if (!m) { const p = await screenPt(page, 240, 666 + 104); await page.mouse.click(p.x, p.y); passes++; }
    else { await drag(page, m.from, m.to); m.kind === 'merge' ? merges++ : moves++; }
    await page.waitForTimeout(80); await idle(page);
    const turn1 = await page.evaluate(() => window.__sand.S.turn);
    if (turn1 !== turn0 + 1 && !(await page.evaluate(() => window.__sand.S.over))) throw new Error(`turn did not advance on ${JSON.stringify(m)} (${turn0}->${turn1})`);
  }
  log.push(`played turns: merges=${merges} moves=${moves} passes=${passes} bubbles collected=${bubbles}`);
}

(async () => {
  const browser = await chromium.launch();
  const log = [], errors = [];
  // ---- mobile portrait ----
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console.' + m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/01-mobile-howto.png` });
  await page.click('#ov-buttons .btn'); await page.waitForTimeout(300);
  // tap-to-touch also works
  await page.screenshot({ path: `${out}/02-mobile-start.png` });
  await playTurns(page, 14, log);
  // Use the Bomb item: click item button, confirm, tap a tile with a bug
  const bombBtn = await page.evaluate(() => { const iw = 84, gap = 6, start = 240 - (iw * 4 + gap * 3) / 2; return window.__sand.toScreen(start + 3 * (iw + gap) + 42, 880 + 40); });
  await page.mouse.click(bombBtn.x, bombBtn.y); await page.waitForTimeout(200);
  const dlg = await page.textContent('#ov-title'); log.push('item dialog: ' + dlg);
  await page.click('#ov-buttons .btn:not(.alt)');
  const tgt = await page.evaluate(() => { const S = window.__sand.S; const e = S.enemies.slice().sort((a, b) => b.row - a.row)[0]; return { pt: window.__sand.toScreen(e.lane * 120 + 60, window.__sand.rowY(e.row)), hp: S.enemies.reduce((a, x) => a + x.hp, 0), bombs: S.items.bomb }; });
  await page.mouse.click(tgt.pt.x, tgt.pt.y); await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ hp: window.__sand.S.enemies.reduce((a, x) => a + x.hp, 0), bombs: window.__sand.S.items.bomb }));
  log.push(`bomb: total bug HP ${tgt.hp} -> ${after.hp}, bombs ${tgt.bombs} -> ${after.bombs}`);
  await playTurns(page, 6, log);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/03-mobile-midgame.png` });
  // ---- force a level-up ----
  await page.evaluate(() => { const S = window.__sand.S; S.kills = 24; for (const e of S.enemies) { e.hp = 1; } });
  let lvl0 = await page.evaluate(() => window.__sand.S.level);
  for (let i = 0; i < 4 && (await page.evaluate(() => window.__sand.S.level)) === lvl0; i++) {
    const m = await pickMove(page); if (!m) break;
    await drag(page, m.from, m.to); await page.waitForTimeout(650);
    if ((await page.evaluate(() => window.__sand.S.level)) > lvl0) await page.screenshot({ path: `${out}/04-mobile-levelup.png` });
    await idle(page);
  }
  const lvl = await page.evaluate(() => ({ level: window.__sand.S.level, kills: window.__sand.S.kills }));
  log.push(`level-up: level ${lvl0} -> ${lvl.level}, kill counter now ${lvl.kills}/25`);
  // ---- force game over: weaken walls and park bugs at the wall ----
  await page.evaluate(() => { const S = window.__sand.S; S.walls.forEach((w) => (w.hp = 1)); S.enemies.length = 0;
    S.enemies.push({ id: 9001, type: 'crawler', lane: 0, row: 4, w: 1, hp: 99999, maxHp: 99999 }, { id: 9002, type: 'crawler', lane: 3, row: 4, w: 1, hp: 99999, maxHp: 99999 }); });
  await playTurns(page, 2, log);
  await page.waitForTimeout(1300);
  const overTitle = await page.evaluate(() => !document.getElementById('overlay').classList.contains('hidden') && document.getElementById('ov-title').textContent);
  log.push('game over dialog: ' + overTitle);
  await page.screenshot({ path: `${out}/05-mobile-gameover.png` });
  await page.click('#ov-buttons .btn');
  await page.waitForTimeout(300);
  const fresh = await page.evaluate(() => ({ over: window.__sand.S.over, turn: window.__sand.S.turn, best: JSON.parse(localStorage.getItem('sandline.best')) }));
  log.push(`after Play Again: over=${fresh.over} turn=${fresh.turn}, saved best=${fresh.best}`);
  // ---- desktop ----
  const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const dp = await dctx.newPage();
  dp.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('desktop console.' + m.type() + ': ' + m.text()); });
  dp.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message));
  await dp.goto(url); await dp.waitForTimeout(400);
  await dp.click('#ov-buttons .btn');
  await playTurns(dp, 10, log);
  // guidebook
  const gb = await dp.evaluate(() => window.__sand.toScreen(480 - 31, 31)); await dp.mouse.click(gb.x, gb.y); await dp.waitForTimeout(300);
  log.push('guide dialog: ' + await dp.textContent('#ov-title'));
  await dp.screenshot({ path: `${out}/06-desktop-guide.png` });
  await dp.click('#ov-buttons .btn'); await dp.waitForTimeout(200);
  await dp.screenshot({ path: `${out}/07-desktop-midgame.png` });
  // iPad portrait
  const ictx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ip = await ictx.newPage(); ip.on('pageerror', (e) => errors.push('ipad pageerror: ' + e.message));
  await ip.goto(url); await ip.waitForTimeout(300); await ip.click('#ov-buttons .btn');
  // real touch tap test: tap-select then tap-target
  const m = await pickMove(ip); const a = await slotPt(ip, m.from), b = await slotPt(ip, m.to);
  const t0 = await ip.evaluate(() => window.__sand.S.turn);
  await ip.touchscreen.tap(a.x, a.y); await ip.waitForTimeout(100); await ip.touchscreen.tap(b.x, b.y); await ip.waitForTimeout(100); await idle(ip);
  log.push(`ipad touch tap-tap move (${m.kind}): turn ${t0} -> ${await ip.evaluate(() => window.__sand.S.turn)}`);
  await playTurns(ip, 5, log);
  await ip.screenshot({ path: `${out}/08-ipad.png` });
  await browser.close();
  console.log(log.join('\n'));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(2); });
