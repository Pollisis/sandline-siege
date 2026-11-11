/* Sandline Siege - rendering, input, audio (original canvas art) */
(() => {
  'use strict';
  const G = window.SandGame;
  const LANES = G.LANES, ROWS = G.ROWS, POCKET = G.POCKET;
  // ---- logical layout (portrait) ----
  const W = 540, BASE_H = 1030;
  const FX = 40, LW = 92, FW = LW * LANES;          // field x-range 40..500
  const HDR = 132, FY = 142, CH = 84, FB = FY + CH * ROWS; // field rows 142..646
  const WC = FB + 30;                                 // barricade centre line
  const TY = FB + 62, SH = 94;                        // tray rows
  const BY = TY + SH * 2 + 14;                        // bottom bar (items + pocket)
  const POCK = { x: FX + 4 * LW + LW / 2, y: BY + 46 };
  let H = BASE_H, OY = 0;
  const cv = document.getElementById('game'), ctx = cv.getContext('2d');
  let scale = 1, dpr = 1;

  // ---------- persistence ----------
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('sandline.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem('sandline.' + k, JSON.stringify(v)); } catch (e) {} } };
  let best = LS.get('best', 0), lifetime = LS.get('lifetime', 0);
  // ---------- audio (see audio.js) ----------
  const A = window.SandAudio;
  const sfx = new Proxy({}, { get: (_, k) => (...args) => A.play(k, ...args) });
  const audio = () => A.unlock();

  // ---------- layout helpers ----------
  const laneX = (l) => FX + l * LW + LW / 2;
  const rowY = (r) => FY + r * CH + CH / 2;
  const slotXY = (i) => (i === POCKET ? { x: POCK.x, y: POCK.y } : { x: laneX(i % LANES), y: TY + Math.floor(i / LANES) * SH + SH / 2 });
  const { tierOf: tier, tierIdx, TIERS, rr, text, lin, rad, plaque, drawCannon, valueTag, drawScorpion, drawPickup, hpBar, drawBarricade, itemIcon } = window.SandArt;

  // ---------- state ----------
  let S, vis, projectiles, floaters, particles, slotFx, toast, busy, mode, drag, tapSel, shake, overShown, pocketShown, wallAnim, flyers, itemFlyers, eggs, itemPulse;
  const now = () => performance.now();

  function newRun() {
    S = G.newGame();
    vis = new Map(); projectiles = []; floaters = []; particles = []; slotFx = {}; flyers = []; itemFlyers = []; eggs = []; itemPulse = {};
    toast = null; busy = false; mode = null; drag = null; tapSel = -1; shake = 0; overShown = false; pocketShown = 0; wallAnim = [0, 0];
    sync(0, true);
    showToast('Shoot the field cannons to collect them!', 2400, '#fff3c4');
  }
  window.__sand = { get S() { return S; }, slotXY, rowY, laneX, get W() { return W; }, get H() { return H; }, FX, LW, FY, CH, TY, SH, BY, POCKET, POCK, get busy() { return busy; }, toScreen: (x, y) => toScreen(x, y), itemXY: (k) => itemXY(k), resync: () => { vis.clear(); sync(1, true); } };

  function sync(appearDelay, reconcile) {
    const t = now(), ids = new Set();
    for (const e of S.enemies) {
      ids.add(e.id);
      let v = vis.get(e.id);
      if (!v) {
        v = { id: e.id, type: e.type, lane: e.lane, w: e.w, row: e.row, dRow: appearDelay ? e.row : e.row - 0.9, hp: e.hp, maxHp: e.maxHp, value: e.value,
          appear: t + appearDelay, seed: Math.random() * 10, hitT: 0 };
        vis.set(e.id, v);
      } else { v.row = e.row; v.lane = e.lane; if (reconcile) { v.hp = e.hp; v.maxHp = e.maxHp; } }
    }
    for (const [id, v] of vis) if (!ids.has(id) && !v.dying) { puff(ex(v), rowY(v.dRow), '#f3d08a', 10); vis.delete(id); }
  }
  const ex = (v) => FX + (v.lane + v.w / 2) * LW;

  // ---------- fx ----------
  function puff(x, y, color, n = 14, spd = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (60 + Math.random() * 160) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.5 + Math.random() * 0.4, t: 0, r: 4 + Math.random() * 7, color });
    }
  }
  function floater(x, y, text, color = '#ff3b2f', size = 28, life = 0.9) { floaters.push({ x, y, text, color, size, t: 0, life }); }
  function showToast(text, ms = 1600, color = '#fff') { toast = { text, until: now() + ms, start: now(), color }; }

  function killVis(id, pts) {
    const v = vis.get(id); if (!v) return;
    const x = ex(v), y = rowY(v.dRow);
    puff(x, y, v.type === 'queen' ? '#5a2030' : v.type === 'giant' ? '#8a6040' : '#c0452a', v.w === 2 ? 24 : 14);
    puff(x, y, '#f6d79a', 10);
    if (pts) floater(x, y - 26, '+' + pts, '#ffe14a', 24, 1.1);
    sfx.kill();
    vis.delete(id);
  }

  function shotsFx(evs) {
    let k = 0, end = now();
    const killPts = {}, coll = evs.find((e) => e.type === 'collect');
    for (const e of evs) if (e.type === 'kill') killPts[e.id] = e.pts;
    for (const e of evs) {
      if (e.type !== 'shot') continue;
      const s = slotXY(e.slot), hits = e.hits || [];
      for (const h of hits) { const v = vis.get(h.targetId); if (v && (h.killed || h.pickup)) v.dying = true; }
      const lastRow = hits.length ? (e.surplus > 0 ? -0.6 : hits[hits.length - 1].row) : -0.6;
      const delay = (k++) * 45, dur = 230 + 40 * Math.max(0, hits.length - 1);
      const tr = tier(e.dmg);
      const segs = hits.map((h) => ({ ...h, fired: false }));
      projectiles.push({ x0: s.x, y0: s.y - 36, t0: now() + delay, dur, color: tr.glow, r: Math.min(13, 5 + Math.log2(e.dmg + 1) * 0.9), done: false, y1: rowY(lastRow), segs,
        onSeg: (h) => {
          const vv = vis.get(h.targetId); if (!vv) return;
          if (h.pickup) {
            vis.delete(h.targetId);
            if (coll && coll.id === h.targetId) { flyers.push({ x0: ex(vv), y0: rowY(vv.dRow), t0: now(), dur: 520, value: vv.value }); sfx.collect(); }
            else { puff(ex(vv), rowY(vv.dRow), '#9fd4ff', 12); floater(ex(vv), rowY(vv.dRow) - 20, 'Lost', '#d0e8ff', 20); }
            return;
          }
          vv.hp = Math.max(0, vv.hp - h.dmg); vv.hitT = now();
          floater(ex(vv) + (Math.random() * 30 - 15), rowY(vv.dRow) - 14, '-' + fmt(h.dmg));
          sfx.hit();
          if (h.killed) killVis(h.targetId, killPts[h.targetId]);
        } });
      setTimeout(() => sfx.shoot(tierIdx(e.dmg)), delay);
      end = Math.max(end, now() + delay + dur);
    }
    return end;
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
  const fmtScore = (n) => (n >= 1e5 ? (n / 1e3).toFixed(1) + 'K' : n.toLocaleString());
  const wallMid = (wi) => FX + (G.WALL_SPANS[wi][0] + G.WALL_SPANS[wi][1]) / 2 * LW;

  function generalFx(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'merge': slotFx[e.to] = { t: now(), kind: 'merge' }; { const s = slotXY(e.to); puff(s.x, s.y - 10, tier(e.value).glow, 22); puff(s.x, s.y - 10, '#fff6c0', 8, 0.6); floater(s.x, s.y - 50, String(e.value), '#fff', 30); if (tierIdx(e.value) > tierIdx(e.value / 2)) floater(s.x, s.y - 78, tier(e.value).name, tier(e.value).light, 16, 1.2); } sfx.merge(tierIdx(e.value)); break;
        case 'moveT': slotFx[e.to] = { t: now(), kind: 'move' }; sfx.move(); break;
        case 'swap': slotFx[e.to] = { t: now(), kind: 'move' }; slotFx[e.from] = { t: now(), kind: 'move' }; sfx.swap(); break;
        case 'wallHit': {
          const v = vis.get(e.id);
          if (v) { v.dying = true; v.lunge = now(); setTimeout(() => { puff(ex(v), WC, '#c8a070', 18); vis.delete(e.id); }, 260); }
          setTimeout(() => { wallAnim[e.wall] = now(); shake = e.fatal ? 20 : 14; sfx.wall(); puff(wallMid(e.wall), WC, '#8a5a2a', 26); puff(wallMid(e.wall), WC, '#f0d39a', 14); }, 240);
          if (!e.fatal) setTimeout(() => showToast('Barricade smashed! The next hit ends the siege.', 2400, '#ffb0a0'), 300);
          break;
        }
        case 'pickupLost': break;
        case 'itemEarned': earnFx(e, 0); break;
        case 'broodPending': { const b = S.brood.find((q) => q.from === e.id); if (b) { eggs.push({ id: e.id, x: FX + (b.lane + 1) * LW, y: rowY(b.row), t: now() }); floater(FX + (b.lane + 1) * LW, rowY(b.row) - 30, 'Eggs!', '#ffd0c0', 22, 1.2); } break; }
        case 'hatch': { eggs = eggs.filter((g) => g.id !== e.from); const en = S.enemies.find((x) => x.id === e.id); if (en) { puff(laneX(en.lane), rowY(en.row), '#f2e2b0', 10, 0.6); puff(laneX(en.lane), rowY(en.row), '#7c2c24', 6, 0.5); } sfx.hatch(); break; }
        case 'levelUp': sfx.level(); showToast(`Defense Level ${e.level}  ·  Points +${e.bonus}%`, 2000, '#ffe14a'); puff(W / 2, 90, '#ffe14a', 22, 0.8); break;
        case 'repair': wallAnim[e.wall] = now(); puff(wallMid(e.wall), WC, '#9cf08a', 20); showToast('Barricade rebuilt!', 1400, '#c9f5b8'); break;
        case 'pushedOff': { const v = vis.get(e.id); if (v) { floater(ex(v), rowY(v.dRow) - 20, '+' + e.pts, '#ffe14a', 24); puff(ex(v), rowY(v.dRow), '#c9f5b8', 18); v.dying = true; v.fade = now(); setTimeout(() => vis.delete(e.id), 450); } } break;
      }
    }
  }

  // a freshly earned power-up flies from where it was won to its button
  function earnFx(e, delay) {
    const from = e.row != null ? { x: FX + (e.lane + 0.5) * LW, y: rowY(e.row) } : { x: W / 2, y: 92 };
    const label = G.ITEM_INFO[e.item].name;
    itemFlyers.push({ k: e.item, x0: from.x, y0: from.y, t0: now() + delay + 250, dur: 750 });
    setTimeout(() => { sfx.earned(); showToast(`+1 ${label}! ${e.source === 'level' ? '(level-up reward)' : e.source === 'queen' ? '(Brood Queen bounty)' : '(Giant bounty)'}`, 1800, '#c9f5b8'); }, delay + 250);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function doMove(action) {
    if (busy || S.over) return;
    const r = G.playerMove(S, action);
    if (!r.ok) { sfx.bad(); showToast(r.msg, 1100, '#ffd0c0'); return; }
    busy = true; mode = null; tapSel = -1;
    pocketShown = S.pocket;
    generalFx(r.events);
    await wait(140);
    const fe = G.fire(S);
    const end = shotsFx(fe);
    sync(Math.max(0, end - now()), false);
    { const dl = Math.max(0, end - now()), later = fe.filter((e) => e.type === 'levelUp' || e.type === 'broodPending'); setTimeout(() => generalFx(later), dl); fe.filter((e) => e.type === 'itemEarned').forEach((e) => earnFx(e, dl)); }
    await wait(Math.max(260, end - now() + (fe.some((e) => e.type === 'collect') ? 560 : 120)));
    pocketShown = S.pocket;
    const ae = G.advance(S);
    generalFx(ae);
    sync(0, true);
    await wait(ae.some((e) => e.type === 'wallHit') ? 650 : 300);
    busy = false;
    saveScores();
    if (S.over) gameOver();
    else if (ae.some((e) => e.type === 'hatch')) showToast('The Brood Queen\'s hatchlings emerge!', 1400, '#ffd0c0');
  }

  function saveScores() { if (S.score > best) { best = S.score; LS.set('best', best); } }

  // ---------- items ----------
  const itemKeys = G.ITEMS;
  function tryItem(k) {
    if (busy || S.over) return;
    if (mode && mode.item === k) { mode = null; return; }
    if (S.itemUsed[k] >= G.ITEM_USES) { sfx.bad(); showToast(G.ITEM_INFO[k].name + ' used 10 times already this game', 1600, '#ffd0c0'); return; }
    if (!S.items[k]) { sfx.bad(); showToast('No charges. Slay Giants & Brood Queens or level up to earn more.', 2000, '#ffd0c0'); return; }
    if (k === 'spray' && S.walls.every((w) => w)) { sfx.bad(); showToast('Bug Spray repairs a smashed barricade. Both are intact.', 1800, '#ffd0c0'); return; }
    const info = G.ITEM_INFO[k];
    dialog(info.name, `<p>${info.desc}</p><p class="small">Charges: <b>${S.items[k]}</b> &nbsp;·&nbsp; Used this game: <b>${S.itemUsed[k]}/${G.ITEM_USES}</b></p>`, [
      { label: 'Cancel', alt: true },
      { label: 'Use', fn: () => {
        if (k === 'spray') { const r = G.useItem(S, 'spray'); if (r.ok) { sfx.spray(); generalFx(r.events); sync(0, true); saveScores(); } }
        else { mode = { item: k }; showToast(k === 'fire' ? 'Tap a scorpion to blast it' : 'Tap a cannon below 32', 2200, '#bff7a8'); }
      } },
    ]);
  }
  function applyTargetItem(arg) {
    const k = mode.item, r = G.useItem(S, k, arg);
    if (!r.ok) { sfx.bad(); showToast(r.msg, 1100, '#ffd0c0'); return; }
    mode = null;
    for (const e of r.events) {
      if (e.type === 'blast') {
        const v = vis.get(e.id); if (!v) continue;
        v.hp = Math.max(0, v.hp - e.dmg); v.hitT = now();
        floater(ex(v), rowY(v.dRow) - 14, '-' + fmt(e.dmg), '#ff3b2f', 32);
        puff(ex(v), rowY(v.dRow), '#ffb347', 12);
        if (e.killed) { const kk = r.events.find((x) => x.type === 'kill' && x.id === e.id); v.dying = true; killVis(e.id, kk && kk.pts); }
      }
      else if (e.type === 'super') { slotFx[e.slot] = { t: now(), kind: 'merge' }; const s = slotXY(e.slot); puff(s.x, s.y, '#ffe14a', 18); if (e.slot === POCKET) pocketShown = S.pocket; }
    }
    if (k === 'fire') sfx.fire(); else sfx.superc();
    generalFx(r.events.filter((e) => e.type === 'levelUp' || e.type === 'itemEarned' || e.type === 'broodPending'));
    sync(250, true);
    saveScores();
  }

  // ---------- DOM dialogs ----------
  const ov = document.getElementById('overlay'), ovT = document.getElementById('ov-title'), ovB = document.getElementById('ov-body'), ovBtn = document.getElementById('ov-buttons');
  function dialog(title, html, buttons) {
    ovT.textContent = title; ovB.innerHTML = html; ovBtn.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'btn' + (b.alt ? ' alt' : ''); el.textContent = b.label;
      el.onclick = () => { closeDialog(); audio(); b.fn && b.fn(); };
      ovBtn.appendChild(el);
    }
    ov.classList.remove('hidden');
  }
  function closeDialog() { ov.classList.add('hidden'); }
  const dialogOpen = () => !ov.classList.contains('hidden');

  function howTo() {
    dialog('How to Play', `<ol>
      <li>Sand scorpions march down 6 rows toward your two log barricades, one row per turn.</li>
      <li>You start with a single cannon. <b>Drag</b> a cannon onto an empty square to move it, onto the <b>same number</b> to merge (8 + 8 = 16), or onto a different number to swap. Each drag is one turn. Every merge upgrades the cannon to a new design.</li>
      <li>After your move, every cannon fires straight up its lane and hits the first thing in it. <b>Overkill carries through</b>: leftover damage keeps going to the next target behind it.</li>
      <li>Shoot the <b>field cannons</b> (blue bubbles) to collect them. A collected cannon drops into your <b>pocket</b> (bottom right). Only one can be collected per turn, and the highest value wins. A new one replaces whatever is in the pocket, so you can also park an unwanted cannon there.</li>
      <li>A scorpion that reaches a barricade smashes it. You get one free hit; the <b>second hit ends the siege</b>.</li>
      <li>Every 25 kills raises the Defense Level: +5% points, bigger field cannons and a free power-up. New scorpions grow with the level <b>and with your firepower</b>, so stronger cannons bring stronger scorpions.</li>
      <li><b>Power-ups are earned</b>: you start with 1 Bug Spray. Slaying a Giant or Brood Queen can drop a charge, and every level-up gives one. Each power-up can be used at most 10 times per game, and using one doesn't cost a turn.</li>
      <li>A slain <b>Brood Queen</b> always leaves eggs: 3 Hatchlings appear where she fell on the next move.</li>
    </ol>`, [{ label: "Let's go!" }]);
    LS.set('seenHelp2', true);
  }
  function guide() {
    const rows = Object.keys(G.TYPES).map((t) => {
      const T = G.TYPES[t];
      const pts = t === 'pickup' ? '' : ` · ${T.pts} pts`;
      return `<div class="guide-row"><canvas width="${(T.w * 70) * 2}" height="140" data-type="${t}" style="width:${T.w * 70}px;height:70px"></canvas>
        <div><b>${T.name}</b>${pts}<small>${T.desc}</small></div></div>`;
    }).join('');
    const tiers = TIERS.map((T, i) => `<div class="tier-cell"><canvas width="140" height="150" data-tier="${i}" style="width:70px;height:75px"></canvas><b>${Math.pow(2, i)}${i === TIERS.length - 1 ? '+' : ''}</b><small>${T.name}</small></div>`).join('');
    const items = G.ITEMS.map((k) => `<div class="guide-row"><canvas width="100" height="100" data-item="${k}" style="width:50px;height:50px"></canvas><div><b>${G.ITEM_INFO[k].name}</b> · charges ${S.items[k]}, used ${S.itemUsed[k]}/${G.ITEM_USES}<small>${G.ITEM_INFO[k].desc}</small></div></div>`).join('');
    dialog('Scorpion Guidebook', rows + `<p class="small">New scorpion HP = the larger of the level curve and ${Math.round(G.POWER_K * 100)}% of your total firepower (±15%). Dune Crawler HP right now: about <b>${fmt(Math.max(G.baseHp(S.level), G.POWER_K * G.playerPower(S)))}</b>.</p>
      <h3>Cannon tiers</h3><div class="tier-grid">${tiers}</div>
      <h3>Power-ups</h3>${items}<p class="small">Earned from Giant and Brood Queen kills, plus one on every level-up.</p>`, [{ label: 'Close' }]);
    ovB.querySelectorAll('canvas[data-type]').forEach((c) => {
      const g = c.getContext('2d'), t = c.dataset.type; g.scale(2, 2);
      const w = c.width / 2;
      if (t === 'pickup') drawPickup(g, w / 2, 27, 4, 0, 0.8);
      else drawScorpion(g, w / 2, 40, t, 0, t === 'giant' || t === 'queen' ? 0.62 : 0.8);
    });
    ovB.querySelectorAll('canvas[data-tier]').forEach((c) => { const g = c.getContext('2d'); g.scale(2, 2); drawCannon(g, 35, 52, Math.pow(2, +c.dataset.tier), 0.68, 1, false); });
    ovB.querySelectorAll('canvas[data-item]').forEach((c) => { const g = c.getContext('2d'); g.scale(2, 2); itemIcon(g, c.dataset.item, 25, 26, 1.1); });
  }

  // ---------- settings ----------
  function settings() {
    const st = A.settings;
    dialog('Settings', `<div class="setting"><label for="vol-music">Music</label><input type="range" id="vol-music" min="0" max="100" value="${Math.round(st.music * 100)}"><span id="vm-val">${Math.round(st.music * 100)}%</span></div>
      <div class="setting"><label for="vol-sfx">Sound effects</label><input type="range" id="vol-sfx" min="0" max="100" value="${Math.round(st.sfx * 100)}"><span id="vs-val">${Math.round(st.sfx * 100)}%</span></div>
      <div class="setting"><label for="mute-all">Mute all</label><input type="checkbox" id="mute-all" ${st.mute ? 'checked' : ''}><span></span></div>
      <p class="small">Original music and effects, generated live in your browser. Settings are saved on this device.</p>`, [{ label: 'Done' }]);
    const vm = document.getElementById('vol-music'), vs = document.getElementById('vol-sfx'), mu = document.getElementById('mute-all');
    vm.oninput = () => { audio(); A.set('music', vm.value / 100); document.getElementById('vm-val').textContent = vm.value + '%'; };
    vs.oninput = () => { audio(); A.set('sfx', vs.value / 100); document.getElementById('vs-val').textContent = vs.value + '%'; };
    vs.onchange = () => sfx.merge(3);
    mu.onchange = () => { audio(); A.set('mute', mu.checked); };
  }

  // ---------- high scores (top 10, this device) ----------
  const getScores = () => LS.get('scores', []);
  const qualifies = (sc) => sc > 0 && (getScores().length < 10 || sc > getScores()[getScores().length - 1].score);
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addScore(name, score, level) {
    const list = getScores(), entry = { name: name.slice(0, 12) || 'Defender', score, level, date: new Date().toISOString().slice(0, 10), id: Date.now() };
    list.push(entry); list.sort((a, b) => b.score - a.score); const top = list.slice(0, 10); LS.set('scores', top); return entry.id;
  }
  function highScores(hiId, afterBtn) {
    const list = getScores();
    const rows = list.length ? list.map((e, i) => `<tr class="${e.id === hiId ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td class="r">${e.score.toLocaleString()}</td><td class="r">${e.level}</td><td class="r">${esc(e.date)}</td></tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:16px">No scores yet. Hold the line!</td></tr>';
    dialog('High Scores', `<table class="scores"><thead><tr><th>#</th><th>Name</th><th class="r">Score</th><th class="r">Lvl</th><th class="r">Date</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small">Top 10 on this device.</p>`, afterBtn || [{ label: 'Close' }]);
  }
  function askName(score, level) {
    dialog('New High Score!', `<div class="big">${score.toLocaleString()}</div><p style="text-align:center">You made the top 10. Enter your name or initials:</p>
      <input id="hs-name" class="name-input" maxlength="12" autocomplete="off" value="${esc(LS.get('lastName', ''))}" placeholder="AAA">`,
      [{ label: 'Save', fn: () => {} }]);
    const inp = document.getElementById('hs-name'), btn = ovBtn.querySelector('button');
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 50);
    const save = () => { const nm = inp.value.trim() || 'Defender'; LS.set('lastName', nm); const id = addScore(nm, score, level); highScores(id, [{ label: 'Play Again', fn: newRun }]); };
    btn.onclick = () => { closeDialog(); save(); };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); closeDialog(); save(); } };
  }
  function gameOver() {
    if (overShown) return; overShown = true;
    sfx.over();
    lifetime += S.score; LS.set('lifetime', lifetime);
    const isBest = S.score >= best && S.score > 0, sc = S.score, lv = S.level;
    setTimeout(() => dialog('The Barricades Have Fallen', `<div class="big">${sc.toLocaleString()}</div>
      ${isBest ? '<p style="text-align:center;color:#ffd84a;font-weight:bold">New best score!</p>' : ''}
      <div class="stats"><div>Defense Level</div><div>${lv}</div><div>Scorpions slain</div><div>${S.totalKills}</div>
      <div>Turns survived</div><div>${S.turn}</div><div>Best score</div><div>${best.toLocaleString()}</div><div>Total score</div><div>${lifetime.toLocaleString()}</div></div>`,
      qualifies(sc) ? [{ label: 'Save Score', fn: () => askName(sc, lv) }, { label: 'Play Again', alt: true, fn: newRun }]
        : [{ label: 'High Scores', alt: true, fn: () => highScores(null, [{ label: 'Play Again', fn: newRun }]) }, { label: 'Play Again', fn: newRun }]), 900);
  }

  const ITEM_RING = { spray: ['#7a2e24', '#3a120c'], fire: ['#6a5a40', '#2e2418'], super: ['#6a3aa8', '#2a1250'] };
  const ITEM_CX = (FX + POCK.x - 44) / 2, ITEM_GAP = 96;
  const itemXY = (k) => { const i = itemKeys.indexOf(k); return { x: ITEM_CX + (i - (itemKeys.length - 1) / 2) * ITEM_GAP, y: BY + 44 }; };

  // ---------- static background (cached) ----------
  let bgCanvas = null, bgH = 0;
  function buildBg() {
    bgH = H;
    bgCanvas = document.createElement('canvas'); bgCanvas.width = W * 2; bgCanvas.height = H * 2;
    const g = bgCanvas.getContext('2d'); g.scale(2, 2);
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // warm sand base
    g.fillStyle = lin(g, 0, 0, 0, H, [[0, '#eeb04a'], [0.45, '#f4be5a'], [1, '#e6a443']]); g.fillRect(0, 0, W, H);
    // grain texture: per-pixel noise at 1x, scaled up softly
    { const n = document.createElement('canvas'); n.width = W; n.height = H; const ng = n.getContext('2d'), im = ng.createImageData(W, H), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const v = rnd(); const dark = v < 0.5; d[i] = dark ? 150 : 255; d[i + 1] = dark ? 90 : 236; d[i + 2] = dark ? 30 : 190; d[i + 3] = (Math.abs(v - 0.5) * 2) ** 3 * 70; }
      ng.putImageData(im, 0, 0); g.drawImage(n, 0, 0); }
    g.save(); g.translate(0, OY);
    // wind ripples: paired dark/light arcs
    for (let i = 0; i < 46; i++) {
      const y = -OY + rnd() * H, x = rnd() * W, L = 30 + rnd() * 50, b = 4 + rnd() * 4;
      g.strokeStyle = 'rgba(190,118,36,.28)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - L, y); g.quadraticCurveTo(x, y - b, x + L, y); g.stroke();
      g.strokeStyle = 'rgba(255,236,180,.35)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - L + 4, y + 2.5); g.quadraticCurveTo(x, y - b + 2.5, x + L - 4, y + 2.5); g.stroke();
    }
    // pebbles with shadow + highlight
    const pebble = (x, y, r) => {
      g.fillStyle = 'rgba(120,60,10,.3)'; g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.45, r * 1.05, r * 0.6, 0, 0, 7); g.fill();
      g.fillStyle = rad(g, x - r * 0.3, y - r * 0.35, r * 0.1, r * 1.1, [[0, '#f6dcae'], [0.6, rnd() < 0.5 ? '#c49060' : '#b0805a'], [1, '#7a5030']]);
      g.beginPath(); g.ellipse(x, y, r, r * 0.72, rnd(), 0, 7); g.fill();
    };
    for (let i = 0; i < 70; i++) pebble(rnd() * W, -OY + rnd() * H, 1.4 + rnd() * 3.2);
    // field tiles: soft bevelled squares
    for (let r = 0; r < ROWS; r++) for (let l = 0; l < LANES; l++) {
      const x = FX + l * LW, y = FY + r * CH;
      g.fillStyle = lin(g, x, y, x, y + CH, [[0, 'rgba(255,222,146,.62)'], [1, 'rgba(250,206,120,.5)']]); rr(g, x + 2, y + 2, LW - 4, CH - 4, 5); g.fill();
      g.strokeStyle = 'rgba(255,244,210,.55)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 4, y + CH - 4); g.lineTo(x + 4, y + 4); g.lineTo(x + LW - 4, y + 4); g.stroke();
      g.strokeStyle = 'rgba(176,110,36,.45)'; g.beginPath(); g.moveTo(x + LW - 3, y + 5); g.lineTo(x + LW - 3, y + CH - 3); g.lineTo(x + 5, y + CH - 3); g.stroke();
      for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(190,120,40,.25)'; g.beginPath(); g.arc(x + 8 + rnd() * (LW - 16), y + 8 + rnd() * (CH - 16), 0.8 + rnd() * 1.2, 0, 7); g.fill(); }
    }
    // lane border stones along the field edges
    for (const ex0 of [FX - 6, FX + FW + 6]) for (let y = FY + 10; y < FB; y += 22) { pebble(ex0 + (rnd() - 0.5) * 4, y, 4 + rnd() * 2.5); }
    // tray tiles: cracked sandstone slabs with bevel
    const tile = (cx, cy, size) => {
      const x = cx - size / 2, y = cy - size / 2;
      g.fillStyle = 'rgba(110,60,15,.35)'; rr(g, x + 2, y + 4, size, size, 8); g.fill();
      g.fillStyle = lin(g, x, y, x + size * 0.4, y + size, [[0, '#f6c06a'], [0.6, '#e8a650'], [1, '#d28c3a']]); rr(g, x, y, size, size, 8); g.fill();
      g.strokeStyle = '#8a5418'; g.lineWidth = 2; rr(g, x, y, size, size, 8); g.stroke();
      g.strokeStyle = 'rgba(255,236,190,.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y + size - 8); g.lineTo(x + 4, y + 6); g.quadraticCurveTo(x + 4, y + 4, x + 8, y + 4); g.lineTo(x + size - 8, y + 4); g.stroke();
      g.strokeStyle = 'rgba(140,76,20,.6)'; g.beginPath(); g.moveTo(x + size - 4, y + 8); g.lineTo(x + size - 4, y + size - 6); g.lineTo(x + 8, y + size - 4); g.stroke();
      g.strokeStyle = 'rgba(140,80,22,.35)'; g.lineWidth = 1.1;
      for (let k = 0; k < 3; k++) { let px = x + 12 + rnd() * (size - 24), py = y + 12 + rnd() * (size - 24); g.beginPath(); g.moveTo(px, py); for (let j = 0; j < 3; j++) { px += rnd() * 16 - 8; py += rnd() * 14 - 4; g.lineTo(px, py); } g.stroke(); }
      for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(255,240,200,.35)'; g.beginPath(); g.arc(x + 8 + rnd() * (size - 16), y + 8 + rnd() * (size - 16), 1 + rnd(), 0, 7); g.fill(); }
    };
    // tray frame: dark wooden board with gold trim behind the 10 slots
    { const x0 = FX - 8, y0 = TY - 6, w = FW + 16, h = SH * 2 + 12;
      g.fillStyle = 'rgba(90,50,18,.45)'; rr(g, x0, y0, w, h, 12); g.fill(); g.strokeStyle = 'rgba(255,214,140,.5)'; g.lineWidth = 2; rr(g, x0 + 2, y0 + 2, w - 4, h - 4, 10); g.stroke(); }
    for (let i = 0; i < G.SLOTS; i++) { const s = slotXY(i); tile(s.x, s.y, 88); }
    // item tray: gold-rimmed leather band
    { const tw = ITEM_GAP * 3 + 20, tx = ITEM_CX - tw / 2;
      g.fillStyle = 'rgba(0,0,0,.25)'; rr(g, tx + 2, BY + 8, tw, 80, 40); g.fill();
      g.fillStyle = lin(g, 0, BY + 4, 0, BY + 84, [[0, '#4a3020'], [1, '#2a180e']]); rr(g, tx, BY + 4, tw, 80, 40); g.fill();
      g.strokeStyle = lin(g, 0, BY + 4, 0, BY + 84, [[0, '#f2d27a'], [1, '#8a6420']]); g.lineWidth = 3; rr(g, tx, BY + 4, tw, 80, 40); g.stroke();
      g.strokeStyle = 'rgba(242,210,122,.35)'; g.lineWidth = 1; rr(g, tx + 6, BY + 10, tw - 12, 68, 34); g.stroke(); }
    // pocket tile
    tile(POCK.x, POCK.y, 88);
    g.setLineDash([6, 5]); g.strokeStyle = 'rgba(110,60,15,.6)'; g.lineWidth = 2; rr(g, POCK.x - 38, POCK.y - 38, 76, 76, 6); g.stroke(); g.setLineDash([]);
    // ---- edge decorations ----
    const cactus = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.lineJoin = 'round';
      g.fillStyle = 'rgba(120,70,10,.25)'; g.beginPath(); g.ellipse(0, 4, 26, 7, 0, 0, 7); g.fill();
      const arm = (ax, ay, w, h) => { g.fillStyle = lin(g, ax, 0, ax + w, 0, [[0, '#3f8a3a'], [0.5, '#6cc25a'], [1, '#2f6a2a']]); rr(g, ax, ay, w, h, w / 2); g.fill(); g.stroke(); };
      g.strokeStyle = '#1f4a1a'; g.lineWidth = 2.5;
      arm(-24, -50, 13, 30); arm(-24, -26, 22, 12); arm(12, -60, 13, 34); arm(4, -32, 22, 12); arm(-9, -78, 18, 82);
      g.strokeStyle = 'rgba(30,70,25,.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -72); g.lineTo(0, 0); g.stroke();
      g.fillStyle = '#ff8ab0'; g.beginPath(); g.arc(0, -79, 4.5, 0, 7); g.fill();
      g.restore();
    };
    const rock = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#7a4a1e'; g.lineWidth = 2;
      g.fillStyle = 'rgba(120,70,10,.25)'; g.beginPath(); g.ellipse(4, 12, 34, 8, 0, 0, 7); g.fill();
      for (const [dx, dy, rw, rh] of [[-12, 0, 22, 16], [10, -4, 26, 20], [0, 8, 20, 10]]) {
        g.fillStyle = lin(g, dx, dy - rh, dx, dy + rh, [[0, '#f0c27e'], [1, '#c4803e']]);
        g.beginPath(); g.ellipse(dx, dy, rw, rh, 0, 0, 7); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(140,80,30,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(dx - rw * 0.6, dy); g.lineTo(dx + rw * 0.5, dy + 2); g.stroke(); g.strokeStyle = '#7a4a1e'; g.lineWidth = 2;
      }
      g.restore();
    };
    const tuft = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.lineCap = 'round';
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.28; g.strokeStyle = i % 2 ? '#7a9a3a' : '#5a7a2a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a) * 8, Math.sin(a) * 10, Math.cos(a) * 16, Math.sin(a) * 20); g.stroke(); }
      g.restore();
    };
    const skull = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#8a7a5a'; g.lineWidth = 2; g.fillStyle = '#f2ead8';
      g.beginPath(); g.moveTo(-30, -8); g.quadraticCurveTo(-40, -22, -26, -26); g.quadraticCurveTo(-28, -16, -14, -10); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(30, -8); g.quadraticCurveTo(40, -22, 26, -26); g.quadraticCurveTo(28, -16, 14, -10); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(0, -4, 17, 12, 0, 0, 7); g.fill(); g.stroke();
      rr(g, -8, 2, 16, 18, 6); g.fill(); g.stroke();
      g.fillStyle = '#5a4a3a'; g.beginPath(); g.ellipse(-7, -4, 4, 3, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(7, -4, 4, 3, 0, 0, 7); g.fill();
      g.restore();
    };
    const barrel = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#3a2210'; g.lineWidth = 2;
      g.fillStyle = lin(g, -16, 0, 16, 0, [[0, '#6a3e1c'], [0.5, '#b07440'], [1, '#5a3418']]);
      g.beginPath(); g.moveTo(-14, -20); g.quadraticCurveTo(-19, 0, -14, 20); g.lineTo(14, 20); g.quadraticCurveTo(19, 0, 14, -20); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#8a8a90'; rr(g, -17, -12, 34, 4, 2); g.fill(); rr(g, -17, 8, 34, 4, 2); g.fill();
      g.fillStyle = '#c48a52'; g.beginPath(); g.ellipse(0, -20, 14, 5, 0, 0, 7); g.fill(); g.stroke();
      g.restore();
    };
    const tent = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#6a4a2a'; g.lineWidth = 2.5;
      g.fillStyle = lin(g, -50, 0, 50, 0, [[0, '#d8c8a8'], [0.5, '#f2e6cc'], [1, '#bfae8c']]);
      g.beginPath(); g.moveTo(-55, 30); g.lineTo(0, -40); g.lineTo(55, 30); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#7a5a3a'; g.beginPath(); g.moveTo(-14, 30); g.lineTo(0, -4); g.lineTo(14, 30); g.closePath(); g.fill();
      g.strokeStyle = '#a03a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(-36, 6); g.lineTo(36, 6); g.stroke();
      g.restore();
    };
    // left edge
    cactus(10, FY + 120, 0.75); tuft(26, FY + 40, 0.9); rock(8, FY + 300, 0.7); tuft(24, FY + 230, 0.8); cactus(14, FY + 470, 0.55);
    tuft(28, WC + 6, 0.7); rock(10, TY + 70, 0.6); tuft(20, TY + 160, 0.8);
    // right edge
    tuft(W - 22, FY + 70, 0.9); skull(W - 16, FY + 190, 0.55); cactus(W - 10, FY + 380, 0.7); rock(W - 8, FY + 470, 0.6); tuft(W - 24, WC - 4, 0.8);
    rock(W - 10, TY + 40, 0.55); tuft(W - 20, TY + 150, 0.8);
    // bottom camp (below the item bar, visible on tall screens)
    tent(60, BY + 150, 0.9); barrel(150, BY + 140, 0.9); barrel(176, BY + 150, 0.8); tuft(230, BY + 130, 1); rock(330, BY + 150, 0.9); barrel(W - 60, BY + 145, 0.9); cactus(W - 110, BY + 170, 0.6);
    g.restore();
  }

  // ---------- buttons ----------
  const buttons = [];
  function btnRects() {
    buttons.length = 0;
    buttons.push({ id: 'help', x: 222, y: 6, w: 34, h: 34 });
    buttons.push({ id: 'guide', x: W - 58, y: 86, w: 48, h: 44 });
    buttons.push({ id: 'settings', x: W - 108, y: 86, w: 44, h: 44 });
    buttons.push({ id: 'scores', x: W - 158, y: 86, w: 44, h: 44 });
    for (const k of itemKeys) { const p = itemXY(k); buttons.push({ id: 'item:' + k, x: p.x - 38, y: p.y - 38, w: 76, h: 80 }); }
  }

  // ---------- main loop ----------
  let lastT = now();
  function frame() {
    const t = now(), dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    update(dt, t); draw(t);
    requestAnimationFrame(frame);
  }
  function update(dt, t) {
    for (const v of vis.values()) v.dRow += (v.row - v.dRow) * Math.min(1, dt * 11);
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter((f) => f.t < f.life);
    for (const p of projectiles) {
      if (t < p.t0 || p.done) continue;
      const k = Math.min(1, (t - p.t0) / p.dur), y = p.y0 + (p.y1 - p.y0) * k;
      for (const h of p.segs) { if (h.fired) continue; const v = vis.get(h.targetId); const ty = v ? rowY(v.dRow) : rowY(h.row); if (y <= ty + 4 || k >= 1) { h.fired = true; p.onSeg(h); } else break; }
      if (k >= 1) p.done = true;
    }
    projectiles = projectiles.filter((p) => !p.done);
    for (const f of flyers) if (!f.done && t - f.t0 >= f.dur) { f.done = true; pocketShown = S.pocket; slotFx[POCKET] = { t: now(), kind: 'new' }; puff(POCK.x, POCK.y, '#9fd4ff', 14); }
    flyers = flyers.filter((f) => !f.done);
    for (const f of itemFlyers) if (!f.done && t - f.t0 >= f.dur) { f.done = true; itemPulse[f.k] = t; const p = itemXY(f.k); puff(p.x, p.y, '#ffe9a8', 14, 0.7); }
    itemFlyers = itemFlyers.filter((f) => !f.done);
    shake *= Math.pow(0.02, dt);
  }

  function draw(t) {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    if (!bgCanvas || bgH !== H) buildBg();
    ctx.save();
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    ctx.translate(0, OY);
    const ts = t / 1000;


    // field entities (back rows first)
    const list = [...vis.values()].sort((a, b) => a.dRow - b.dRow), bars = [];
    for (const v of list) {
      if (t < v.appear) continue;
      const x = ex(v); let y = rowY(v.dRow);
      const pop = Math.min(1, (t - v.appear) / 200);
      ctx.save();
      if (v.fade) ctx.globalAlpha = Math.max(0, 1 - (t - v.fade) / 400);
      if (v.lunge) { const k = Math.min(1, (t - v.lunge) / 260); y += k * k * (WC - y - 10); }
      if (v.type === 'pickup') { ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y); drawPickup(ctx, x, y - 10, v.value, ts + v.seed); ctx.restore(); continue; }
      if (mode && mode.item === 'fire') { ctx.fillStyle = 'rgba(255,60,40,.2)'; rr(ctx, FX + v.lane * LW + 3, rowY(v.dRow) - CH / 2 + 3, v.w * LW - 6, CH - 6, 10); ctx.fill(); }
      ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y);
      const sy = y - (v.w === 2 ? 8 : 10) + Math.sin(ts * 2.6 + v.seed * 3) * 1.6;
      drawScorpion(ctx, x, sy, v.type, ts + v.seed);
      if (t - v.hitT < 110) { ctx.globalAlpha = 0.45; ctx.globalCompositeOperation = 'lighter'; drawScorpion(ctx, x, sy, v.type, ts + v.seed); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      ctx.restore();
      bars.push([x, y + CH / 2 - 13, v.w === 2 ? 140 : 70, v.hp, v.maxHp, pop, v.fade ? Math.max(0, 1 - (t - v.fade) / 400) : 1]);
    }
    for (const e of eggs) { // Brood Queen eggs, wobbling until they hatch next move
      for (let i = 0; i < 3; i++) {
        const ox = e.x + (i - 1) * 22, oy = e.y + 8 + (i === 1 ? -6 : 0), wob = Math.sin(t / 90 + i * 2) * 0.18;
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(wob);
        ctx.fillStyle = 'rgba(100,50,10,.3)'; ctx.beginPath(); ctx.ellipse(2, 12, 11, 4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rad(ctx, -3, -5, 1, 14, [[0, '#fffbe8'], [0.6, '#e8d2a8'], [1, '#a0805a']]); ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 12, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a3a2a'; for (const [sx, sy] of [[-3, -4], [3, 2], [-1, 6]]) { ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-2, -5); ctx.lineTo(1, -1); ctx.lineTo(5, -4); ctx.stroke();
        ctx.restore();
      }
    }
    for (const [x, y, w, hp, mx, pop, a] of bars) { ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(pop, pop); hpBar(ctx, 0, 0, w, hp, mx); ctx.restore(); }

    // barricades
    G.WALL_SPANS.forEach((span, wi) => {
      const x0 = FX + span[0] * LW + (wi === 0 ? -4 : 4), x1 = FX + span[1] * LW + (wi === 0 ? -4 : 4);
      let jig = 0; if (t - wallAnim[wi] < 300) jig = Math.sin((t - wallAnim[wi]) / 25) * 4;
      ctx.save(); ctx.translate(jig, 0); drawBarricade(ctx, x0, x1, WC, !S.walls[wi], ts); ctx.restore();
    });

    // tray cannons + pocket
    for (let i = 0; i <= POCKET; i++) {
      const v = i === POCKET ? (busy ? pocketShown : S.pocket) : S.tray[i];
      const { x, y } = slotXY(i);
      const isSel = (drag && drag.from === i) || tapSel === i;
      if (i === POCKET && !v) { text(ctx, 'POCKET', x, y + 30, 11, 'rgba(110,60,15,.7)', null); }
      if (!v) { if (isSel) {} continue; }
      if (drag && drag.from === i && drag.moved) continue;
      let sc = 1; const fx = slotFx[i];
      if (fx) { const k = (t - fx.t) / 300; if (k < 1) sc = fx.kind === 'merge' ? 1 + Math.sin(k * Math.PI) * 0.25 : fx.kind === 'new' ? 0.4 + 0.6 * Math.min(1, k * 1.4) + Math.sin(k * Math.PI) * 0.1 : 1 + Math.sin(k * Math.PI) * 0.08; }
      if (mode && mode.item === 'super' && v < 32) { ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 4; rr(ctx, x - 43, y - 43, 86, 86, 8); ctx.stroke(); }
      if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; rr(ctx, x - 43, y - 43, 86, 86, 8); ctx.stroke(); }
      drawCannon(ctx, x, y - 2, v, sc * 0.95, 1, true, ts);
    }
    // drop hints while dragging
    if (drag && drag.moved) {
      for (let i = 0; i <= POCKET; i++) {
        if (i === drag.from) continue;
        const v = G.getSlot(S, i), vf = G.getSlot(S, drag.from), { x, y } = slotXY(i);
        ctx.strokeStyle = !v ? 'rgba(255,255,255,.75)' : v === vf ? '#ffe14a' : 'rgba(150,220,255,.8)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        rr(ctx, x - 43, y - 43, 86, 86, 8); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // projectiles: glowing orbs
    for (const p of projectiles) {
      if (t < p.t0) continue;
      const k = Math.min(1, (t - p.t0) / p.dur), x = p.x0, y = p.y0 + (p.y1 - p.y0) * k;
      ctx.fillStyle = rad(ctx, x, y, 1, p.r * 2.4, [[0, '#ffffff'], [0.3, p.color], [1, 'rgba(255,255,255,0)']]);
      ctx.beginPath(); ctx.arc(x, y, p.r * 2.4, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.3; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y + 16, p.r * 0.8, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x, y + 30, p.r * 0.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    // collected cannon flying to the pocket
    for (const f of flyers) {
      const k = Math.min(1, (t - f.t0) / f.dur), e = 1 - Math.pow(1 - k, 3);
      const x = f.x0 + (POCK.x - f.x0) * e, y = f.y0 + (POCK.y - f.y0) * e - Math.sin(k * Math.PI) * 60;
      drawCannon(ctx, x, y, f.value, 0.6 + 0.35 * k);
    }
    for (const p of particles) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - p.t / p.life * 0.5), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const f of floaters) { const k = f.t / f.life; ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; text(ctx, f.text, f.x, f.y - k * 40, f.size * (k < 0.15 ? 0.7 + k * 2 : 1), f.color, '#3a0a00'); }
    ctx.globalAlpha = 1;

    drawItems(t);
    drawItemFlyers(t);
    ctx.restore();
    ctx.save(); ctx.translate(0, OY); drawHeader(); ctx.restore();

    if (drag && drag.moved) { ctx.save(); ctx.translate(0, OY); drawCannon(ctx, drag.x, drag.y - 24, G.getSlot(S, drag.from), 1.08, 0.95); ctx.restore(); }

    if (toast && t < toast.until) {
      const k = (t - toast.start) / 200, a = Math.min(1, k, (toast.until - t) / 300);
      ctx.save(); ctx.translate(0, OY); ctx.globalAlpha = a; ctx.font = 'bold 17px "Trebuchet MS", Verdana, sans-serif';
      const tw = Math.min(W - 24, ctx.measureText(toast.text).width + 36);
      const ty = FY + CH * 2.5 - 19; ctx.fillStyle = 'rgba(36,22,12,.85)'; rr(ctx, W / 2 - tw / 2, ty, tw, 38, 19); ctx.fill();
      ctx.strokeStyle = 'rgba(230,190,110,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      text(ctx, toast.text, W / 2, ty + 19, tw >= W - 24 ? 14 : 17, toast.color, null);
      ctx.restore();
    }
  }

  // gold frame helper: double gold rule with rivets and corner scrolls
  function goldFrame(g, x, y, w, h, r = 10) {
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 5; rr(g, x, y + 1, w, h, r); g.stroke();
    g.strokeStyle = lin(g, 0, y, 0, y + h, [[0, '#ffe9a8'], [0.5, '#c9962e'], [1, '#7a5414']]); g.lineWidth = 3.5; rr(g, x, y, w, h, r); g.stroke();
    g.strokeStyle = 'rgba(255,230,160,.35)'; g.lineWidth = 1; rr(g, x + 4, y + 4, w - 8, h - 8, Math.max(2, r - 4)); g.stroke();
    for (const [cx, cy] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) {
      g.fillStyle = rad(g, cx - 1, cy - 1, 0.5, 4, [[0, '#fff4c0'], [1, '#9a6a18']]); g.beginPath(); g.arc(cx, cy, 3.6, 0, 7); g.fill(); g.strokeStyle = '#3a2408'; g.lineWidth = 1; g.stroke();
    }
  }
  function roundBtn(g, b, draw) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(cx, cy + 2, 19, 0, 7); g.fill();
    g.fillStyle = rad(g, cx - 5, cy - 6, 2, 20, [[0, '#4a3a2a'], [1, '#1a120a']]); g.beginPath(); g.arc(cx, cy, 18, 0, 7); g.fill();
    g.strokeStyle = lin(g, 0, cy - 18, 0, cy + 18, [[0, '#ffe9a8'], [1, '#8a6420']]); g.lineWidth = 2.5; g.stroke();
    g.save(); g.translate(cx, cy); draw(); g.restore();
  }
  function drawHeader() {
    const g = ctx;
    // leather band behind the HUD (extends up on tall phones)
    g.fillStyle = lin(g, 0, -OY, 0, HDR, [[0, 'rgba(40,26,16,.9)'], [1, 'rgba(48,30,18,.78)']]); g.fillRect(0, -OY, W, OY + HDR);
    g.fillStyle = lin(g, 0, HDR, 0, HDR + 10, [[0, 'rgba(30,20,12,.45)'], [1, 'rgba(30,20,12,0)']]); g.fillRect(0, HDR, W, 10);
    // stitched leather texture
    g.strokeStyle = 'rgba(255,220,160,.12)'; g.lineWidth = 1; g.setLineDash([4, 4]); rr(g, 6, 52, W - 12, HDR - 58, 8); g.stroke(); g.setLineDash([]);
    // ornate title bar
    g.fillStyle = lin(g, 0, -OY, 0, 46, [[0, '#2c3242'], [1, '#191d28']]); g.fillRect(0, -OY, W, OY + 46);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 0, W, 16);
    // gold rail with scroll ornaments
    g.fillStyle = lin(g, 0, 42, 0, 52, [[0, '#ffe9a8'], [0.5, '#c9962e'], [1, '#6a4410']]); g.fillRect(0, 43, W, 7);
    g.strokeStyle = '#3a2408'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 43); g.lineTo(W, 43); g.moveTo(0, 50); g.lineTo(W, 50); g.stroke();
    for (let x = 14; x < W; x += 28) { g.fillStyle = '#5a3a0c'; g.beginPath(); g.moveTo(x - 5, 46.5); g.lineTo(x, 43.5); g.lineTo(x + 5, 46.5); g.lineTo(x, 49.5); g.closePath(); g.fill(); }
    g.fillStyle = lin(g, 0, HDR - 4, 0, HDR + 3, [[0, '#ffe9a8'], [1, '#7a5414']]); g.fillRect(0, HDR - 3, W, 5);
    // title medallion
    g.save();
    g.fillStyle = lin(g, 0, 2, 0, 42, [[0, '#3a2a18'], [1, '#1a1008']]); rr(g, 4, 4, 206, 36, 18); g.fill();
    g.strokeStyle = lin(g, 0, 4, 0, 40, [[0, '#ffe9a8'], [1, '#8a6420']]); g.lineWidth = 2.5; rr(g, 4, 4, 206, 36, 18); g.stroke();
    g.restore();
    text(g, 'Sandline Siege', 107, 23, 23, '#ffe9b0', '#1a0e04', 'center', 'bold', 'Georgia, "Times New Roman", serif');
    // help "?"
    const hb = buttons.find((b) => b.id === 'help');
    g.fillStyle = rad(g, hb.x + hb.w / 2 - 4, hb.y + hb.h / 2 - 4, 1, 16, [[0, '#fff0b0'], [1, '#b8862a']]); g.beginPath(); g.arc(hb.x + hb.w / 2, hb.y + hb.h / 2, 14, 0, 7); g.fill();
    g.strokeStyle = '#4a3010'; g.lineWidth = 2; g.stroke(); text(g, '?', hb.x + hb.w / 2, hb.y + hb.h / 2 + 1, 19, '#3a2208', null);
    // score pills
    const pill = (y, label, val) => {
      const x0 = W - 236, w = 228, h = 30;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 12, y - h / 2); g.lineTo(x0 + w, y - h / 2); g.lineTo(x0 + w, y + h / 2); g.lineTo(x0 + 12, y + h / 2); g.closePath();
      g.fillStyle = lin(g, 0, y - h / 2, 0, y + h / 2, [[0, '#fff8e6'], [0.5, '#f2e2c0'], [1, '#d8c094']]); g.fill();
      g.strokeStyle = lin(g, 0, y - h / 2, 0, y + h / 2, [[0, '#e8c070'], [1, '#7a5414']]); g.lineWidth = 2.5; g.stroke();
      text(g, label, x0 + 20, y + 1, 16, '#5a3a1a', null, 'left', 'normal');
      text(g, val, x0 + w - 10, y + 1, 17, '#2a1a0a', null, 'right', 'bold');
    };
    pill(24, 'Total Score', fmtScore(lifetime + S.score));
    pill(68, 'Round Score', fmtScore(S.score));
    // framed level panel
    g.fillStyle = 'rgba(20,12,6,.45)'; rr(g, 8, 56, 288, 70, 10); g.fill(); goldFrame(g, 8, 56, 288, 70, 10);
    // crosshair badge + kills
    const bx = 40, by = 80;
    g.save(); g.translate(bx, by);
    g.fillStyle = rad(g, -4, -4, 2, 22, [[0, '#5a2a20'], [1, '#1a0806']]); g.beginPath(); g.arc(0, 0, 21, 0, 7); g.fill(); g.strokeStyle = '#c9962e'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#d42a24'; g.lineWidth = 3.5; g.beginPath(); g.arc(0, 0, 13, 0, 7); g.stroke();
    g.lineWidth = 3; for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) { g.beginPath(); g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); g.stroke(); }
    g.strokeStyle = '#ff6a5a'; g.lineWidth = 4; g.beginPath(); g.moveTo(-7, -7); g.lineTo(7, 7); g.moveTo(7, -7); g.lineTo(-7, 7); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(20,12,6,.85)'; rr(g, bx - 26, by + 22, 52, 20, 6); g.fill(); g.strokeStyle = '#c9962e'; g.lineWidth = 1.2; g.stroke();
    text(g, `${S.kills}/${G.KILLS_PER_LEVEL}`, bx, by + 32, 14, '#fff', null);
    text(g, `Defense Level: ${S.level}`, 76, 74, 19, '#ffe9b0', 'rgba(0,0,0,.7)', 'left', 'bold');
    g.font = 'normal 18px "Trebuchet MS", Verdana, sans-serif'; g.textAlign = 'left';
    text(g, 'Points', 76, 104, 18, '#f6ead2', 'rgba(0,0,0,.6)', 'left', 'normal');
    text(g, `+${G.bonusPct(S.level)}%`, 76 + g.measureText('Points ').width + 2, 104, 18, '#f2c240', 'rgba(0,0,0,.6)', 'left', 'bold');
    // barricade status pips
    for (let i = 0; i < 2; i++) { const x = 246 + i * 22, y = 106; g.fillStyle = S.walls[i] ? lin(g, 0, y - 7, 0, y + 7, [[0, '#d69a5e'], [1, '#7a4a20']]) : '#4a1a10'; g.strokeStyle = '#2a1608'; g.lineWidth = 1.5; rr(g, x - 8, y - 8, 16, 16, 3); g.fill(); g.stroke(); if (!S.walls[i]) text(g, '×', x, y, 15, '#ff6a5a', null); }
    text(g, 'Walls', 257, 90, 11, '#e8d4a8', null);
    // trophy / gear / book buttons
    const tb = buttons.find((b) => b.id === 'scores'), sb = buttons.find((b) => b.id === 'settings'), gb = buttons.find((b) => b.id === 'guide');
    roundBtn(g, tb, () => {
      g.fillStyle = lin(g, 0, -11, 0, 10, [[0, '#fff0a0'], [1, '#c08a10']]); g.strokeStyle = '#3a2408'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-9, -10); g.lineTo(9, -10); g.quadraticCurveTo(9, 3, 0, 4); g.quadraticCurveTo(-9, 3, -9, -10); g.fill(); g.stroke();
      g.beginPath(); g.arc(-9, -5, 4, Math.PI / 2, Math.PI * 1.5); g.stroke(); g.beginPath(); g.arc(9, -5, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.fillRect(-2, 4, 4, 4); rr(g, -7, 8, 14, 4, 1.5); g.fill(); g.stroke();
    });
    roundBtn(g, sb, () => {
      g.fillStyle = '#e8dcc0'; g.strokeStyle = '#3a2408'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 9 : 12; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#2a1a0e'; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
      if (A.settings.mute) { g.strokeStyle = '#ff5a4a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-12, 12); g.lineTo(12, -12); g.stroke(); }
    });
    roundBtn(g, gb, () => {
      g.rotate(-0.12);
      g.fillStyle = '#8a2216'; g.strokeStyle = '#2a0a06'; g.lineWidth = 1.5; rr(g, -11, -11, 22, 21, 3); g.fill(); g.stroke();
      g.fillStyle = '#f2e2c0'; g.fillRect(-9, 8, 19, 3);
      g.strokeStyle = '#e8b84a'; g.lineWidth = 1.2; rr(g, -8, -8, 16, 13, 2); g.stroke();
      g.fillStyle = '#e8b84a'; g.beginPath(); g.arc(0, -1.5, 3, 0, 7); g.fill();
    });
  }

  function drawItemFlyers(t) {
    for (const f of itemFlyers) {
      if (t < f.t0) continue;
      const k = Math.min(1, (t - f.t0) / f.dur), e = k * k * (3 - 2 * k), p = itemXY(f.k);
      const x = f.x0 + (p.x - f.x0) * e, y = f.y0 + (p.y - f.y0) * e - Math.sin(k * Math.PI) * 90;
      ctx.fillStyle = rad(ctx, x, y, 2, 34, [[0, 'rgba(255,240,160,.9)'], [1, 'rgba(255,240,160,0)']]); ctx.beginPath(); ctx.arc(x, y, 34, 0, 7); ctx.fill();
      itemIcon(ctx, f.k, x, y, 1.3 - 0.3 * k);
      if (Math.random() < 0.5) particles.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: 20, life: 0.4, t: 0, r: 3, color: '#ffe9a8' });
    }
  }
  function drawItems(t) {
    for (const k of itemKeys) {
      const { x, y } = itemXY(k), active = mode && mode.item === k;
      const pending = itemFlyers.filter((f) => f.k === k).length, n = S.items[k] - pending;
      const capped = S.itemUsed[k] >= G.ITEM_USES, pulse = itemPulse[k] ? Math.max(0, 1 - (t - itemPulse[k]) / 500) : 0;
      const [c1, c2] = ITEM_RING[k];
      ctx.save(); ctx.translate(x, y); ctx.scale(1 + pulse * 0.18, 1 + pulse * 0.18); ctx.translate(-x, -y);
      if (active || pulse) { ctx.fillStyle = `rgba(255,230,120,${active ? 0.35 : pulse * 0.6})`; ctx.beginPath(); ctx.arc(x, y, 42, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x, y + 3, 32, 0, 7); ctx.fill();
      ctx.fillStyle = rad(ctx, x - 8, y - 10, 4, 34, [[0, n > 0 && !capped ? c1 : '#4a4440'], [1, n > 0 && !capped ? c2 : '#1e1a18']]); ctx.beginPath(); ctx.arc(x, y, 31, 0, 7); ctx.fill();
      ctx.strokeStyle = lin(ctx, 0, y - 32, 0, y + 32, [[0, '#ffe9a8'], [1, '#7a5a20']]); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,233,168,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 26, 0, 7); ctx.stroke();
      ctx.globalAlpha = n > 0 && !capped ? 1 : 0.35; itemIcon(ctx, k, x, y - 3); ctx.globalAlpha = 1;
      // charge badge
      const lbl = capped ? 'MAX' : String(n);
      ctx.fillStyle = capped ? '#5a5050' : n > 0 ? lin(ctx, 0, y + 14, 0, y + 34, [[0, '#4ac04a'], [1, '#1e7a1e']]) : '#5a2a20';
      rr(ctx, x + 8, y + 12, lbl.length > 1 ? 34 : 24, 22, 11); ctx.fill(); ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1.6; ctx.stroke();
      text(ctx, lbl, x + 8 + (lbl.length > 1 ? 17 : 12), y + 23.5, lbl.length > 2 ? 12 : 15, '#fff', '#0e0804', 'center', '900');
      ctx.restore();
    }
  }

  // ---------- input ----------
  function toScreen(x, y) { const r = cv.getBoundingClientRect(); return { x: r.left + x / W * r.width, y: r.top + (y + OY) / H * r.height }; }
  function toLogical(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H - OY }; }
  function slotAt(x, y) {
    for (let i = 0; i <= POCKET; i++) { const s = slotXY(i); if (Math.abs(x - s.x) <= LW / 2 && Math.abs(y - s.y) <= SH / 2) return i; }
    return -1;
  }
  const hitBtn = (x, y) => buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  function fieldCell(x, y) { if (y < FY || y >= FB || x < FX || x >= FX + FW) return null; return { row: Math.floor((y - FY) / CH), lane: Math.floor((x - FX) / LW) }; }

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); audio();
    if (dialogOpen() || !S) return;
    const { x, y } = toLogical(e);
    const b = hitBtn(x, y);
    if (b) {
      sfx.click();
      if (b.id === 'settings') settings();
      else if (b.id === 'scores') highScores();
      else if (b.id === 'help') howTo();
      else if (b.id === 'guide') guide();
      else if (b.id.startsWith('item:')) tryItem(b.id.slice(5));
      return;
    }
    if (busy || S.over) return;
    if (mode) {
      const c = fieldCell(x, y);
      if (mode.item === 'fire' && c) { const en = S.enemies.find((en) => G.isBug(en) && en.row === c.row && c.lane >= en.lane && c.lane < en.lane + en.w); if (en) applyTargetItem(en.id); else showToast('Tap a scorpion', 900); return; }
      if (mode.item === 'super') { const s = slotAt(x, y); if (s >= 0) { applyTargetItem(s); return; } }
      mode = null; showToast('Cancelled', 700); return;
    }
    const s = slotAt(x, y);
    if (s >= 0 && G.getSlot(S, s)) { sfx.pickup(); drag = { from: s, x, y, sx: x, sy: y, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
    else if (s >= 0 && tapSel >= 0) { const from = tapSel; tapSel = -1; doMove({ type: 'move', from, to: s }); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return; e.preventDefault();
    const { x, y } = toLogical(e); drag.x = x; drag.y = y;
    if (Math.hypot(x - drag.sx, y - drag.sy) > 10) drag.moved = true;
  });
  function endDrag(e) {
    if (!drag) return;
    const { x, y } = toLogical(e), d = drag; drag = null;
    const to = slotAt(x, y);
    if (!d.moved) {
      if (tapSel >= 0 && tapSel !== d.from) { const from = tapSel; tapSel = -1; doMove({ type: 'move', from, to: d.from }); }
      else { tapSel = tapSel === d.from ? -1 : d.from; if (tapSel >= 0) showToast('Now tap where it should go', 1200); }
      return;
    }
    tapSel = -1;
    if (to >= 0 && to !== d.from) doMove({ type: 'move', from: d.from, to });
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => { drag = null; });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vw = window.innerWidth, vh = window.innerHeight;
    // fill tall phones: grow the logical height (extra space goes above the header and below the items)
    H = Math.max(BASE_H, Math.min(Math.round(W * vh / vw), BASE_H + 260));
    OY = Math.round((H - BASE_H) * 0.3);
    scale = Math.min(vw / W, vh / H);
    cv.style.width = Math.round(W * scale) + 'px'; cv.style.height = Math.round(H * scale) + 'px';
    cv.width = Math.round(W * scale * dpr); cv.height = Math.round(H * scale * dpr);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  resize();
  btnRects();
  newRun();
  requestAnimationFrame(frame);
  if (!LS.get('seenHelp2', false)) howTo();
})();
