/* Sandline Siege - rendering, input, audio */
(() => {
  'use strict';
  const G = window.SandGame;
  const W = 500, H = 972, LANES = G.LANES, ROWS = G.ROWS, LW = W / LANES;
  const FY = 112, CH = 86, WY = FY + CH * ROWS, WH = 46, TY = WY + WH + 8, SH = 100, BY = TY + SH * 2 + 6, BH = 80;
  const wallMid = (wi) => (G.WALL_SPANS[wi][0] + G.WALL_SPANS[wi][1]) / 2 * LW;
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
    shoot() { const n = performance.now(); if (n - lastShot < 40) return; lastShot = n; tone(520 + Math.random() * 200, 0.08, 'square', 0.025, 900); },
    hit() { noise(0.06, 0.06, 2400); },
    die() { noise(0.28, 0.12, 700); tone(260, 0.22, 'sawtooth', 0.04, 70); },
    merge() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, 'triangle', 0.08, null, i * 0.05)); },
    move() { tone(380, 0.07, 'triangle', 0.06, 520); },
    spawnT() { tone(700, 0.06, 'sine', 0.05, 1100); },
    wall() { tone(110, 0.25, 'sine', 0.25, 45); noise(0.15, 0.08, 400); },
    breakW() { noise(0.6, 0.2, 500); tone(80, 0.5, 'sawtooth', 0.08, 30); },
    level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.14, 'square', 0.04, null, i * 0.07)); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, null, i * 0.22)); },
    bad() { tone(160, 0.12, 'square', 0.04, 120); },
    item() { tone(300, 0.3, 'sawtooth', 0.05, 1200); },
    boom() { noise(0.5, 0.25, 900); tone(90, 0.4, 'sine', 0.2, 40); },
    pop() { tone(900, 0.08, 'sine', 0.07, 1500); },
  };

  // ---------- layout helpers ----------
  const slotXY = (i) => ({ x: (i % LANES) * LW + LW / 2, y: TY + Math.floor(i / LANES) * SH + SH / 2 });
  const rowY = (r) => FY + r * CH + CH / 2;
  const tierColor = (v) => {
    if (v <= 4) return ['#5fd24a', '#2b8a22'];      // green
    if (v <= 16) return ['#3fc4d9', '#18788c'];     // teal
    if (v <= 64) return ['#4a86f0', '#1f4aa8'];     // blue
    if (v <= 256) return ['#a65cf0', '#6326a8'];    // purple
    if (v <= 1024) return ['#ffc531', '#b67d00'];   // gold
    return ['#ff5a4a', '#a8160c'];                   // red
  };

  // ---------- state ----------
  let tapSel = -1;
  let S, vis, bubVis, projectiles, floaters, particles, slotFx, toast, busy, mode, drag, shake, wallFlash, overShown;
  const now = () => performance.now();

  function newRun() {
    S = G.newGame();
    vis = new Map(); bubVis = new Map(); projectiles = []; floaters = []; particles = []; slotFx = {};
    toast = null; busy = false; mode = null; drag = null; shake = 0; wallFlash = [0, 0]; overShown = false;
    sync(0, true);
    window.__sand = { get S() { return S; }, slotXY, rowY, LW, W, H, FY, CH, TY, SH, BY, BH, get busy() { return busy; }, toScreen };
  }

  function sync(appearDelay, reconcile) {
    const t = now(), ids = new Set();
    for (const e of S.enemies) {
      ids.add(e.id);
      let v = vis.get(e.id);
      if (!v) {
        v = { id: e.id, type: e.type, lane: e.lane, w: e.w, row: e.row, dRow: appearDelay ? e.row : e.row - 0.9, hp: e.hp, maxHp: e.maxHp,
          appear: t + appearDelay, seed: Math.random() * 10, hitT: 0 };
        vis.set(e.id, v);
      } else { v.row = e.row; v.lane = e.lane; if (reconcile) { v.hp = e.hp; v.maxHp = e.maxHp; } }
    }
    for (const [id, v] of vis) if (!ids.has(id) && !v.dying) { puff(ex(v), rowY(v.dRow), '#e8c27a', 10); vis.delete(id); }
    const bids = new Set();
    for (const b of S.bubbles) {
      bids.add(b.id);
      if (!bubVis.has(b.id)) bubVis.set(b.id, { ...b, appear: t + appearDelay, seed: Math.random() * 6 });
      else Object.assign(bubVis.get(b.id), { ttl: b.ttl });
    }
    for (const [id, b] of bubVis) if (!bids.has(id)) { if (!b.collected) puff(b.lane * LW + LW / 2, rowY(b.row), '#bfe8ff', 8); bubVis.delete(id); }
  }
  const ex = (v) => (v.lane + v.w / 2) * LW;

  // ---------- fx ----------
  function puff(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.5 + Math.random() * 0.4, t: 0, r: 4 + Math.random() * 7, color });
    }
  }
  function floater(x, y, text, color = '#ff3b2f', size = 30, life = 0.9) { floaters.push({ x, y, text, color, size, t: 0, life }); }
  function showToast(text, ms = 1600, color = '#fff') { toast = { text, until: now() + ms, start: now(), color }; }

  function killVis(id, pts) {
    const v = vis.get(id); if (!v) return;
    const x = ex(v), y = rowY(v.dRow);
    puff(x, y, v.type === 'queen' ? '#c48af0' : '#e9b46a', v.w === 2 ? 26 : 16);
    puff(x, y, '#fff6dc', 6);
    if (pts) floater(x, y - 26, '+' + pts, '#ffe14a', 26, 1.1);
    sfx.die();
    vis.delete(id);
  }

  function shotsFx(evs) {
    let k = 0, end = now();
    const killPts = {};
    for (const e of evs) if (e.type === 'kill') killPts[e.id] = e.pts;
    for (const e of evs) {
      if (e.type !== 'shot') continue;
      const s = slotXY(e.slot), v = e.targetId ? vis.get(e.targetId) : null;
      const delay = (k++) * 45, dur = 260;
      if (v && e.killed) v.dying = true;
      const p = { x0: s.x, y0: s.y - 30, lane: e.lane, targetId: e.targetId, t0: now() + delay, dur, color: tierColor(e.dmg)[0],
        r: Math.min(15, 6 + Math.log2(e.dmg) * 1.1), done: false,
        onHit: () => {
          const vv = e.targetId ? vis.get(e.targetId) : null;
          if (!vv) return;
          vv.hp = Math.max(0, vv.hp - e.dmg); vv.hitT = now();
          floater(ex(vv) + (Math.random() * 30 - 15), rowY(vv.dRow) - 10, '-' + e.dmg);
          sfx.hit();
          if (e.killed) killVis(e.targetId, killPts[e.targetId]);
        } };
      p.y1 = v ? null : FY - 20;
      projectiles.push(p);
      setTimeout(sfx.shoot, delay);
      end = Math.max(end, now() + delay + dur);
    }
    return end;
  }

  function generalFx(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'merge': slotFx[e.to] = { t: now(), kind: 'merge' }; { const s = slotXY(e.to); puff(s.x, s.y, tierColor(e.value)[0], 14); } sfx.merge(); break;
        case 'moveT': slotFx[e.to] = { t: now(), kind: 'move' }; sfx.move(); break;
        case 'newTurret': slotFx[e.slot] = { t: now(), kind: 'new' }; sfx.spawnT(); break;
        case 'collect': slotFx[e.slot] = { t: now(), kind: 'new' }; { const s = slotXY(e.slot); floater(s.x, s.y - 40, 'NEW ' + e.value, '#7fe0ff', 24); } sfx.pop(); break;
        case 'wallHit': wallFlash[e.wall] = now(); shake = Math.max(shake, 6); sfx.wall(); floater(wallMid(e.wall) + (Math.random() * 30 - 15), WY + 10, '-' + (Math.round(e.dmg * 10) / 10), '#ff3b2f', 26); { const v = vis.get(e.id); if (v) v.bump = now(); } break;
        case 'wallBreak': shake = 16; sfx.breakW(); puff(wallMid(e.wall), WY + WH / 2, '#9a8a78', 30); showToast((e.wall === 0 ? 'West' : 'East') + ' wall has fallen!', 1800, '#ffb0a0'); break;
        case 'levelUp': sfx.level(); showToast(`Defense Level ${e.level}!  Bonus +${e.bonus}%  (+1 ${G.ITEM_INFO[e.item].name})`, 2200, '#ffe14a'); break;
        case 'itemDrop': showToast('Found: ' + G.ITEM_INFO[e.item].name + '!', 1500, '#bff7a8'); sfx.pop(); break;
        case 'breach': showToast('A bug slipped through the breach!', 1200, '#ffb0a0'); break;
        case 'repair': wallFlash[e.wall] = now(); puff(wallMid(e.wall), WY + WH / 2, '#9cf08a', 20); break;
        case 'pushedOff': { const v = vis.get(e.id); if (v) { if (e.pts) floater(ex(v), rowY(0), '+' + e.pts, '#ffe14a', 24); v.dying = true; v.row = -1.5; setTimeout(() => vis.delete(e.id), 400); } } break;
        case 'pass': showToast('No moves - turn passed', 1000); break;
      }
    }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function doMove(action) {
    if (busy || S.over) return;
    const r = G.playerMove(S, action);
    if (!r.ok) { sfx.bad(); showToast(r.msg, 1100, '#ffd0c0'); return; }
    busy = true; mode = null;
    generalFx(r.events);
    await wait(140);
    const fe = G.fire(S);
    const end = shotsFx(fe);
    sync(Math.max(0, end - now()), false);
    generalFx(fe.filter((e) => e.type !== 'kill'));
    await wait(Math.max(250, end - now() + 120));
    const ae = G.advance(S);
    generalFx(ae);
    sync(0, true);
    await wait(300);
    busy = false;
    saveScores();
    if (S.over) gameOver();
  }

  function saveScores() {
    if (S.score > best) { best = S.score; LS.set('best', best); }
  }

  // ---------- items ----------
  const itemKeys = G.ITEMS;
  function tryItem(k) {
    if (busy || S.over) return;
    if (mode && mode.item === k) { mode = null; return; }
    if (!S.items[k]) { sfx.bad(); showToast('No ' + G.ITEM_INFO[k].name + ' left. Earn more by leveling up.', 1500, '#ffd0c0'); return; }
    const info = G.ITEM_INFO[k];
    dialog(info.name, `<p>${info.desc}</p><p>You have <b>${S.items[k]}</b>. Use one?</p>`, [
      { label: 'Cancel', alt: true },
      { label: 'Use', fn: () => {
        if (k === 'spray') { const r = G.useItem(S, 'spray'); if (r.ok) { sfx.item(); generalFx(r.events); sync(0, true); saveScores(); } }
        else { mode = { item: k }; showToast(k === 'fire' ? 'Tap a bug to blast' : k === 'super' ? 'Tap a cannon (32 or less)' : 'Tap a tile to bomb', 2000, '#bff7a8'); }
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
        floater(ex(v), rowY(v.dRow) - 10, '-' + e.dmg, '#ff3b2f', 34);
        puff(ex(v), rowY(v.dRow), '#ffb347', 12);
        if (e.killed) { const kk = r.events.find((x) => x.type === 'kill' && x.id === e.id); v.dying = true; killVis(e.id, kk && kk.pts); }
      } else if (e.type === 'bomb') { shake = 12; sfx.boom(); puff(e.lane * LW + LW / 2, rowY(e.row), '#ff8a3a', 40); puff(e.lane * LW + LW / 2, rowY(e.row), '#5a4a3a', 20); }
      else if (e.type === 'super') { slotFx[e.slot] = { t: now(), kind: 'merge' }; const s = slotXY(e.slot); puff(s.x, s.y, '#ffe14a', 18); sfx.merge(); }
    }
    if (k === 'fire') sfx.boom();
    generalFx(r.events.filter((e) => e.type === 'levelUp' || e.type === 'itemDrop'));
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
      <li>Desert bugs crawl down the 5 lanes toward your two walls, one row per turn.</li>
      <li><b>Drag</b> a cannon onto an empty slot to move it, or onto a cannon with the <b>same number</b> to merge them (8 + 8 = 16). Each drag is one turn.</li>
      <li>After every turn, all cannons fire straight up their lane, then the bugs step forward and a fresh cannon appears.</li>
      <li>Fallen bugs sometimes drop a <b>bubble</b>. Tap it to grab a free cannon (no turn used).</li>
      <li>Bugs at the bottom headbutt your walls. Lose both walls and the siege is over. Every 25 kills raises the Defense Level: tougher bugs, +5% points.</li>
    </ol><p>Items along the bottom are free to use: tap one to see what it does.</p>`, [{ label: "Let's go!" }]);
    LS.set('seenHelp', true);
  }
  function guide() {
    const rows = Object.keys(G.TYPES).map((t) => {
      const T = G.TYPES[t];
      return `<div class="guide-row"><canvas width="${T.w * 70}" height="70" data-type="${t}" style="width:${T.w * 70}px;height:70px"></canvas>
        <div><b>${T.name}</b> &middot; ${T.pts} pts<small>${T.w === 2 ? '2 lanes wide. ' : ''}${T.desc}</small></div></div>`;
    }).join('');
    dialog('Bug Guidebook', rows + `<p style="font-size:14px">Bug HP grows with each Defense Level. Current base HP: <b>${G.baseHp(S.level)}</b>.</p>`, [{ label: 'Close' }]);
    ovB.querySelectorAll('canvas[data-type]').forEach((c) => {
      const g = c.getContext('2d'), t = c.dataset.type;
      drawBug(g, c.width / 2, 38, t === 'giant' ? 40 : t === 'hatchling' ? 17 : t === 'queen' ? 36 : 25, t, 0);
    });
  }
  function gameOver() {
    if (overShown) return; overShown = true;
    sfx.over();
    lifetime += S.score; LS.set('lifetime', lifetime);
    const isBest = S.score >= best && S.score > 0;
    setTimeout(() => dialog('The Walls Have Fallen', `<div class="big">${S.score.toLocaleString()}</div>
      ${isBest ? '<p style="text-align:center;color:#2f9a2a;font-weight:bold">New best score!</p>' : ''}
      <div class="stats"><div>Defense Level</div><div>${S.level}</div><div>Bugs slain</div><div>${S.totalKills}</div>
      <div>Turns survived</div><div>${S.turn}</div><div>Best score</div><div>${best.toLocaleString()}</div><div>Lifetime total</div><div>${lifetime.toLocaleString()}</div></div>`,
      [{ label: 'Play Again', fn: newRun }]), 900);
  }

  // ---------- drawing primitives ----------
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function text(g, s, x, y, size, color = '#fff', stroke = '#3a1d06', align = 'center', weight = 'bold') {
    g.font = `${weight} ${size}px "Trebuchet MS", Verdana, sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(3, size / 5); g.strokeStyle = stroke; g.strokeText(s, x, y); }
    g.fillStyle = color; g.fillText(s, x, y);
  }
  const BUG_COLORS = {
    crawler: { body: '#e39a3c', dark: '#8a4a12', belly: '#f5c27a' },
    giant: { body: '#b8432a', dark: '#5e1a0c', belly: '#e07a52' },
    queen: { body: '#8c4fd0', dark: '#3e1a6e', belly: '#c69af2' },
    hatchling: { body: '#f0cf4a', dark: '#8a6a0a', belly: '#fff0a0' },
  };
  // Original cartoon desert bug: round body, segmented curling tail, pincers forward (down).
  function drawBug(g, cx, cy, s, type, t) {
    const c = BUG_COLORS[type];
    g.save(); g.translate(cx, cy);
    g.lineJoin = 'round'; g.lineCap = 'round';
    // shadow
    g.fillStyle = 'rgba(80,40,10,.25)'; g.beginPath(); g.ellipse(0, s * 0.75, s * 0.95, s * 0.28, 0, 0, Math.PI * 2); g.fill();
    // legs
    g.strokeStyle = c.dark; g.lineWidth = Math.max(2.5, s * 0.1);
    for (let side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const wig = Math.sin(t * 9 + i * 2 + side) * s * 0.08, y0 = -s * 0.15 + i * s * 0.22;
      g.beginPath(); g.moveTo(side * s * 0.35, y0); g.lineTo(side * s * 0.8, y0 - s * 0.12 + wig); g.lineTo(side * s * 0.98, y0 + s * 0.2 + wig); g.stroke();
    }
    // tail (curls up behind)
    const segs = 5;
    for (let i = segs; i >= 1; i--) {
      const a = i / segs, sway = Math.sin(t * 3 + i * 0.7) * s * 0.06;
      const x = sway + Math.sin(a * 2.2) * s * 0.25, y = -s * 0.45 - a * s * 0.75 + Math.pow(a, 3) * s * 0.35;
      const r = s * (0.22 - a * 0.08);
      g.fillStyle = c.body; g.strokeStyle = c.dark; g.lineWidth = Math.max(2, s * 0.07);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      if (i === segs) { // stinger
        g.fillStyle = c.dark; g.beginPath(); g.moveTo(x - r * 0.6, y + r * 0.2); g.quadraticCurveTo(x + r * 0.2, y + r * 2.2, x + r * 1.1, y + r * 0.6); g.closePath(); g.fill();
      }
    }
    // claws
    for (const side of [-1, 1]) {
      const sw = Math.sin(t * 4 + side) * 0.08;
      g.save(); g.rotate(side * (0.35 + sw));
      g.fillStyle = c.body; g.strokeStyle = c.dark; g.lineWidth = Math.max(2, s * 0.07);
      g.beginPath(); g.ellipse(side * s * 0.1, s * 0.62, s * 0.12, s * 0.22, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.arc(side * s * 0.1, s * 0.95, s * 0.22, Math.PI * 1.1, Math.PI * 1.9 + Math.PI, false); g.fill(); g.stroke();
      g.fillStyle = c.belly; g.beginPath(); g.arc(side * s * 0.1, s * 0.95, s * 0.08, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // body
    g.fillStyle = c.body; g.strokeStyle = c.dark; g.lineWidth = Math.max(2.5, s * 0.09);
    g.beginPath(); g.ellipse(0, 0, s * 0.52, s * 0.5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = c.belly; g.beginPath(); g.ellipse(0, s * 0.08, s * 0.3, s * 0.27, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = c.dark; g.lineWidth = Math.max(1.5, s * 0.04);
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-s * 0.42, i * s * 0.18 - s * 0.05); g.quadraticCurveTo(0, i * s * 0.18 + s * 0.06, s * 0.42, i * s * 0.18 - s * 0.05); g.stroke(); }
    // eyes
    const ey = s * 0.3, blink = (Math.sin(t * 1.3 + cx) > 0.985) ? 0.15 : 1;
    for (const side of [-1, 1]) {
      g.fillStyle = '#fff'; g.strokeStyle = c.dark; g.lineWidth = Math.max(1.5, s * 0.05);
      g.beginPath(); g.ellipse(side * s * 0.17, ey, s * 0.14, s * 0.15 * blink, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#1b0e05'; g.beginPath(); g.ellipse(side * s * 0.15, ey + s * 0.04, s * 0.07, s * 0.08 * blink, 0, 0, Math.PI * 2); g.fill();
    }
    // angry brows for giant, crown for queen
    if (type === 'giant') { g.strokeStyle = c.dark; g.lineWidth = s * 0.08; for (const side of [-1, 1]) { g.beginPath(); g.moveTo(side * s * 0.3, ey - s * 0.2); g.lineTo(side * s * 0.06, ey - s * 0.1); g.stroke(); } }
    if (type === 'queen') {
      g.fillStyle = '#ffd23a'; g.strokeStyle = '#8a5a00'; g.lineWidth = 2;
      g.beginPath(); const cyc = -s * 0.35;
      g.moveTo(-s * 0.3, cyc); g.lineTo(-s * 0.3, cyc - s * 0.25); g.lineTo(-s * 0.15, cyc - s * 0.12); g.lineTo(0, cyc - s * 0.32); g.lineTo(s * 0.15, cyc - s * 0.12); g.lineTo(s * 0.3, cyc - s * 0.25); g.lineTo(s * 0.3, cyc); g.closePath(); g.fill(); g.stroke();
    }
    g.restore();
  }

  function drawCannon(g, x, y, v, sc = 1, alpha = 1) {
    const [c1, c2] = tierColor(v);
    g.save(); g.globalAlpha = alpha; g.translate(x, y); g.scale(sc, sc);
    g.fillStyle = 'rgba(60,30,5,.3)'; g.beginPath(); g.ellipse(0, 30, 38, 10, 0, 0, Math.PI * 2); g.fill();
    // barrel
    g.fillStyle = '#5b5f6b'; g.strokeStyle = '#25272e'; g.lineWidth = 3;
    rr(g, -10, -42, 20, 36, 6); g.fill(); g.stroke();
    g.fillStyle = '#8a8f9c'; rr(g, -13, -46, 26, 10, 4); g.fill(); g.stroke();
    // body
    const grd = g.createLinearGradient(0, -20, 0, 30); grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = grd; g.strokeStyle = '#2a1a0a'; g.lineWidth = 3.5;
    g.beginPath(); g.arc(0, 6, 31, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-10, -6, 12, 7, -0.5, 0, Math.PI * 2); g.fill();
    if (v > 256) { g.strokeStyle = '#fff6b0'; g.lineWidth = 2; g.beginPath(); g.arc(0, 6, 26, 0, Math.PI * 2); g.stroke(); }
    text(g, String(v), 0, 8, v >= 1000 ? 20 : v >= 100 ? 24 : 28, '#fff', '#241000');
    g.restore();
  }

  // ---------- background (static, cached) ----------
  let bgCanvas = null;
  function buildBg() {
    bgCanvas = document.createElement('canvas'); bgCanvas.width = W * 2; bgCanvas.height = H * 2;
    const g = bgCanvas.getContext('2d'); g.scale(2, 2);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // sand field
    const grd = g.createLinearGradient(0, FY, 0, WY); grd.addColorStop(0, '#f0c27a'); grd.addColorStop(1, '#e6ac62');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // dune ripples
    g.strokeStyle = 'rgba(180,110,40,.25)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const y = FY + rnd() * (WY - FY), x = rnd() * W; g.beginPath(); g.moveTo(x - 50, y); g.quadraticCurveTo(x, y - 8, x + 50, y); g.stroke(); }
    // pebbles
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${140 + rnd() * 40},${90 + rnd() * 30},${50},.45)`; g.beginPath(); g.ellipse(rnd() * W, FY + rnd() * (WY - FY), 2 + rnd() * 4, 1.5 + rnd() * 3, 0, 0, Math.PI * 2); g.fill(); }
    // lane separators
    g.strokeStyle = 'rgba(150,90,30,.35)'; g.setLineDash([10, 12]); g.lineWidth = 3;
    for (let l = 1; l < LANES; l++) { g.beginPath(); g.moveTo(l * LW, FY); g.lineTo(l * LW, WY); g.stroke(); }
    g.setLineDash([]);
    // edge decor: cacti and rocks
    const cactus = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#4f9a3a'; g.strokeStyle = '#2b5a1e'; g.lineWidth = 3;
      rr(g, -7, -36, 14, 40, 7); g.fill(); g.stroke(); rr(g, -22, -24, 10, 18, 5); g.fill(); g.stroke(); rr(g, 12, -30, 10, 16, 5); g.fill(); g.stroke();
      g.fillStyle = '#ff7aa8'; g.beginPath(); g.arc(0, -37, 4, 0, Math.PI * 2); g.fill(); g.restore();
    };
    const rock = (x, y, s) => { g.fillStyle = '#a8876a'; g.strokeStyle = '#6a4e36'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y, 16 * s, 10 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(x - 5 * s, y - 3 * s, 6 * s, 3 * s, 0, 0, Math.PI * 2); g.fill(); };
    g.globalAlpha = 0.55;
    cactus(16, FY + 60, 0.55); cactus(W - 14, FY + 250, 0.5); cactus(12, FY + 420, 0.45); rock(W - 18, FY + 90, 0.6); rock(20, FY + 230, 0.55); rock(W - 22, FY + 470, 0.7);
    g.globalAlpha = 1;
    // tray area: packed earth outpost floor
    const tg = g.createLinearGradient(0, WY + WH, 0, H); tg.addColorStop(0, '#b4773d'); tg.addColorStop(1, '#8a5428');
    g.fillStyle = tg; g.fillRect(0, WY + WH, W, H - WY - WH);
    // HUD panel
    const hg = g.createLinearGradient(0, 0, 0, FY); hg.addColorStop(0, '#8a4f22'); hg.addColorStop(1, '#6c3a15');
    g.fillStyle = hg; g.fillRect(0, 0, W, FY);
    g.fillStyle = '#4a250b'; g.fillRect(0, FY - 5, W, 5);
    // slots
    for (let i = 0; i < G.SLOTS; i++) {
      const { x, y } = slotXY(i);
      g.fillStyle = 'rgba(60,30,8,.35)'; rr(g, x - 46, y - 45, 92, 90, 16); g.fill();
      g.strokeStyle = 'rgba(255,220,160,.25)'; g.lineWidth = 2; rr(g, x - 46, y - 45, 92, 90, 16); g.stroke();
    }
    // bottom bar
    g.fillStyle = '#5b3010'; g.fillRect(0, BY - 2, W, H - BY + 2);
  }

  // ---------- buttons ----------
  const buttons = [];
  function btnRects() {
    buttons.length = 0;
    buttons.push({ id: 'guide', x: W - 52, y: 10, w: 42, h: 42 });
    buttons.push({ id: 'mute', x: 6, y: BY + 14, w: 50, h: 50 });
    buttons.push({ id: 'help', x: W - 56, y: BY + 14, w: 50, h: 50 });
    const iw = 84, gap = 6, start = W / 2 - (iw * 4 + gap * 3) / 2;
    itemKeys.forEach((k, i) => buttons.push({ id: 'item:' + k, x: start + i * (iw + gap), y: BY + 6, w: iw, h: BH - 12 }));
    if (S && !S.over && !G.hasLegalMove(S)) buttons.push({ id: 'pass', x: W / 2 - 110, y: TY + SH - 28, w: 220, h: 56 });
  }

  function drawItemIcon(g, k, x, y) {
    g.save(); g.translate(x, y); g.lineWidth = 2.5; g.strokeStyle = '#2a1405';
    if (k === 'spray') { g.fillStyle = '#4ac0e0'; rr(g, -10, -12, 20, 30, 5); g.fill(); g.stroke(); g.fillStyle = '#ddd'; rr(g, -6, -20, 12, 9, 2); g.fill(); g.stroke(); g.fillStyle = 'rgba(200,255,200,.8)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(12 + i * 5, -20 - i * 3, 3, 0, 7); g.fill(); } }
    else if (k === 'fire') { g.fillStyle = '#ff6a2a'; g.beginPath(); g.moveTo(0, -22); g.quadraticCurveTo(18, -2, 10, 16); g.quadraticCurveTo(0, 22, -10, 16); g.quadraticCurveTo(-18, -2, 0, -22); g.fill(); g.stroke(); g.fillStyle = '#ffe14a'; g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(8, 6, 4, 14); g.lineTo(-4, 14); g.quadraticCurveTo(-8, 6, 0, -6); g.fill(); }
    else if (k === 'super') { g.fillStyle = '#ffd23a'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(Math.cos(a + 0.39) * 12, Math.sin(a + 0.39) * 12); } g.closePath(); g.fill(); g.stroke(); text(g, 'x2', 0, 1, 13, '#7a3a00', null); }
    else if (k === 'bomb') { g.fillStyle = '#333a48'; g.beginPath(); g.arc(0, 4, 16, 0, 7); g.fill(); g.stroke(); g.strokeStyle = '#8a6a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(8, -9); g.quadraticCurveTo(14, -20, 20, -18); g.stroke(); g.fillStyle = '#ffcf3a'; g.beginPath(); g.arc(20, -18, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(-5, -2, 5, 0, 7); g.fill(); }
    g.restore();
  }

  // ---------- main draw ----------
  let lastT = now();
  function frame() {
    const t = now(), dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    update(dt, t);
    draw(t);
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
      if ((t - p.t0) / p.dur >= 1) { p.done = true; p.onHit(); }
    }
    projectiles = projectiles.filter((p) => !p.done);
    shake *= Math.pow(0.02, dt);
  }

  function draw(t) {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    if (!bgCanvas) buildBg();
    ctx.save();
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    const ts = t / 1000;

    // bomb targeting grid
    if (mode && mode.item === 'bomb') { ctx.fillStyle = 'rgba(255,90,40,.12)'; ctx.fillRect(0, FY, W, WY - FY); }

    // bubbles
    for (const b of bubVis.values()) {
      if (t < b.appear) continue;
      const x = b.lane * LW + LW / 2, y = rowY(b.row) + Math.sin(ts * 3 + b.seed) * 6;
      const pulse = 1 + Math.sin(ts * 5 + b.seed) * 0.04, r = 36 * pulse;
      ctx.save(); ctx.globalAlpha = b.ttl <= 1 ? 0.55 + 0.4 * Math.abs(Math.sin(ts * 6)) : 0.95;
      const gr = ctx.createRadialGradient(x - 10, y - 12, 4, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.5, 'rgba(160,225,255,.55)'); gr.addColorStop(1, 'rgba(90,170,255,.75)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      drawCannon(ctx, x, y + 4, b.value, 0.55);
      ctx.restore();
    }

    // enemies
    const list = [...vis.values()].sort((a, b) => a.dRow - b.dRow);
    for (const v of list) {
      if (t < v.appear) continue;
      const x = ex(v);
      let y = rowY(v.dRow);
      if (v.bump && t - v.bump < 250) y += Math.sin((t - v.bump) / 250 * Math.PI) * 14;
      const s = v.type === 'giant' ? 40 : v.type === 'queen' ? 36 : v.type === 'hatchling' ? 19 : 25;
      const pop = Math.min(1, (t - v.appear) / 200);
      ctx.save();
      if (mode && mode.item === 'fire') { ctx.fillStyle = 'rgba(255,60,40,.18)'; rr(ctx, v.lane * LW + 4, rowY(v.dRow) - CH / 2 + 4, v.w * LW - 8, CH - 8, 14); ctx.fill(); }
      ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y);
      drawBug(ctx, x, y - 4, s, v.type, ts + v.seed);
      if (t - v.hitT < 120) { ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'lighter'; drawBug(ctx, x, y - 4, s, v.type, ts + v.seed); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      // HP bar
      const bw = v.w === 2 ? 150 : 80, bx = x - bw / 2, by = rowY(v.dRow) + CH / 2 - 18, frac = Math.max(0, v.hp / v.maxHp);
      ctx.fillStyle = 'rgba(40,15,5,.75)'; rr(ctx, bx - 2, by - 2, bw + 4, 16, 7); ctx.fill();
      ctx.fillStyle = frac > 0.5 ? '#6ad13a' : frac > 0.25 ? '#ffc531' : '#ff4a3a'; rr(ctx, bx, by, Math.max(4, bw * frac), 12, 6); ctx.fill();
      text(ctx, String(Math.max(0, Math.ceil(v.hp))), x, by + 6, 13, '#fff', '#2a0e00');
      ctx.restore();
    }

    // walls
    G.WALL_SPANS.forEach((span, wi) => {
      const x0 = span[0] * LW + (wi === 0 ? 4 : 3), w = (span[1] - span[0]) * LW - 7, Wl = S.walls[wi], flash = t - wallFlash[wi] < 180;
      if (Wl.hp > 0) {
        ctx.fillStyle = flash ? '#fff0d0' : '#b9a48a'; ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 3;
        rr(ctx, x0, WY + 4, w, WH - 8, 8); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(90,70,48,.6)'; ctx.lineWidth = 2;
        for (let r = 0; r < 2; r++) for (let bx = x0 + (r ? 20 : 0); bx < x0 + w; bx += 40) { ctx.strokeRect(bx, WY + 6 + r * 17, 40, 17); }
        // crenellations
        ctx.fillStyle = flash ? '#fff0d0' : '#c9b498';
        for (let bx = x0 + 6; bx < x0 + w - 20; bx += 34) { rr(ctx, bx, WY - 4, 20, 12, 3); ctx.fill(); ctx.strokeStyle = '#5a4630'; ctx.stroke(); }
        const frac = Wl.hp / Wl.max, bw = w - 30, bx = x0 + 15, by = WY + WH / 2 - 7;
        ctx.fillStyle = 'rgba(30,10,0,.7)'; rr(ctx, bx - 2, by - 2, bw + 4, 18, 8); ctx.fill();
        ctx.fillStyle = frac > 0.5 ? '#4fd14a' : frac > 0.25 ? '#ffc531' : '#ff4a3a'; rr(ctx, bx, by, Math.max(6, bw * frac), 14, 7); ctx.fill();
        text(ctx, `${Math.ceil(Wl.hp)}/${Wl.max}`, bx + bw / 2, by + 7, 13, '#fff', '#2a0e00');
      } else {
        ctx.fillStyle = '#8a7a66';
        for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(x0 + 12 + i * (w - 24) / 8, WY + WH / 2 + ((i * 7) % 11) - 4, 12, 8, i, 0, 7); ctx.fill(); }
        text(ctx, 'BROKEN', x0 + w / 2, WY + WH / 2, 16, '#ffcfbf', '#3a0a00');
      }
    });

    // tray cannons
    for (let i = 0; i < G.SLOTS; i++) {
      const v = S.tray[i]; if (!v) continue;
      if (drag && drag.from === i && drag.moved) continue;
      const { x, y } = slotXY(i);
      let sc = 1; const fx = slotFx[i];
      if (fx) { const k = (t - fx.t) / 300; if (k < 1) sc = fx.kind === 'merge' ? 1 + Math.sin(k * Math.PI) * 0.3 : fx.kind === 'new' ? 0.3 + 0.7 * Math.min(1, k * 1.4) + Math.sin(k * Math.PI) * 0.1 : 1; }
      const isSel = (drag && drag.from === i) || tapSel === i;
      if (mode && mode.item === 'super' && v <= 32) { ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 4; rr(ctx, x - 45, y - 44, 90, 88, 14); ctx.stroke(); }
      if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; rr(ctx, x - 45, y - 44, 90, 88, 14); ctx.stroke(); }
      drawCannon(ctx, x, y + 4, v, sc);
    }
    // drop hints while dragging
    if (drag && drag.moved) {
      const v = S.tray[drag.from];
      for (let i = 0; i < G.SLOTS; i++) {
        if (i === drag.from) continue;
        const ok = !S.tray[i] || S.tray[i] === v; if (!ok) continue;
        const { x, y } = slotXY(i);
        ctx.strokeStyle = S.tray[i] ? '#ffe14a' : 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        rr(ctx, x - 45, y - 44, 90, 88, 14); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // projectiles (glowing orbs)
    for (const p of projectiles) {
      if (t < p.t0) continue;
      const k = Math.min(1, (t - p.t0) / p.dur);
      const v = p.targetId ? vis.get(p.targetId) : null;
      const y1 = v ? rowY(v.dRow) : (p.y1 ?? FY - 20);
      const x1 = p.x0;
      const x = p.x0 + (x1 - p.x0) * k, y = p.y0 + (y1 - p.y0) * k;
      const gr = ctx.createRadialGradient(x, y, 1, x, y, p.r * 2.2);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, p.color); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, p.r * 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = p.color; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x, y + 18, p.r * 0.8, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    // particles
    for (const p of particles) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - p.t / p.life * 0.5), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    // floaters
    for (const f of floaters) { const k = f.t / f.life; ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; text(ctx, f.text, f.x, f.y - k * 40, f.size * (k < 0.15 ? 0.7 + k * 2 : 1), f.color, '#3a0a00'); }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawHud(t);
    drawBottom();

    // dragged cannon
    if (drag && drag.moved) drawCannon(ctx, drag.x, drag.y - 20, S.tray[drag.from], 1.12, 0.92);

    // pass button
    btnRects();
    const pb = buttons.find((b) => b.id === 'pass');
    if (pb && !busy) {
      ctx.fillStyle = 'rgba(20,10,0,.55)'; ctx.fillRect(0, TY - 4, W, SH * 2 + 4);
      ctx.fillStyle = '#e07a2a'; ctx.strokeStyle = '#6a2a00'; ctx.lineWidth = 4; rr(ctx, pb.x, pb.y, pb.w, pb.h, 16); ctx.fill(); ctx.stroke();
      text(ctx, 'No moves: Pass turn', W / 2, pb.y + pb.h / 2, 20);
    }

    // toast
    if (toast && t < toast.until) {
      const k = (t - toast.start) / 200, a = Math.min(1, k, (toast.until - t) / 300);
      ctx.globalAlpha = a; ctx.font = 'bold 18px "Trebuchet MS", Verdana, sans-serif';
      const tw = Math.min(W - 20, ctx.measureText(toast.text).width + 36);
      ctx.fillStyle = 'rgba(40,18,4,.85)'; rr(ctx, W / 2 - tw / 2, FY + 12, tw, 40, 20); ctx.fill();
      text(ctx, toast.text, W / 2, FY + 32, tw >= W - 20 ? 15 : 18, toast.color, null);
      ctx.globalAlpha = 1;
    }
  }

  function drawHud() {
    // Level badge
    ctx.fillStyle = '#ffcf5a'; ctx.strokeStyle = '#4a250b'; ctx.lineWidth = 4;
    rr(ctx, 8, 8, 112, 46, 14); ctx.fill(); ctx.stroke();
    text(ctx, 'DEFENSE LV', 64, 21, 12, '#6a2a00', null);
    text(ctx, String(S.level), 64, 41, 22, '#fff', '#6a2a00');
    // kill progress
    const px = 130, pw = W - 130 - 62, frac = S.kills / G.KILLS_PER_LEVEL;
    ctx.fillStyle = 'rgba(30,10,0,.6)'; rr(ctx, px, 14, pw, 34, 17); ctx.fill();
    ctx.fillStyle = '#e8622a'; rr(ctx, px + 3, 17, Math.max(28, (pw - 6) * frac), 28, 14); ctx.fill();
    text(ctx, `Bugs slain ${S.kills}/${G.KILLS_PER_LEVEL}`, px + pw / 2, 31, 16);
    // guide button
    const gb = buttons.find((b) => b.id === 'guide') || { x: W - 52, y: 10, w: 42, h: 42 };
    ctx.fillStyle = '#e0a05a'; ctx.strokeStyle = '#4a250b'; ctx.lineWidth = 3; rr(ctx, gb.x, gb.y, gb.w, gb.h, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a2a12'; rr(ctx, gb.x + 9, gb.y + 9, 24, 24, 3); ctx.fill(); ctx.fillStyle = '#fff3d8'; ctx.fillRect(gb.x + 13, gb.y + 12, 16, 18);
    ctx.strokeStyle = '#7a2a12'; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(gb.x + 15, gb.y + 17 + i * 5); ctx.lineTo(gb.x + 27, gb.y + 17 + i * 5); ctx.stroke(); }
    // score row
    const cols = [['ROUND', S.score.toLocaleString()], ['BEST', Math.max(best, S.score).toLocaleString()], ['BONUS', '+' + G.bonusPct(S.level) + '%']];
    const cw = (W - 16) / 3;
    cols.forEach(([l, v], i) => {
      const x = 8 + i * cw;
      ctx.fillStyle = 'rgba(30,10,0,.45)'; rr(ctx, x + 2, 60, cw - 4, 42, 12); ctx.fill();
      text(ctx, l, x + cw / 2, 71, 11, '#ffcf8a', null);
      text(ctx, v, x + cw / 2, 89, 19, i === 2 ? '#9cf08a' : '#fff');
    });
  }

  function drawBottom() {
    for (const b of buttons) {
      if (b.id.startsWith('item:')) {
        const k = b.id.slice(5), n = S.items[k], active = mode && mode.item === k;
        ctx.fillStyle = active ? '#ffe9a8' : n ? '#e9c28a' : '#9a7a5a'; ctx.strokeStyle = active ? '#fff' : '#3a1a05'; ctx.lineWidth = active ? 4 : 3;
        rr(ctx, b.x, b.y, b.w, b.h, 14); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = n ? 1 : 0.45; drawItemIcon(ctx, k, b.x + b.w / 2, b.y + 26); ctx.globalAlpha = 1;
        text(ctx, G.ITEM_INFO[k].name.split(' ').pop(), b.x + b.w / 2, b.y + b.h - 11, 12, '#4a1a00', null);
        ctx.fillStyle = n ? '#d62a1a' : '#666'; ctx.beginPath(); ctx.arc(b.x + b.w - 8, b.y + 8, 12, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        text(ctx, String(n), b.x + b.w - 8, b.y + 9, 13, '#fff', null);
      } else if (b.id === 'mute' || b.id === 'help') {
        ctx.fillStyle = '#e0a05a'; ctx.strokeStyle = '#3a1a05'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (b.id === 'help') text(ctx, '?', cx, cy + 1, 28, '#fff', '#5a2a00');
        else {
          ctx.fillStyle = '#4a1a00'; ctx.beginPath(); ctx.moveTo(cx - 12, cy - 5); ctx.lineTo(cx - 5, cy - 5); ctx.lineTo(cx + 3, cy - 12); ctx.lineTo(cx + 3, cy + 12); ctx.lineTo(cx - 5, cy + 5); ctx.lineTo(cx - 12, cy + 5); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#4a1a00'; ctx.lineWidth = 2.5;
          if (muted) { ctx.beginPath(); ctx.moveTo(cx + 7, cy - 7); ctx.lineTo(cx + 16, cy + 7); ctx.moveTo(cx + 16, cy - 7); ctx.lineTo(cx + 7, cy + 7); ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(cx + 4, cy, 7, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 4, cy, 13, -0.9, 0.9); ctx.stroke(); }
        }
      }
    }
  }

  // ---------- input ----------
  function toScreen(x, y) { const r = cv.getBoundingClientRect(); return { x: r.left + x / W * r.width, y: r.top + y / H * r.height }; }
  function toLogical(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
  function slotAt(x, y) {
    for (let i = 0; i < G.SLOTS; i++) { const s = slotXY(i); if (Math.abs(x - s.x) <= LW / 2 && Math.abs(y - s.y) <= SH / 2) return i; }
    return -1;
  }
  const hitBtn = (x, y) => buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  function fieldCell(x, y) { if (y < FY || y >= WY) return null; return { row: Math.floor((y - FY) / CH), lane: Math.min(LANES - 1, Math.floor(x / LW)) }; }

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); audio();
    if (dialogOpen() || !S) return;
    const { x, y } = toLogical(e);
    const b = hitBtn(x, y);
    if (b) {
      if (b.id === 'mute') { muted = !muted; LS.set('muted', muted); if (!muted) sfx.pop(); }
      else if (b.id === 'help') howTo();
      else if (b.id === 'guide') guide();
      else if (b.id === 'pass') doMove({ type: 'pass' });
      else if (b.id.startsWith('item:')) tryItem(b.id.slice(5));
      return;
    }
    if (busy || S.over) return;
    // targeting modes
    if (mode) {
      const c = fieldCell(x, y);
      if (mode.item === 'fire' && c) { const en = S.enemies.find((en) => en.row === c.row && c.lane >= en.lane && c.lane < en.lane + en.w); if (en) applyTargetItem(en.id); else showToast('Tap a bug', 900); return; }
      if (mode.item === 'bomb' && c) { applyTargetItem(c); return; }
      if (mode.item === 'super') { const s = slotAt(x, y); if (s >= 0) { applyTargetItem(s); return; } }
      mode = null; showToast('Cancelled', 700); return;
    }
    // bubbles (free)
    for (const bb of bubVis.values()) {
      const bx = bb.lane * LW + LW / 2, by = rowY(bb.row);
      if (Math.hypot(x - bx, y - by) < 46) {
        const r = G.collectBubble(S, bb.id);
        if (!r.ok) { sfx.bad(); showToast(r.msg, 1200, '#ffd0c0'); return; }
        bb.collected = true; puff(bx, by, '#bfe8ff', 14); generalFx(r.events); sync(0, true); return;
      }
    }
    const s = slotAt(x, y);
    if (s >= 0 && S.tray[s]) { drag = { from: s, x, y, sx: x, sy: y, moved: false, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
    else if (s >= 0 && drag === null && tapSel >= 0) { const from = tapSel; tapSel = -1; doMove({ type: 'move', from, to: s }); }
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
      else { tapSel = tapSel === d.from ? -1 : d.from; if (tapSel >= 0) showToast('Now tap a slot to move or merge', 1200); }
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
    scale = Math.min(vw / W, vh / H);
    cv.style.width = Math.round(W * scale) + 'px'; cv.style.height = Math.round(H * scale) + 'px';
    cv.width = Math.round(W * scale * dpr); cv.height = Math.round(H * scale * dpr);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  resize();
  newRun();
  btnRects();
  requestAnimationFrame(frame);
  if (!LS.get('seenHelp', false)) howTo();
})();
