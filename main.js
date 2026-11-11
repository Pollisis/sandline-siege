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
  let best = LS.get('best', 0), lifetime = LS.get('lifetime', 0), muted = LS.get('muted', false);

  // ---------- audio ----------
  let ac = null;
  function audio() { if (muted) return null; try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { return null; } return ac; }
  function tone(f, dur, type = 'square', vol = 0.06, slide = null, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.08, freq = 1200, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, len = Math.max(1, (a.sampleRate * dur) | 0), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(a.destination); s.start(t);
  }
  let lastShot = 0;
  const sfx = {
    shoot() { const n = performance.now(); if (n - lastShot < 40) return; lastShot = n; tone(520 + Math.random() * 200, 0.08, 'square', 0.022, 900); },
    hit() { noise(0.06, 0.06, 2400); },
    die() { noise(0.28, 0.12, 700); tone(260, 0.22, 'sawtooth', 0.04, 70); },
    merge() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, 'triangle', 0.08, null, i * 0.05)); },
    move() { tone(380, 0.07, 'triangle', 0.06, 520); },
    swap() { tone(440, 0.06, 'triangle', 0.06, 330); tone(330, 0.06, 'triangle', 0.06, 440, 0.07); },
    collect() { [660, 880, 1320].forEach((f, i) => tone(f, 0.09, 'sine', 0.08, null, i * 0.06)); },
    wall() { noise(0.6, 0.22, 600); tone(90, 0.45, 'sawtooth', 0.08, 35); },
    level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.14, 'square', 0.04, null, i * 0.07)); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, null, i * 0.22)); },
    bad() { tone(160, 0.12, 'square', 0.04, 120); },
    item() { tone(300, 0.3, 'sawtooth', 0.05, 1200); },
    boom() { noise(0.5, 0.25, 900); tone(90, 0.4, 'sine', 0.2, 40); },
    pop() { tone(900, 0.08, 'sine', 0.07, 1500); },
  };

  // ---------- layout helpers ----------
  const laneX = (l) => FX + l * LW + LW / 2;
  const rowY = (r) => FY + r * CH + CH / 2;
  const slotXY = (i) => (i === POCKET ? { x: POCK.x, y: POCK.y } : { x: laneX(i % LANES), y: TY + Math.floor(i / LANES) * SH + SH / 2 });
  // barrel colour by tier: blue low, purple mid, copper high, white/gold top
  function tier(v) {
    if (v <= 8) return { name: 'blue', main: '#3f86d8', dark: '#1d4c8c', light: '#8cc4ff', glow: '#5fb0ff', trim: '#2a5fa8' };
    if (v <= 64) return { name: 'purple', main: '#8e52d8', dark: '#4d2390', light: '#c79cff', glow: '#b67cff', trim: '#6a35b5' };
    if (v <= 512) return { name: 'copper', main: '#d9783a', dark: '#8a3f14', light: '#ffc08a', glow: '#ff9a4a', trim: '#b05a22' };
    return { name: 'gold', main: '#f4ead2', dark: '#a8864a', light: '#ffffff', glow: '#ffe27a', trim: '#d9b046' };
  }

  // ---------- state ----------
  let S, vis, projectiles, floaters, particles, slotFx, toast, busy, mode, drag, tapSel, shake, overShown, pocketShown, wallAnim, flyers;
  const now = () => performance.now();

  function newRun() {
    S = G.newGame();
    vis = new Map(); projectiles = []; floaters = []; particles = []; slotFx = {}; flyers = [];
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
    sfx.die();
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
      setTimeout(sfx.shoot, delay);
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
        case 'merge': slotFx[e.to] = { t: now(), kind: 'merge' }; { const s = slotXY(e.to); puff(s.x, s.y - 10, tier(e.value).glow, 16); floater(s.x, s.y - 50, String(e.value), '#fff', 26); } sfx.merge(); break;
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
        case 'levelUp': sfx.level(); showToast(`Defense Level ${e.level}  ·  Points +${e.bonus}%`, 2000, '#ffe14a'); break;
        case 'repair': wallAnim[e.wall] = now(); puff(wallMid(e.wall), WC, '#9cf08a', 20); break;
        case 'pushedOff': { const v = vis.get(e.id); if (v) { floater(ex(v), rowY(v.dRow) - 20, '+' + e.pts, '#ffe14a', 24); puff(ex(v), rowY(v.dRow), '#c9f5b8', 18); v.dying = true; v.fade = now(); setTimeout(() => vis.delete(e.id), 450); } } break;
      }
    }
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
    generalFx(fe.filter((e) => e.type === 'levelUp'));
    await wait(Math.max(260, end - now() + (fe.some((e) => e.type === 'collect') ? 560 : 120)));
    pocketShown = S.pocket;
    const ae = G.advance(S);
    generalFx(ae);
    sync(0, true);
    await wait(ae.some((e) => e.type === 'wallHit') ? 650 : 300);
    busy = false;
    saveScores();
    if (S.over) gameOver();
  }

  function saveScores() { if (S.score > best) { best = S.score; LS.set('best', best); } }

  // ---------- items ----------
  const itemKeys = G.ITEMS;
  function tryItem(k) {
    if (busy || S.over) return;
    if (mode && mode.item === k) { mode = null; return; }
    if (!S.items[k]) { sfx.bad(); showToast('No ' + G.ITEM_INFO[k].name + ' uses left this game', 1500, '#ffd0c0'); return; }
    if (k === 'spray' && S.walls.every((w) => w)) { sfx.bad(); showToast('Bug Spray repairs a smashed barricade. Both are intact.', 1800, '#ffd0c0'); return; }
    const info = G.ITEM_INFO[k];
    dialog(info.name, `<p>${info.desc}</p><p class="small">Uses left this game: <b>${S.items[k]}</b></p>`, [
      { label: 'Cancel', alt: true },
      { label: 'Use', fn: () => {
        if (k === 'spray') { const r = G.useItem(S, 'spray'); if (r.ok) { sfx.item(); generalFx(r.events); sync(0, true); saveScores(); } }
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
      else if (e.type === 'super') { slotFx[e.slot] = { t: now(), kind: 'merge' }; const s = slotXY(e.slot); puff(s.x, s.y, '#ffe14a', 18); sfx.merge(); if (e.slot === POCKET) pocketShown = S.pocket; }
    }
    if (k === 'fire') sfx.boom();
    generalFx(r.events.filter((e) => e.type === 'levelUp'));
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
      <li>You start with a single cannon. <b>Drag</b> a cannon onto an empty square to move it, onto the <b>same number</b> to merge (8 + 8 = 16), or onto a different number to swap. Each drag is one turn.</li>
      <li>After your move, every cannon fires straight up its lane and hits the first thing in it. <b>Overkill carries through</b>: leftover damage keeps going to the next target behind it.</li>
      <li>Shoot the <b>field cannons</b> (blue bubbles) to collect them. A collected cannon drops into your <b>pocket</b> (bottom right). Only one can be collected per turn, and the highest value wins. A new one replaces whatever is in the pocket, so you can also park an unwanted cannon there.</li>
      <li>A scorpion that reaches a barricade smashes it. You get one free hit; the <b>second hit ends the siege</b>.</li>
      <li>Every 25 kills raises the Defense Level: tougher scorpions, bigger field cannons, +5% points.</li>
    </ol><p class="small">Items (10 uses each per game) don't use a turn. Tap one to see what it does.</p>`, [{ label: "Let's go!" }]);
    LS.set('seenHelp2', true);
  }
  function guide() {
    const rows = Object.keys(G.TYPES).map((t) => {
      const T = G.TYPES[t];
      const pts = t === 'pickup' ? '' : ` · ${T.pts} pts`;
      return `<div class="guide-row"><canvas width="${(T.w * 70) * 2}" height="140" data-type="${t}" style="width:${T.w * 70}px;height:70px"></canvas>
        <div><b>${T.name}</b>${pts}<small>${T.desc}</small></div></div>`;
    }).join('');
    dialog('Scorpion Guidebook', rows + `<p class="small">Scorpion HP grows each Defense Level. Current Dune Crawler HP: <b>${fmt(G.baseHp(S.level))}</b>.</p>`, [{ label: 'Close' }]);
    ovB.querySelectorAll('canvas[data-type]').forEach((c) => {
      const g = c.getContext('2d'), t = c.dataset.type; g.scale(2, 2);
      const w = c.width / 2;
      if (t === 'pickup') drawPickup(g, w / 2, 27, 4, 0, 0.8);
      else drawScorpion(g, w / 2, 40, t, 0, t === 'giant' || t === 'queen' ? 0.62 : 0.8);
    });
  }
  function gameOver() {
    if (overShown) return; overShown = true;
    sfx.over();
    lifetime += S.score; LS.set('lifetime', lifetime);
    const isBest = S.score >= best && S.score > 0;
    setTimeout(() => dialog('The Barricades Have Fallen', `<div class="big">${S.score.toLocaleString()}</div>
      ${isBest ? '<p style="text-align:center;color:#2f9a2a;font-weight:bold">New best score!</p>' : ''}
      <div class="stats"><div>Defense Level</div><div>${S.level}</div><div>Scorpions slain</div><div>${S.totalKills}</div>
      <div>Turns survived</div><div>${S.turn}</div><div>Best score</div><div>${best.toLocaleString()}</div><div>Total score</div><div>${lifetime.toLocaleString()}</div></div>`,
      [{ label: 'Play Again', fn: newRun }]), 900);
  }

  // ================= ART =================
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function text(g, s, x, y, size, color = '#fff', stroke = '#2a1505', align = 'center', weight = 'bold', font = '"Trebuchet MS", Verdana, sans-serif') {
    g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(3, size / 5); g.strokeStyle = stroke; g.strokeText(s, x, y); }
    g.fillStyle = color; g.fillText(s, x, y);
  }
  function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
  function rad(g, x, y, r0, r1, stops) { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }

  // --- arrow-ended plaque (HP bars, value tags) ---
  function plaque(g, cx, cy, w, h, fill, edge) {
    const x0 = cx - w / 2, x1 = cx + w / 2, a = h / 2;
    g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + a, cy - a); g.lineTo(x1 - a, cy - a); g.lineTo(x1, cy); g.lineTo(x1 - a, cy + a); g.lineTo(x0 + a, cy + a); g.closePath();
    g.fillStyle = fill; g.fill(); if (edge) { g.strokeStyle = edge; g.lineWidth = 1.5; g.stroke(); }
  }

  // --- Scorpion (original cartoon design, facing the barricades) ---
  const PAL = {
    crawler:   { shell: '#b8432c', shell2: '#7c2414', belly: '#e0774a', claw: '#f2b136', claw2: '#b06a10', eye: '#ffe9a8', line: '#4a1208' },
    hatchling: { shell: '#7a2a24', shell2: '#3e1210', belly: '#b34a36', claw: '#d8692e', claw2: '#7a2a0c', eye: '#ffd27a', line: '#2a0806' },
    giant:     { shell: '#8a6142', shell2: '#4e3320', belly: '#b88a5e', claw: '#c9a27a', claw2: '#6e4a2c', eye: '#ff8a3a', line: '#2e1d10' },
    queen:     { shell: '#3a3540', shell2: '#17141c', belly: '#c4283a', claw: '#d63a3a', claw2: '#6a0e18', eye: '#ff4a4a', line: '#0e0a10' },
  };
  function drawScorpion(g, cx, cy, type, t, sc = 1) {
    const p = PAL[type];
    const s = (type === 'giant' ? 50 : type === 'queen' ? 46 : type === 'hatchling' ? 27 : 33) * sc;
    g.save(); g.translate(cx, cy); if (type === 'giant' || type === 'queen') g.scale(1.45, 1); g.lineJoin = 'round'; g.lineCap = 'round';
    const lw = Math.max(1.6, s * 0.06);
    // ground shadow
    g.fillStyle = 'rgba(120,60,10,.25)'; g.beginPath(); g.ellipse(0, s * 0.62, s * 1.05, s * 0.3, 0, 0, 7); g.fill();
    // legs (4 per side)
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const wig = Math.sin(t * 8 + i * 1.7 + side) * s * 0.05, y0 = -s * 0.22 + i * s * 0.15;
      g.strokeStyle = p.line; g.lineWidth = lw * 2.4;
      g.beginPath(); g.moveTo(side * s * 0.3, y0); g.lineTo(side * s * 0.72, y0 - s * 0.14 + wig); g.lineTo(side * s * 0.86, y0 + s * 0.16 + wig); g.stroke();
      g.strokeStyle = p.shell2; g.lineWidth = lw * 1.3;
      g.beginPath(); g.moveTo(side * s * 0.3, y0); g.lineTo(side * s * 0.72, y0 - s * 0.14 + wig); g.lineTo(side * s * 0.86, y0 + s * 0.16 + wig); g.stroke();
    }
    // tail: arches up behind the body, stinger curls forward over it
    const segs = 5, sway = Math.sin(t * 2.6) * s * 0.06;
    const pts = [];
    for (let i = 0; i <= segs; i++) { const a = i / segs; pts.push([sway * a + Math.sin(a * 1.4) * s * 0.06, -s * 0.35 - Math.sin(a * Math.PI * 0.62) * s * 0.95 + a * a * s * 0.25]); }
    for (let i = segs; i >= 1; i--) {
      const [x, y] = pts[i], r = s * (0.25 - i * 0.025);
      g.fillStyle = lin(g, x - r, y - r, x + r, y + r, [[0, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.ellipse(x, y, r * 1.05, r * 0.85, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.22, -0.5, 0, 7); g.fill();
    }
    { // stinger
      const [x, y] = pts[segs];
      g.fillStyle = type === 'queen' ? '#e8e0d0' : p.claw; g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x - s * 0.12, y - s * 0.05); g.quadraticCurveTo(x + s * 0.05, y - s * 0.38, x + s * 0.22, y - s * 0.12); g.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s * 0.1, y + s * 0.06); g.closePath(); g.fill(); g.stroke();
    }
    // claws (pincers forward / down)
    for (const side of [-1, 1]) {
      const sw = Math.sin(t * 3.5 + side) * 0.06;
      g.save(); g.rotate(side * sw);
      // arm
      g.strokeStyle = p.line; g.lineWidth = s * 0.2; g.beginPath(); g.moveTo(side * s * 0.25, s * 0.15); g.quadraticCurveTo(side * s * 0.62, s * 0.18, side * s * 0.6, s * 0.48); g.stroke();
      g.strokeStyle = p.shell; g.lineWidth = s * 0.13; g.beginPath(); g.moveTo(side * s * 0.25, s * 0.15); g.quadraticCurveTo(side * s * 0.62, s * 0.18, side * s * 0.6, s * 0.48); g.stroke();
      // pincer
      const px = side * s * 0.58, py = s * 0.62;
      g.fillStyle = lin(g, px, py - s * 0.25, px, py + s * 0.3, [[0, p.claw], [1, p.claw2]]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.ellipse(px, py, s * 0.24, s * 0.2, 0, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(px - side * s * 0.18, py + s * 0.08); g.quadraticCurveTo(px - side * s * 0.25, py + s * 0.4, px - side * s * 0.02, py + s * 0.42); g.quadraticCurveTo(px - side * s * 0.05, py + s * 0.22, px + side * s * 0.02, py + s * 0.14); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(px + side * s * 0.12, py + s * 0.12); g.quadraticCurveTo(px + side * s * 0.16, py + s * 0.44, px - side * s * 0.0, py + s * 0.48); g.quadraticCurveTo(px + side * s * 0.03, py + s * 0.28, px - side * s * 0.02, py + s * 0.16); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // body (carapace)
    g.fillStyle = lin(g, 0, -s * 0.45, 0, s * 0.35, [[0, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw * 1.2;
    g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.4, s * 0.42, 0, 0, 7); g.fill(); g.stroke();
    // plates
    g.strokeStyle = p.line; g.lineWidth = lw * 0.8;
    for (let i = 0; i < 3; i++) { const y = -s * 0.3 + i * s * 0.14; g.beginPath(); g.moveTo(-s * 0.36, y); g.quadraticCurveTo(0, y + s * 0.08, s * 0.36, y); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.ellipse(-s * 0.13, -s * 0.25, s * 0.13, s * 0.07, -0.4, 0, 7); g.fill();
    if (type === 'queen') { // red markings + crest
      g.fillStyle = p.belly; for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(sd * s * 0.22, -s * 0.06, s * 0.08, s * 0.16, sd * 0.3, 0, 7); g.fill(); }
      g.fillStyle = '#d63a3a'; g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.moveTo(-s * 0.26, s * 0.06); g.lineTo(-s * 0.18, -s * 0.12); g.lineTo(-s * 0.08, s * 0.0); g.lineTo(0, -s * 0.2); g.lineTo(s * 0.08, s * 0.0); g.lineTo(s * 0.18, -s * 0.12); g.lineTo(s * 0.26, s * 0.06); g.closePath(); g.fill(); g.stroke();
    }
    if (type === 'giant') { // rocky armor spikes
      g.fillStyle = '#a07a52'; g.strokeStyle = p.line; g.lineWidth = lw;
      for (const [x, y, r] of [[-s * 0.3, -s * 0.3, 0.16], [s * 0.3, -s * 0.3, 0.16], [0, -s * 0.42, 0.14], [-s * 0.38, -s * 0.02, 0.12], [s * 0.38, -s * 0.02, 0.12]]) {
        g.beginPath(); g.moveTo(x - s * r, y + s * r * 0.5); g.lineTo(x, y - s * r * 1.2); g.lineTo(x + s * r, y + s * r * 0.5); g.closePath(); g.fill(); g.stroke();
      }
    }
    // head + eyes
    g.fillStyle = lin(g, 0, s * 0.1, 0, s * 0.45, [[0, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw;
    g.beginPath(); g.ellipse(0, s * 0.27, s * 0.27, s * 0.17, 0, 0, 7); g.fill(); g.stroke();
    const blink = Math.sin(t * 1.1 + cx * 0.1) > 0.985 ? 0.2 : 1;
    for (const sd of [-1, 1]) {
      g.fillStyle = p.eye; g.beginPath(); g.ellipse(sd * s * 0.1, s * 0.25, s * 0.07, s * 0.075 * blink, 0, 0, 7); g.fill();
      g.fillStyle = '#140804'; g.beginPath(); g.ellipse(sd * s * 0.1, s * 0.27, s * 0.035, s * 0.045 * blink, 0, 0, 7); g.fill();
    }
    g.restore();
  }

  // --- Cannon (top-hat barrel on a spiked base) ---
  function drawCannon(g, x, y, v, sc = 1, alpha = 1, showTag = true) {
    const tr = tier(v);
    g.save(); g.globalAlpha = alpha; g.translate(x, y); g.scale(sc, sc); g.lineJoin = 'round';
    // shadow
    g.fillStyle = 'rgba(90,45,0,.28)'; g.beginPath(); g.ellipse(0, 22, 34, 9, 0, 0, 7); g.fill();
    // spiked base
    g.fillStyle = tr.dark; g.strokeStyle = '#2a1608'; g.lineWidth = 2;
    for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(sd * 18, 2); g.lineTo(sd * 36, -6); g.lineTo(sd * 26, 12); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(sd * 20, 12); g.lineTo(sd * 34, 18); g.lineTo(sd * 16, 20); g.closePath(); g.fill(); g.stroke(); }
    g.fillStyle = lin(g, -26, 0, 26, 0, [[0, '#5a3a20'], [0.5, '#9a6a3a'], [1, '#4a2e18']]);
    g.beginPath(); g.moveTo(-26, 4); g.lineTo(26, 4); g.lineTo(22, 22); g.lineTo(-22, 22); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = tr.trim; rr(g, -24, 2, 48, 6, 3); g.fill(); g.stroke();
    // barrel body
    const bw = 20, top = -40;
    g.fillStyle = lin(g, -bw, 0, bw, 0, [[0, tr.dark], [0.35, tr.main], [0.55, tr.light], [0.8, tr.main], [1, tr.dark]]);
    g.beginPath(); g.moveTo(-bw + 2, 4); g.lineTo(-bw, top); g.lineTo(bw, top); g.lineTo(bw - 2, 4); g.closePath(); g.fill(); g.stroke();
    // metal bands (dark wrap)
    g.fillStyle = lin(g, -bw, 0, bw, 0, [[0, '#2a2a30'], [0.5, '#6a6a78'], [1, '#26262c']]);
    rr(g, -bw - 1, -22, bw * 2 + 2, 12, 3); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let i = -16; i <= 16; i += 6) { g.beginPath(); g.moveTo(i, -21); g.lineTo(i + 3, -11); g.stroke(); }
    g.strokeStyle = '#2a1608'; g.lineWidth = 2;
    // muzzle rim
    g.fillStyle = lin(g, -bw - 4, 0, bw + 4, 0, [[0, tr.dark], [0.5, tr.light], [1, tr.dark]]);
    g.beginPath(); g.ellipse(0, top, bw + 4, 7, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#1a0e08'; g.beginPath(); g.ellipse(0, top, bw - 4, 4, 0, 0, 7); g.fill();
    if (tr.name === 'gold') { g.strokeStyle = '#d9b046'; g.lineWidth = 3; g.beginPath(); g.moveTo(-bw + 1, -2); g.lineTo(bw - 1, -2); g.stroke(); }
    g.restore();
    if (showTag) valueTag(g, x + 4 * sc, y + 30 * sc, v, sc, alpha);
  }
  function tierIcon(g, x, y, r, tr) {
    // a little flame/drop gem in tier colour
    g.fillStyle = lin(g, x, y - r, x, y + r, [[0, tr.light], [1, tr.main]]); g.strokeStyle = '#1a0e08'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y - r * 1.25); g.quadraticCurveTo(x + r * 1.1, y, x, y + r); g.quadraticCurveTo(x - r * 1.1, y, x, y - r * 1.25); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(x - r * 0.25, y, r * 0.2, r * 0.35, 0, 0, 7); g.fill();
  }
  function valueTag(g, x, y, v, sc = 1, alpha = 1) {
    g.save(); g.globalAlpha = alpha;
    const w = (34 + String(fmt(v)).length * 9) * sc, h = 20 * sc;
    plaque(g, x, y, w, h, 'rgba(38,26,18,.88)');
    tierIcon(g, x - w / 2 + 2 * sc, y, 8 * sc, tier(v));
    text(g, fmt(v), x + 6 * sc, y + 1, 15 * sc, '#fff', null);
    g.restore();
  }

  // --- Field cannon (glass bubble) ---
  function drawPickup(g, x, y, v, t, sc = 1) {
    g.save(); g.translate(x, y); g.scale(sc, sc);
    const r = 27, bob = Math.sin(t * 3) * 2;
    g.translate(0, bob);
    g.fillStyle = rad(g, 0, 0, 2, r + 10, [[0, 'rgba(120,200,255,.0)'], [0.7, 'rgba(120,200,255,.25)'], [1, 'rgba(120,200,255,0)']]);
    g.beginPath(); g.arc(0, 0, r + 10, 0, 7); g.fill();
    g.fillStyle = rad(g, -6, -8, 2, r, [[0, 'rgba(255,255,255,.85)'], [0.45, 'rgba(150,215,255,.45)'], [1, 'rgba(40,120,210,.75)']]);
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.strokeStyle = '#bfe6ff'; g.lineWidth = 2.5; g.stroke();
    // mini cannon inside
    g.save(); g.rotate(-0.5); drawCannon(g, 0, 4, v, 0.45, 1, false); g.restore();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(-10, -13, 8, 4, -0.6, 0, 7); g.fill();
    g.restore();
    valueTag(g, x, y + bob + 34 * sc, v, 0.95 * sc);
  }

  // --- HP bar (red plaque with number) ---
  function hpBar(g, cx, cy, w, hp, maxHp) {
    plaque(g, cx, cy, w + 8, 19, 'rgba(50,20,12,.85)');
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    g.save(); g.beginPath(); g.rect(cx - w / 2, cy - 10, w * frac, 20); g.clip();
    plaque(g, cx, cy, w, 13, lin(g, 0, cy - 7, 0, cy + 7, [[0, '#e84a3a'], [1, '#9a1a14']]));
    g.restore();
    text(g, fmt(Math.max(0, Math.ceil(hp))), cx, cy + 1, 15, '#fff', 'rgba(40,10,5,.8)');
  }

  // --- Barricade (logs, rope, spiked stakes) ---
  function drawBarricade(g, x0, x1, cy, broken, t) {
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    const logY = cy - 2;
    const log = (ax, ay, bx, by, r) => {
      const ang = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay);
      g.save(); g.translate(ax, ay); g.rotate(ang);
      g.fillStyle = lin(g, 0, -r, 0, r, [[0, '#c48a52'], [0.4, '#a0683a'], [1, '#5e3a1c']]); g.strokeStyle = '#3a2210'; g.lineWidth = 2;
      rr(g, 0, -r, len, r * 2, r); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(60,30,10,.45)'; g.lineWidth = 1.2; for (let i = 14; i < len - 8; i += 22) { g.beginPath(); g.moveTo(i, -r * 0.5); g.lineTo(i + 10, -r * 0.4); g.stroke(); }
      g.fillStyle = '#e0b07a'; g.beginPath(); g.ellipse(len, 0, r * 0.45, r, 0, 0, 7); g.fill(); g.stroke();
      g.restore();
    };
    const post = (x, y, tilt) => {
      g.save(); g.translate(x, y); g.rotate(tilt);
      // stakes
      g.fillStyle = '#d8b07a'; g.strokeStyle = '#3a2210'; g.lineWidth = 1.5;
      for (const [dx, dy, a] of [[-12, -14, -0.7], [12, -14, 0.7], [-14, 4, -1.6], [14, 4, 1.6]]) { g.save(); g.translate(dx, dy); g.rotate(a); g.beginPath(); g.moveTo(-3, 0); g.lineTo(0, -16); g.lineTo(3, 0); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      g.fillStyle = lin(g, -11, 0, 11, 0, [[0, '#6a4224'], [0.5, '#b07a46'], [1, '#5a361a']]);
      rr(g, -11, -24, 22, 36, 6); g.fill(); g.stroke();
      g.fillStyle = '#e0b07a'; g.beginPath(); g.ellipse(0, -24, 11, 5, 0, 0, 7); g.fill(); g.stroke();
      g.strokeStyle = '#3a2210'; g.lineWidth = 1; g.beginPath(); g.ellipse(0, -24, 5, 2.2, 0, 0, 7); g.stroke();
      // rope wraps
      g.strokeStyle = '#e8d2a0'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-12, -8 + i * 5); g.lineTo(12, -5 + i * 5); g.stroke(); }
      g.restore();
    };
    if (!broken) {
      log(x0 + 10, logY - 6, x1 - 10, logY - 6, 7);
      log(x0 + 10, logY + 7, x1 - 10, logY + 7, 7);
      post(x0 + 18, cy + 4, 0); post(x1 - 18, cy + 4, 0);
      if (x1 - x0 > 150) post((x0 + x1) / 2, cy + 4, 0);
      // rope between
      g.strokeStyle = '#e8d2a0'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 18, cy - 12); g.quadraticCurveTo((x0 + x1) / 2, cy - 2, x1 - 18, cy - 12); g.stroke();
    } else {
      const m = (x0 + x1) / 2;
      log(x0 + 8, logY + 10, m - 14, logY - 2, 7);
      log(m + 22, logY + 12, x1 - 6, logY + 2, 7);
      post(x0 + 18, cy + 8, -0.35); post(x1 - 18, cy + 8, 0.4);
      // splinters + rubble
      g.fillStyle = '#d8b07a'; g.strokeStyle = '#3a2210'; g.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) { const sx = m - 30 + i * 10, sy = cy + ((i * 37) % 13) - 4; g.save(); g.translate(sx, sy); g.rotate(i * 1.3); g.beginPath(); g.moveTo(-2, 0); g.lineTo(0, -10); g.lineTo(2, 0); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      g.fillStyle = 'rgba(90,50,20,.35)'; g.beginPath(); g.ellipse(m, cy + 16, 42, 7, 0, 0, 7); g.fill();
    }
    g.restore();
  }

  // --- Item icons ---
  function itemIcon(g, k, x, y) {
    g.save(); g.translate(x, y); g.lineWidth = 2; g.strokeStyle = '#1a0e08'; g.lineJoin = 'round';
    if (k === 'spray') {
      g.fillStyle = lin(g, -10, 0, 10, 0, [[0, '#3a8a3a'], [0.5, '#7ad06a'], [1, '#2a6a2a']]); rr(g, -10, -8, 20, 26, 5); g.fill(); g.stroke();
      g.fillStyle = '#e0e0e0'; rr(g, -6, -16, 12, 9, 2); g.fill(); g.stroke();
      g.fillStyle = '#ffe14a'; g.beginPath(); g.arc(0, 5, 5, 0, 7); g.fill();
      g.fillStyle = 'rgba(220,255,220,.85)'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(10 + i * 4, -16 - i * 2 + (i % 2) * 4, 2.6, 0, 7); g.fill(); }
    } else if (k === 'fire') {
      g.fillStyle = '#5a5a66'; g.beginPath(); g.arc(-7, 8, 9, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.arc(8, 10, 7, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#ff6a2a'; g.beginPath(); g.moveTo(2, -20); g.quadraticCurveTo(18, -4, 10, 6); g.quadraticCurveTo(2, 10, -6, 4); g.quadraticCurveTo(-14, -6, 2, -20); g.fill(); g.stroke();
      g.fillStyle = '#ffe14a'; g.beginPath(); g.moveTo(2, -8); g.quadraticCurveTo(9, 0, 5, 4); g.lineTo(-2, 4); g.quadraticCurveTo(-5, -2, 2, -8); g.fill();
    } else if (k === 'super') {
      g.fillStyle = lin(g, 0, -18, 0, 18, [[0, '#ffe680'], [1, '#c98a10']]); g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 13 : 19; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#3a2a5a'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#b67cff'; g.beginPath(); g.arc(0, 0, 3.5, 0, 7); g.fill();
    }
    g.restore();
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
    // warm sand
    g.fillStyle = lin(g, 0, 0, 0, H, [[0, '#f0b44e'], [0.5, '#f3bd58'], [1, '#e8a845']]); g.fillRect(0, 0, W, H);
    g.save(); g.translate(0, OY);
    // sand speckle + ripples
    for (let i = 0; i < 260; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,230,160,.35)' : 'rgba(190,120,40,.18)'; g.beginPath(); g.arc(rnd() * W, -OY + rnd() * H, 0.8 + rnd() * 1.8, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(200,130,40,.22)'; g.lineWidth = 2;
    for (let i = 0; i < 18; i++) { const y = -OY + rnd() * H, x = rnd() * W; g.beginPath(); g.moveTo(x - 40, y); g.quadraticCurveTo(x, y - 6, x + 40, y); g.stroke(); }
    // field tile grid (lighter squares)
    for (let r = 0; r < ROWS; r++) for (let l = 0; l < LANES; l++) {
      const x = FX + l * LW, y = FY + r * CH;
      g.fillStyle = 'rgba(255,214,130,.55)'; g.fillRect(x + 1.5, y + 1.5, LW - 3, CH - 3);
      g.fillStyle = 'rgba(255,240,200,.25)'; g.fillRect(x + 1.5, y + 1.5, LW - 3, 4);
    }
    g.strokeStyle = 'rgba(214,150,60,.55)'; g.lineWidth = 1.5;
    for (let l = 0; l <= LANES; l++) { g.beginPath(); g.moveTo(FX + l * LW, FY); g.lineTo(FX + l * LW, FB); g.stroke(); }
    for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(FX, FY + r * CH); g.lineTo(FX + FW, FY + r * CH); g.stroke(); }
    // tray tiles (cracked sand squares)
    const tile = (cx, cy, size) => {
      const x = cx - size / 2, y = cy - size / 2;
      g.fillStyle = lin(g, x, y, x, y + size, [[0, '#eeb25a'], [1, '#df9c44']]); rr(g, x, y, size, size, 6); g.fill();
      g.strokeStyle = 'rgba(150,85,25,.45)'; g.lineWidth = 2; rr(g, x, y, size, size, 6); g.stroke();
      g.strokeStyle = 'rgba(255,225,160,.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 6, y + 3); g.lineTo(x + size - 6, y + 3); g.stroke();
      g.strokeStyle = 'rgba(150,85,25,.25)'; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { let px = x + 10 + rnd() * (size - 20), py = y + 10 + rnd() * (size - 20); g.beginPath(); g.moveTo(px, py); for (let j = 0; j < 3; j++) { px += rnd() * 16 - 8; py += rnd() * 14 - 4; g.lineTo(px, py); } g.stroke(); }
    };
    for (let i = 0; i < G.SLOTS; i++) { const s = slotXY(i); tile(s.x, s.y, 88); }
    // item tray (dark rounded)
    { const tw = ITEM_GAP * 3 + 20, tx = ITEM_CX - tw / 2; g.fillStyle = 'rgba(40,26,16,.55)'; rr(g, tx, BY + 4, tw, 80, 40); g.fill();
    g.strokeStyle = 'rgba(255,220,160,.18)'; g.lineWidth = 2; rr(g, tx, BY + 4, tw, 80, 40); g.stroke(); }
    // pocket tile
    tile(POCK.x, POCK.y, 88);
    g.setLineDash([6, 5]); g.strokeStyle = 'rgba(110,60,15,.6)'; g.lineWidth = 2; rr(g, POCK.x - 40, POCK.y - 40, 80, 80, 6); g.stroke(); g.setLineDash([]);
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
    buttons.push({ id: 'mute', x: W - 112, y: 88, w: 42, h: 40 });
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
      const sy = y - (v.w === 2 ? 8 : 10);
      drawScorpion(ctx, x, sy, v.type, ts + v.seed);
      if (t - v.hitT < 110) { ctx.globalAlpha = 0.45; ctx.globalCompositeOperation = 'lighter'; drawScorpion(ctx, x, sy, v.type, ts + v.seed); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      ctx.restore();
      bars.push([x, y + CH / 2 - 13, v.w === 2 ? 140 : 70, v.hp, v.maxHp, pop, v.fade ? Math.max(0, 1 - (t - v.fade) / 400) : 1]);
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
      drawCannon(ctx, x, y - 2, v, sc * 0.95);
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

    drawItems();
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

  function drawHeader() {
    const g = ctx;
    // dark info band (translucent) + extension to top of screen on tall phones
    g.fillStyle = 'rgba(30,20,12,.62)'; g.fillRect(0, -OY, W, OY + HDR);
    g.fillStyle = lin(g, 0, HDR - 4, 0, HDR + 6, [[0, 'rgba(30,20,12,.5)'], [1, 'rgba(30,20,12,0)']]); g.fillRect(0, HDR - 4, W, 10);
    // ornate title bar
    g.fillStyle = lin(g, 0, -OY, 0, 46, [[0, '#2a2f3e'], [1, '#1c202c']]);
    g.beginPath(); g.moveTo(0, -OY); g.lineTo(W, -OY); g.lineTo(W, 46); g.lineTo(300, 46); g.quadraticCurveTo(286, 46, 280, 40); g.lineTo(272, 30); g.lineTo(0, 30); g.closePath(); g.fill();
    g.fillStyle = lin(g, 0, -OY, 0, 46, [[0, '#2a2f3e'], [1, '#1c202c']]); g.fillRect(0, -OY, 300, OY + 46);
    g.strokeStyle = '#c9a25a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 46); g.lineTo(W, 46); g.stroke();
    g.strokeStyle = 'rgba(201,162,90,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 42); g.lineTo(W, 42); g.stroke();
    // filigree dots
    g.fillStyle = '#c9a25a'; for (let x = 8; x < W; x += 24) { g.beginPath(); g.arc(x, 46, 2, 0, 7); g.fill(); }
    text(g, 'Sandline Siege', 12, 23, 24, '#f6ead2', '#0e0a06', 'left', 'bold', 'Georgia, "Times New Roman", serif');
    // help "?"
    const hb = buttons.find((b) => b.id === 'help');
    g.fillStyle = lin(g, 0, hb.y, 0, hb.y + hb.h, [[0, '#f2d27a'], [1, '#b8862a']]); g.beginPath(); g.arc(hb.x + hb.w / 2, hb.y + hb.h / 2, 13, 0, 7); g.fill();
    g.strokeStyle = '#4a3010'; g.lineWidth = 2; g.stroke(); text(g, '?', hb.x + hb.w / 2, hb.y + hb.h / 2 + 1, 18, '#3a2208', null);
    // score pills
    const pill = (y, label, val) => {
      const x0 = W - 236, w = 226, h = 30;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 12, y - h / 2); g.lineTo(x0 + w, y - h / 2); g.lineTo(x0 + w, y + h / 2); g.lineTo(x0 + 12, y + h / 2); g.closePath();
      g.fillStyle = lin(g, 0, y - h / 2, 0, y + h / 2, [[0, '#fbf1dc'], [1, '#e2cfa8']]); g.fill(); g.strokeStyle = '#8a6a3a'; g.lineWidth = 2; g.stroke();
      text(g, label, x0 + 20, y + 1, 16, '#3a2a1a', null, 'left', 'normal');
      text(g, val, x0 + w - 10, y + 1, 16, '#3a2a1a', null, 'right', 'normal');
    };
    pill(24, 'Total Score', fmtScore(lifetime + S.score));
    pill(62, 'Round Score', fmtScore(S.score));
    // crosshair badge + kills
    const bx = 38, by = 74;
    g.save(); g.translate(bx, by);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(0, 2, 22, 0, 7); g.fill();
    g.strokeStyle = '#d42a24'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.stroke();
    g.lineWidth = 3; for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) { g.beginPath(); g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); g.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); g.stroke(); }
    g.strokeStyle = '#ff5a4a'; g.lineWidth = 5; g.beginPath(); g.moveTo(-9, -9); g.lineTo(9, 9); g.moveTo(9, -9); g.lineTo(-9, 9); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(20,12,6,.75)'; rr(g, bx - 26, by + 26, 52, 20, 6); g.fill();
    text(g, `${S.kills}/${G.KILLS_PER_LEVEL}`, bx, by + 36, 14, '#fff', null);
    text(g, `Defense Level: ${S.level}`, 76, 70, 19, '#f6ead2', 'rgba(0,0,0,.6)', 'left', 'normal');
    g.font = 'normal 18px "Trebuchet MS", Verdana, sans-serif'; g.textAlign = 'left';
    text(g, 'Points', 76, 100, 18, '#f6ead2', 'rgba(0,0,0,.6)', 'left', 'normal');
    text(g, `+${G.bonusPct(S.level)}%`, 76 + g.measureText('Points ').width + 2, 100, 18, '#f2c240', 'rgba(0,0,0,.6)', 'left', 'bold');
    // barricade status pips
    for (let i = 0; i < 2; i++) { const x = 76 + 150 + i * 20, y = 100; g.fillStyle = S.walls[i] ? '#b07a46' : '#5a2a1a'; g.strokeStyle = '#2a1608'; g.lineWidth = 1.5; rr(g, x - 7, y - 7, 14, 14, 3); g.fill(); g.stroke(); if (!S.walls[i]) text(g, '×', x, y, 14, '#ff6a5a', null); }
    // mute + guidebook
    const mb = buttons.find((b) => b.id === 'mute'), gb = buttons.find((b) => b.id === 'guide');
    const cx = mb.x + mb.w / 2, cy = mb.y + mb.h / 2;
    g.fillStyle = 'rgba(20,12,6,.6)'; g.beginPath(); g.arc(cx, cy, 17, 0, 7); g.fill(); g.strokeStyle = '#c9a25a'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#f6ead2'; g.beginPath(); g.moveTo(cx - 9, cy - 4); g.lineTo(cx - 4, cy - 4); g.lineTo(cx + 2, cy - 9); g.lineTo(cx + 2, cy + 9); g.lineTo(cx - 4, cy + 4); g.lineTo(cx - 9, cy + 4); g.closePath(); g.fill();
    g.strokeStyle = '#f6ead2'; g.lineWidth = 2;
    if (muted) { g.beginPath(); g.moveTo(cx + 5, cy - 5); g.lineTo(cx + 12, cy + 5); g.moveTo(cx + 12, cy - 5); g.lineTo(cx + 5, cy + 5); g.stroke(); }
    else { g.beginPath(); g.arc(cx + 3, cy, 5, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(cx + 3, cy, 10, -0.9, 0.9); g.stroke(); }
    // book
    g.save(); g.translate(gb.x + gb.w / 2, gb.y + gb.h / 2); g.rotate(-0.12);
    g.fillStyle = '#7a1e14'; g.strokeStyle = '#2a0a06'; g.lineWidth = 2; rr(g, -17, -15, 34, 30, 4); g.fill(); g.stroke();
    g.fillStyle = '#f2e2c0'; g.fillRect(-14, 11, 30, 4);
    g.strokeStyle = '#e8b84a'; g.lineWidth = 1.5; rr(g, -12, -10, 24, 18, 3); g.stroke();
    g.fillStyle = '#e8b84a'; g.beginPath(); g.arc(0, -1, 4, 0, 7); g.fill();
    g.restore();
  }

  function drawItems() {
    for (const k of itemKeys) {
      const { x, y } = itemXY(k), n = S.items[k], active = mode && mode.item === k;
      const [c1, c2] = ITEM_RING[k];
      ctx.save();
      if (active) { ctx.fillStyle = 'rgba(255,230,120,.35)'; ctx.beginPath(); ctx.arc(x, y, 40, 0, 7); ctx.fill(); }
      ctx.fillStyle = rad(ctx, x - 8, y - 10, 4, 34, [[0, c1], [1, c2]]); ctx.beginPath(); ctx.arc(x, y, 31, 0, 7); ctx.fill();
      ctx.strokeStyle = lin(ctx, 0, y - 32, 0, y + 32, [[0, '#f2d27a'], [1, '#7a5a20']]); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.globalAlpha = n ? 1 : 0.35; itemIcon(ctx, k, x, y - 4); ctx.globalAlpha = 1;
      text(ctx, String(n), x, y + 24, 16, '#fff', '#1a0e08');
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
      if (b.id === 'mute') { muted = !muted; LS.set('muted', muted); if (!muted) sfx.pop(); }
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
    if (s >= 0 && G.getSlot(S, s)) { drag = { from: s, x, y, sx: x, sy: y, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
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
