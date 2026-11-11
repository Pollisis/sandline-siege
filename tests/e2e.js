// Headless browser test. Usage: node tests/e2e.js http://localhost:8765/ outdir
const { chromium } = require(process.env.PW_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || 'screenshots';
const fs = require('fs'); fs.mkdirSync(out, { recursive: true });
const log = [], errors = [];
const check = (c, m) => { log.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) errors.push('assert: ' + m); };

const st = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__sand.S)));
async function idle(page) { await page.waitForFunction(() => window.__sand && !window.__sand.busy, null, { timeout: 15000 }); }
async function pt(page, i) { return page.evaluate((i) => { const s = window.__sand.slotXY(i); return window.__sand.toScreen(s.x, s.y); }, i); }
async function drag(page, from, to) {
  const a = await pt(page, from), b = await pt(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + (b.x - a.x) * k / 8, a.y + (b.y - a.y) * k / 8);
  await page.mouse.up(); await page.waitForTimeout(60); await idle(page);
}
// sensible move: pocket -> merge/empty in a lane with something to shoot; else merge; else move toward a target lane
async function pickMove(page) {
  return page.evaluate(() => {
    const S = window.__sand.S, G = window.SandGame, L = G.LANES, P = G.POCKET, t = S.tray;
    const want = (l) => { const x = G.targetInLane(S, l); return x ? (x.type === 'pickup' ? 10 : 5) + x.row : 0; };
    const lanes = [0, 1, 2, 3, 4].sort((a, b) => want(b) - want(a));
    if (S.pocket) { const m = t.findIndex((v) => v === S.pocket); if (m >= 0) return { from: P, to: m }; for (const l of lanes) for (const s of [l, l + L]) if (!t[s]) return { from: P, to: s }; }
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (i !== j && t[i] && t[i] === t[j]) return { from: i, to: j };
    const l = lanes[0];
    for (const s of [l, l + L]) if (!t[s]) { const f = t.findIndex((v, i) => v && i % L !== l); if (f >= 0) return { from: f, to: s }; }
    const f = t.findIndex((v) => v); const e = t.findIndex((v, i) => !v && i !== f); return { from: f, to: e >= 0 ? e : P };
  });
}
async function play(page, n, tag) {
  let collects = 0, turns = 0;
  for (let i = 0; i < n; i++) {
    const s0 = await st(page); if (s0.over) break;
    const m = await pickMove(page);
    await drag(page, m.from, m.to);
    const s1 = await st(page);
    if (s1.turn !== s0.turn + 1) throw new Error(`${tag}: turn did not advance for move ${JSON.stringify(m)}`);
    if (s1.pocket && s1.pocket !== s0.pocket && m.from !== 10) collects++;
    turns++;
  }
  log.push(`${tag}: played ${turns} turns, cannons collected into pocket: ${collects}`);
  return collects;
}
// clear the field (keeps the test scenario deterministic)
async function calm(page) { await page.evaluate(() => { const S = window.__sand.S; S.enemies = []; S.walls = [true, true]; S.wallHits = 0; S.dry = -99; window.__sand.resync(); }); }
async function clickLogical(page, x, y) { const p = await page.evaluate(([x, y]) => window.__sand.toScreen(x, y), [x, y]); await page.mouse.click(p.x, p.y); }
async function useItem(page, k) {
  const p = await page.evaluate((k) => window.__sand.itemXY(k), k); await clickLogical(page, p.x, p.y); await page.waitForTimeout(150);
  const title = await page.evaluate(() => !document.getElementById('overlay').classList.contains('hidden') && document.getElementById('ov-title').textContent);
  if (title) await page.click('#ov-buttons .btn:not(.alt)');
  return title;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console.' + m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(url); await page.waitForFunction(() => window.__sand && window.__sand.ready, null, { timeout: 30000 }); await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__sand.failedAssets.length)) === 0 && (await page.evaluate(() => window.SandArt.ASSETS.every((k) => window.SandArt.has(k)))), 'all raster sprites load (no missing assets)');
  await page.screenshot({ path: `${out}/01-mobile-howto.png` });
  await page.click('#ov-buttons .btn'); await page.waitForTimeout(300);
  let s = await st(page);
  check(s.tray.filter((v) => v).length === 1 && s.tray.includes(1) && !s.pocket, 'starts with one cannon of value 1, empty pocket');
  check(JSON.stringify(Object.keys(s.items)) === '["spray","fire","super"]' && (await page.evaluate(() => window.SandGame.ITEMS.length)) === 3, 'exactly 3 items: Bug Spray, Extra Firepower, Super Component');
  check(s.items.spray === 1 && s.items.fire === 0 && s.items.super === 0, 'power-ups start empty except 1 Bug Spray');
  check(await page.evaluate(() => window.SandAudio.started), 'audio starts on the first user interaction');
  await page.screenshot({ path: `${out}/02-mobile-start.png` });

  // natural play until something lands in the pocket
  let col = 0; for (let k = 0; k < 6 && !col; k++) col += await play(page, 5, 'opening');
  check(col > 0, 'shooting a field cannon drops it into the pocket');
  s = await st(page);
  check(s.tray.filter((v) => v).length <= 1 + col, 'no auto-refill: tray only grows from collected cannons');

  // swap via drag (set up two different values)
  await page.evaluate(() => { const S = window.__sand.S; S.tray[5] = 2; S.tray[6] = 4; });
  await drag(page, 5, 6); s = await st(page);
  check(s.tray[5] === 4 && s.tray[6] === 2, 'drag onto a different value swaps');
  // park a cannon in the pocket (pocket empty or swap)
  await calm(page);
  await page.evaluate(() => { window.__sand.S.pocket = 0; window.__sand.S.tray[7] = 8; });
  await drag(page, 7, 10); s = await st(page);
  check(s.pocket === 8 && !s.tray[7], 'drag a tray cannon into the pocket');
  await calm(page); await page.evaluate(() => { window.__sand.S.tray[8] = 8; }); await drag(page, 10, 8); s = await st(page);
  check(s.tray[8] === 16 && !s.pocket, 'pocket cannon merges onto an equal tray cannon');

  // no charges -> no dialog, hint toast
  await page.evaluate(() => { const S = window.__sand.S; S.items = { spray: 1, fire: 0, super: 0 }; });
  check((await useItem(page, 'fire')) === false, 'a power-up with 0 charges cannot be used');
  // Super Component on a cannon < 32
  await page.evaluate(() => { const S = window.__sand.S; S.tray[9] = 4; S.items = { spray: 1, fire: 1, super: 1 }; S.itemUsed = { spray: 0, fire: 0, super: 0 }; });
  const t1 = await useItem(page, 'super'); const p9 = await pt(page, 9); await page.mouse.click(p9.x, p9.y); await page.waitForTimeout(150);
  s = await st(page); check(t1 === 'Super Component' && s.tray[9] === 8 && s.items.super === 0 && s.itemUsed.super === 1, 'Super Component doubles a cannon (charge spent, 1/10 used)');
  // Extra Firepower
  await page.evaluate(() => { const S = window.__sand.S; S.enemies.push({ id: 7001, type: 'crawler', lane: 2, row: 2, w: 1, hp: 999, maxHp: 999 }); window.__sand.resync(); });
  await useItem(page, 'fire'); await clickLogical(page, (await page.evaluate(() => window.__sand.laneX(2))), await page.evaluate(() => window.__sand.rowY(2)));
  await page.waitForTimeout(150); s = await st(page);
  const atk = s.tray.reduce((a, b) => a + b, 0);
  check(s.enemies.find((e) => e.id === 7001).hp === 999 - Math.ceil(atk / 2), 'Extra Firepower hits for 50% of total cannon attack');
  // overkill carry-through in the browser
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S; S.tray = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; S.tray[2] = 16; S.tray[0] = 1; S.pocket = 0;
    S.enemies.push({ id: 7400, type: 'crawler', lane: 2, row: 4, w: 1, hp: 5, maxHp: 5 }, { id: 7401, type: 'crawler', lane: 2, row: 2, w: 1, hp: 6, maxHp: 6 }, { id: 7402, type: 'crawler', lane: 2, row: 0, w: 1, hp: 50, maxHp: 50 }); window.__sand.resync(); });
  await drag(page, 0, 1); s = await st(page);
  check(!s.enemies.some((e) => e.id === 7400 || e.id === 7401) && s.enemies.find((e) => e.id === 7402).hp === 45, 'overkill carry-through: 16 dmg kills 5hp + 6hp, 5 surplus hits the third scorpion');
  // Brood Queen killed with big surplus still hatches 3 young on the next move
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S; S.tray = [512, 512, 0, 0, 0, 0, 0, 0, 0, 0]; S.pocket = 0;
    S.enemies.push({ id: 7500, type: 'queen', lane: 0, row: 2, w: 2, hp: 30, maxHp: 30 }); window.__sand.resync(); });
  await drag(page, 0, 5); s = await st(page);
  const hatch = s.enemies.filter((e) => e.type === 'hatchling');
  check(hatch.length === 3 && hatch.every((h) => h.hp === 6 && h.row >= 1), 'Brood Queen killed with surplus: 3 hatchlings (20% HP) appear on the next move');
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S; S.tray = [4, 8, 16, 32, 64, 128, 256, 512, 2, 1]; });
  await play(page, 6, 'mid');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/03-mobile-midgame.png` });

  // first barricade hit is free, Bug Spray repairs it
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S, R = window.SandGame.ROWS - 1; S.enemies = S.enemies.filter((e) => !(e.row === R)); S.enemies.push({ id: 7100, type: 'crawler', lane: 0, row: R, w: 1, hp: 99999, maxHp: 99999 }); window.__sand.resync(); });
  await play(page, 1, 'wall-hit');
  s = await st(page); check(!s.walls[0] && s.wallHits === 1 && !s.over, 'first scorpion at the barricade smashes it (free hit), game continues');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/04-mobile-barricade-broken.png` });
  const t2 = await useItem(page, 'spray'); await page.waitForTimeout(200); s = await st(page);
  check(t2 === 'Bug Spray' && s.walls[0] && s.wallHits === 0, 'Bug Spray repairs the smashed barricade');

  // forced level-up
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S; S.tray[0] = S.tray[0] || 2; S.enemies.push({ id: 7300, type: 'crawler', lane: 0, row: 2, w: 1, hp: 1, maxHp: 50 }); window.__sand.resync(); });
  await page.evaluate(() => { const S = window.__sand.S; S.kills = 24; for (const e of S.enemies) if (e.type !== 'pickup') e.hp = 1; });
  const lv0 = (await st(page)).level; await play(page, 2, 'level-up');
  s = await st(page); check(s.level === lv0 + 1 && s.kills < 25, `seamless level-up ${lv0} -> ${s.level} (counter ${s.kills}/25)`);
  const sumIt = (x) => x.items.spray + x.items.fire + x.items.super + x.itemUsed.spray + x.itemUsed.fire + x.itemUsed.super;
  check(sumIt(s) >= 4, 'level-up awards a power-up charge');

  // two hits = game over
  await calm(page);
  await page.evaluate(() => { const S = window.__sand.S, R = window.SandGame.ROWS - 1; S.enemies = S.enemies.filter((e) => e.row < R - 1);
    S.enemies.push({ id: 7200, type: 'crawler', lane: 0, row: R, w: 1, hp: 99999, maxHp: 99999 }, { id: 7201, type: 'crawler', lane: 4, row: R - 1, w: 1, hp: 99999, maxHp: 99999 }); window.__sand.resync(); });
  await play(page, 3, 'game-over');
  await page.waitForTimeout(1400);
  const over = await page.evaluate(() => !document.getElementById('overlay').classList.contains('hidden') && document.getElementById('ov-title').textContent);
  check(over === 'The Barricades Have Fallen', 'second barricade hit ends the run with the game-over dialog');
  await page.screenshot({ path: `${out}/05-mobile-gameover.png` });
  check((await page.textContent('#ov-buttons .btn')) === 'Save Score', 'qualifying score offers Save Score');
  await page.click('#ov-buttons .btn'); await page.waitForTimeout(200);
  await page.fill('#hs-name', 'SG'); await page.click('#ov-buttons .btn'); await page.waitForTimeout(200);
  check((await page.textContent('#ov-title')) === 'High Scores' && (await page.textContent('table.scores tr.me')).includes('SG'), 'name prompt saves the score into the top-10 list');
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('sandline.scores'))))[0].name === 'SG', 'high scores stored in localStorage');
  await page.screenshot({ path: `${out}/11-mobile-highscores.png` });
  await page.click('#ov-buttons .btn'); await page.waitForTimeout(300);
  s = await st(page); check(!s.over && s.turn === 0, 'Play Again starts a fresh run');
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('sandline.best')))) > 0, 'best score saved to localStorage');
  // settings panel via the gear
  await clickLogical(page, 540 - 86, 108); await page.waitForTimeout(250);
  check((await page.textContent('#ov-title')) === 'Settings', 'gear opens the Settings panel');
  await page.evaluate(() => { const r = document.getElementById('vol-music'); r.value = 25; r.dispatchEvent(new Event('input')); const f = document.getElementById('vol-sfx'); f.value = 60; f.dispatchEvent(new Event('input')); });
  const set = await page.evaluate(() => JSON.parse(localStorage.getItem('sandline.settings')));
  check(set.music === 0.25 && set.sfx === 0.6 && set.mute === false, 'music and SFX volumes saved to localStorage');
  await page.screenshot({ path: `${out}/12-mobile-settings.png` });
  await page.click('#mute-all'); check((await page.evaluate(() => JSON.parse(localStorage.getItem('sandline.settings')).mute)) === true, 'mute toggle saved');
  await page.click('#mute-all'); await page.click('#ov-buttons .btn'); await page.waitForTimeout(200);
  await clickLogical(page, 540 - 136, 108); await page.waitForTimeout(250);
  check((await page.textContent('#ov-title')) === 'High Scores', 'trophy button opens High Scores');
  await page.click('#ov-buttons .btn'); await page.waitForTimeout(200);

  // ---- desktop ----
  const d = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  d.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message));
  d.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  await d.goto(url); await d.waitForFunction(() => window.__sand && window.__sand.ready, null, { timeout: 30000 }); await d.waitForTimeout(300); await d.click('#ov-buttons .btn');
  await play(d, 10, 'desktop');
  const gb = await d.evaluate(() => window.__sand.toScreen(window.__sand.W - 34, 108)); await d.mouse.click(gb.x, gb.y); await d.waitForTimeout(300);
  check((await d.textContent('#ov-title')) === 'Scorpion Guidebook', 'guidebook opens');
  await d.screenshot({ path: `${out}/06-desktop-guide.png` });
  await d.click('#ov-buttons .btn'); await d.waitForTimeout(200);
  await d.screenshot({ path: `${out}/07-desktop.png` });

  // ---- iPad portrait, real touch tap-tap ----
  const ip = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  ip.on('pageerror', (e) => errors.push('ipad pageerror: ' + e.message));
  await ip.goto(url); await ip.waitForFunction(() => window.__sand && window.__sand.ready, null, { timeout: 30000 }); await ip.waitForTimeout(300); await ip.click('#ov-buttons .btn');
  const m = await pickMove(ip), a = await pt(ip, m.from), b = await pt(ip, m.to);
  const t0 = (await st(ip)).turn;
  await ip.touchscreen.tap(a.x, a.y); await ip.waitForTimeout(100); await ip.touchscreen.tap(b.x, b.y); await ip.waitForTimeout(100); await idle(ip);
  check((await st(ip)).turn === t0 + 1, 'iPad touch tap-to-select then tap-to-place makes a move');
  await play(ip, 8, 'ipad');
  await ip.screenshot({ path: `${out}/08-ipad.png` });
  await browser.close();
  console.log(log.join('\n'));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors; all checks passed.');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(2); });
