/* Sandline Siege - original canvas art: tiered cannons, scorpions, props. Exposes window.SandArt */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function text(g, s, x, y, size, color = '#fff', stroke = '#2a1505', align = 'center', weight = 'bold', font = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif') {
    g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(3, size / 4.5); g.strokeStyle = stroke; g.strokeText(s, x, y); }
    g.fillStyle = color; g.fillText(s, x, y);
  }
  function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
  function rad(g, x, y, r0, r1, stops) { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
  function plaque(g, cx, cy, w, h, fill, edge, edgeW = 1.5) {
    const x0 = cx - w / 2, x1 = cx + w / 2, a = h / 2;
    g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + a, cy - a); g.lineTo(x1 - a, cy - a); g.lineTo(x1, cy); g.lineTo(x1 - a, cy + a); g.lineTo(x0 + a, cy + a); g.closePath();
    g.fillStyle = fill; g.fill(); if (edge) { g.strokeStyle = edge; g.lineWidth = edgeW; g.stroke(); }
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n)));

  // ================= RASTER SPRITES (assets/*.webp) with procedural fallback =================
  const ASSET_V = 7;
  const ASSETS = [...Array.from({ length: 12 }, (_, i) => 'cannon' + String(i + 1).padStart(2, '0')),
    'crawler', 'giant', 'queen', 'hatchling', 'eggs', 'orb', 'item_spray', 'item_fire', 'item_super', 'barricade', 'barricade_broken', 'bg', 'tile'];
  const IMG = {};
  const has = (k) => !!(IMG[k] && IMG[k].naturalWidth);
  function loadAssets(onProgress) {
    return new Promise((resolve) => {
      let done = 0; const n = ASSETS.length, failed = [];
      const fin = () => { done++; if (onProgress) onProgress(done / n); if (done === n) resolve(failed); };
      for (const k of ASSETS) {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { IMG[k] = im; fin(); };
        im.onerror = () => { failed.push(k); fin(); };
        im.src = `assets/${k}.webp?v=${ASSET_V}`;
      }
      setTimeout(() => resolve(failed), 20000); // never block the game on a slow network
    });
  }
  // draw a sprite fitted into a w x h box, bottom-centred at (x, yb)
  function fitImg(g, im, x, yb, w, h) {
    const k = Math.min(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
    g.drawImage(im, x - dw / 2, yb - dh, dw, dh); return { dw, dh };
  }

  // ================= CANNON TIERS (one design per merge level) =================
  const TIERS = [
    { name: 'Driftwood Stub',  main: '#a8743e', dark: '#5e3a1a', light: '#e0b070', glow: '#ffd08a' },
    { name: 'Iron Pot',        main: '#6c7380', dark: '#2e3239', light: '#b8c0cc', glow: '#d8e2f0' },
    { name: 'Steel Longgun',   main: '#4f86c8', dark: '#1d3d68', light: '#a8d0fa', glow: '#6fb4ff' },
    { name: 'Bronze Bell',     main: '#c38b3a', dark: '#6a4410', light: '#f6d690', glow: '#ffcf6a' },
    { name: 'Teal Spiker',     main: '#26b0a2', dark: '#0e5a52', light: '#90f2e4', glow: '#5ff0d8' },
    { name: 'Twin Amethyst',   main: '#9a5ae0', dark: '#45207f', light: '#d6b0ff', glow: '#b67cff' },
    { name: 'Violet Mortar',   main: '#7436c8', dark: '#320e66', light: '#c8a0ff', glow: '#c08aff', gem: '#ff5ad0' },
    { name: 'Copper Drake',    main: '#d9783a', dark: '#7e3610', light: '#ffc590', glow: '#ff9a4a', gem: '#ffb020' },
    { name: 'Copper Gatling',  main: '#c4602a', dark: '#5e2406', light: '#ffb07a', glow: '#ff7a3a', gem: '#ffe060' },
    { name: 'Glass Crystal',   main: '#7fe0ff', dark: '#2a7fa8', light: '#f0fdff', glow: '#9ff0ff', gem: '#ffffff' },
    { name: 'Royal Gold',      main: '#f0c03a', dark: '#94640c', light: '#fff4b8', glow: '#ffe066', gem: '#e8203a' },
    { name: 'Sunburst',        main: '#fff4dc', dark: '#c49a40', light: '#ffffff', glow: '#fff09a', gem: '#4ac8ff' },
  ];
  const tierIdx = (v) => Math.max(0, Math.min(TIERS.length - 1, Math.round(Math.log2(Math.max(1, v)))));
  const tierOf = (v) => TIERS[tierIdx(v)];

  const OUT = '#20120a';
  function cyl(g, x, yTop, yBot, w, T, wTop) { // vertical barrel with metallic shading
    wTop = wTop || w;
    g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, T.dark], [0.28, T.main], [0.48, T.light], [0.7, T.main], [1, T.dark]]);
    g.beginPath(); g.moveTo(x - w, yBot); g.lineTo(x - wTop, yTop); g.lineTo(x + wTop, yTop); g.lineTo(x + w, yBot); g.closePath(); g.fill();
    g.strokeStyle = OUT; g.lineWidth = 2.2; g.stroke();
  }
  function rim(g, x, y, w, T, h = 6, inner = true) {
    g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, T.dark], [0.5, T.light], [1, T.dark]]);
    g.beginPath(); g.ellipse(x, y, w, h, 0, 0, TAU); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
    if (inner) { g.fillStyle = '#120a06'; g.beginPath(); g.ellipse(x, y, w * 0.68, h * 0.6, 0, 0, TAU); g.fill(); }
  }
  function band(g, x, y, w, h, c1 = '#2a2a30', c2 = '#7a7a88') {
    g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, c1], [0.5, c2], [1, c1]]); rr(g, x - w, y - h / 2, w * 2, h, 2.5); g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.6; g.stroke();
  }
  function rivets(g, x0, x1, y, n, c = '#d8d8e0') { for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (i + 0.5) / n; g.fillStyle = c; g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 0.6, y + 0.6, 1, 0, TAU); g.fill(); } }
  function gem(g, x, y, r, c) {
    g.fillStyle = rad(g, x - r * 0.3, y - r * 0.3, 0.5, r * 1.2, [[0, '#ffffff'], [0.35, c], [1, shade(c, -0.45)]]);
    g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill();
    g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
  }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }
  function spikes(g, T, wide = 1) {
    g.fillStyle = lin(g, 0, -10, 0, 22, [[0, T.main], [1, T.dark]]); g.strokeStyle = OUT; g.lineWidth = 1.8;
    for (const sd of [-1, 1]) {
      g.beginPath(); g.moveTo(sd * 16 * wide, 2); g.lineTo(sd * 38 * wide, -8); g.lineTo(sd * 26 * wide, 12); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(sd * 18 * wide, 14); g.lineTo(sd * 36 * wide, 20); g.lineTo(sd * 14 * wide, 22); g.closePath(); g.fill(); g.stroke();
    }
  }
  function metalBase(g, T, w = 26) {
    g.fillStyle = lin(g, -w, 0, w, 0, [[0, '#3a2a1e'], [0.5, '#7a5a3a'], [1, '#2e2016']]);
    g.beginPath(); g.moveTo(-w, 4); g.lineTo(w, 4); g.lineTo(w - 4, 23); g.lineTo(-w + 4, 23); g.closePath(); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
    g.fillStyle = lin(g, 0, 1, 0, 9, [[0, T.light], [1, T.dark]]); rr(g, -w - 2, 1, w * 2 + 4, 7, 3); g.fill(); g.stroke();
    rivets(g, -w + 4, w - 4, 16, 5);
  }

  function drawTurretRaw(g, idx) {
    const T = TIERS[idx];
    g.lineJoin = 'round'; g.lineCap = 'round';
    // glow for higher tiers
    if (idx >= 6) { g.fillStyle = rad(g, 0, -10, 4, 52 + idx * 2, [[0, T.glow + 'aa'], [0.5, T.glow + '44'], [1, T.glow + '00']]); g.beginPath(); g.arc(0, -10, 52 + idx * 2, 0, TAU); g.fill(); }
    // shadow
    g.fillStyle = 'rgba(80,40,0,.32)'; g.beginPath(); g.ellipse(0, 23, 34, 8, 0, 0, TAU); g.fill();
    switch (idx) {
      case 0: { // Driftwood stub: plank crate + short wooden barrel with rope
        g.fillStyle = lin(g, -24, 4, 24, 24, [[0, '#b07a44'], [1, '#6a4422']]); rr(g, -24, 4, 48, 20, 3); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        g.strokeStyle = 'rgba(40,20,5,.6)'; g.lineWidth = 1.2; for (const y of [10, 17]) { g.beginPath(); g.moveTo(-23, y); g.lineTo(23, y); g.stroke(); }
        rivets(g, -20, 20, 7, 2, '#9a9a9a');
        cyl(g, 0, -16, 6, 17, T, 15);
        g.strokeStyle = 'rgba(60,30,10,.55)'; g.lineWidth = 1; for (let i = -10; i <= 10; i += 5) { g.beginPath(); g.moveTo(i, -14); g.lineTo(i * 1.1, 4); g.stroke(); }
        band(g, 0, -5, 17, 5, '#a08850', '#ead6a0'); band(g, 0, 2, 17.5, 4, '#a08850', '#ead6a0');
        rim(g, 0, -16, 16, T, 5); break;
      }
      case 1: { // Iron pot: round stone plinth + stubby iron pot
        g.fillStyle = lin(g, 0, 2, 0, 24, [[0, '#a89a88'], [1, '#5e5448']]); g.beginPath(); g.ellipse(0, 14, 28, 11, 0, 0, TAU); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        g.strokeStyle = 'rgba(40,30,20,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-14, 8); g.lineTo(-10, 22); g.moveTo(10, 6); g.lineTo(14, 22); g.stroke();
        cyl(g, 0, -22, 8, 20, T, 17); band(g, 0, -12, 20, 5); band(g, 0, 0, 21, 5);
        rim(g, 0, -22, 19, T, 6); break;
      }
      case 2: { // Steel longgun: riveted stone base, long slim barrel
        g.fillStyle = lin(g, 0, 2, 0, 24, [[0, '#9a8e7a'], [1, '#544a3c']]); rr(g, -26, 4, 52, 20, 5); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        band(g, 0, 8, 26, 5, '#30343c', '#8a92a0'); rivets(g, -22, 22, 18, 6);
        cyl(g, 0, -44, 6, 13, T, 11); band(g, 0, -30, 13, 4); band(g, 0, -12, 14, 5);
        rim(g, 0, -44, 13, T, 4.5); break;
      }
      case 3: { // Bronze bell: brass plinth with bolts, flared bell muzzle
        g.fillStyle = lin(g, -28, 0, 28, 0, [[0, '#7a5010'], [0.5, '#e8c070'], [1, '#6a4408']]); g.beginPath(); g.moveTo(-28, 22); g.lineTo(-22, 4); g.lineTo(22, 4); g.lineTo(28, 22); g.closePath(); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        rivets(g, -22, 22, 14, 4, '#fff0c0');
        cyl(g, 0, -26, 6, 15, T, 12);
        g.fillStyle = lin(g, -22, 0, 22, 0, [[0, T.dark], [0.5, T.light], [1, T.dark]]);
        g.beginPath(); g.moveTo(-12, -24); g.quadraticCurveTo(-14, -36, -22, -42); g.lineTo(22, -42); g.quadraticCurveTo(14, -36, 12, -24); g.closePath(); g.fill(); g.stroke();
        band(g, 0, -10, 15, 5, '#6a4410', '#f2d080');
        rim(g, 0, -42, 22, T, 6.5); break;
      }
      case 4: { // Teal spiker: spiked base, top-hat barrel with iron wrap
        spikes(g, T); metalBase(g, T);
        cyl(g, 0, -40, 5, 19, T, 20); band(g, 0, -20, 21, 11); 
        g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let i = -16; i <= 16; i += 5) { g.beginPath(); g.moveTo(i, -25); g.lineTo(i + 3, -15); g.stroke(); }
        rim(g, 0, -40, 23, T, 7); break;
      }
      case 5: { // Twin amethyst: two barrels
        spikes(g, T); metalBase(g, T, 28);
        for (const x of [-12, 12]) { cyl(g, x, -42, 5, 11, T, 10); band(g, x, -24, 11.5, 6); rim(g, x, -42, 12, T, 4.5); }
        band(g, 0, -10, 26, 6, '#2a1a3a', '#8a6ab0'); break;
      }
      case 6: { // Violet mortar: wide stubby mortar with gem
        spikes(g, T, 1.1); metalBase(g, T, 29);
        cyl(g, 0, -28, 6, 25, T, 27);
        band(g, 0, -12, 26, 7, '#24103e', '#9a70d0');
        rim(g, 0, -28, 29, T, 8.5);
        gem(g, 0, -2, 6, T.gem); break;
      }
      case 7: { // Copper drake: fins/wings + gem
        for (const sd of [-1, 1]) { g.fillStyle = lin(g, 0, -40, 0, 0, [[0, T.light], [1, T.dark]]); g.strokeStyle = OUT; g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(sd * 14, -30); g.quadraticCurveTo(sd * 40, -44, sd * 42, -20); g.lineTo(sd * 34, -22); g.lineTo(sd * 36, -10); g.lineTo(sd * 28, -12); g.lineTo(sd * 26, -2); g.lineTo(sd * 14, -6); g.closePath(); g.fill(); g.stroke(); }
        spikes(g, T); metalBase(g, T);
        cyl(g, 0, -46, 5, 17, T, 15); band(g, 0, -32, 16, 5, '#4a1a06', '#e0904a'); band(g, 0, -14, 18, 6, '#4a1a06', '#e0904a');
        rim(g, 0, -46, 18, T, 6); gem(g, 0, -23, 5.5, T.gem); break;
      }
      case 8: { // Copper gatling: 3 barrels + drum
        spikes(g, T, 1.05); metalBase(g, T, 28);
        g.fillStyle = lin(g, -24, 0, 24, 0, [[0, '#2a1a10'], [0.5, '#8a5a3a'], [1, '#2a1a10']]); rr(g, -22, -16, 44, 20, 6); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        for (const x of [-12, 0, 12]) { cyl(g, x, -48, -14, 6.5, T, 6); rim(g, x, -48, 7, T, 3); }
        band(g, 0, -34, 20, 5, '#3a1a08', '#ffb070'); gem(g, 0, -6, 5, T.gem); rivets(g, -18, 18, -12, 4); break;
      }
      case 9: { // Glass crystal: shard base, translucent faceted barrel with inner glow
        for (const [x, h, a] of [[-24, 22, -0.4], [-12, 30, -0.15], [14, 28, 0.2], [25, 18, 0.45], [2, 20, 0]]) {
          g.save(); g.translate(x, 20); g.rotate(a); g.fillStyle = lin(g, -6, -h, 6, 0, [[0, '#f4feff'], [0.5, T.main], [1, T.dark]]);
          g.beginPath(); g.moveTo(-7, 0); g.lineTo(-5, -h * 0.7); g.lineTo(0, -h); g.lineTo(5, -h * 0.7); g.lineTo(7, 0); g.closePath(); g.fill(); g.strokeStyle = '#1a4a60'; g.lineWidth = 1.5; g.stroke(); g.restore(); }
        g.globalAlpha = 0.9;
        g.fillStyle = lin(g, -18, 0, 18, 0, [[0, 'rgba(60,150,200,.9)'], [0.3, 'rgba(160,235,255,.85)'], [0.5, 'rgba(255,255,255,.95)'], [0.75, 'rgba(120,210,245,.85)'], [1, 'rgba(40,120,170,.9)']]);
        g.beginPath(); g.moveTo(-17, 6); g.lineTo(-19, -40); g.lineTo(-9, -48); g.lineTo(9, -48); g.lineTo(19, -40); g.lineTo(17, 6); g.closePath(); g.fill(); g.strokeStyle = '#1a4a60'; g.lineWidth = 2; g.stroke();
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-9, -48); g.lineTo(-6, 4); g.moveTo(9, -48); g.lineTo(6, 4); g.moveTo(-19, -40); g.lineTo(19, -40); g.stroke();
        g.fillStyle = rad(g, 0, -20, 1, 16, [[0, '#ffffff'], [1, 'rgba(160,240,255,0)']]); g.beginPath(); g.arc(0, -20, 16, 0, TAU); g.fill();
        g.fillStyle = '#0e3a50'; g.beginPath(); g.ellipse(0, -44, 9, 3.5, 0, 0, TAU); g.fill();
        break;
      }
      case 10: { // Royal gold: ornate pedestal, filigree, ruby
        g.fillStyle = lin(g, -30, 0, 30, 0, [[0, '#7a5008'], [0.5, '#ffe8a0'], [1, '#6a4404']]);
        g.beginPath(); g.moveTo(-30, 22); g.quadraticCurveTo(-30, 8, -20, 6); g.lineTo(20, 6); g.quadraticCurveTo(30, 8, 30, 22); g.closePath(); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        g.strokeStyle = '#7a5008'; g.lineWidth = 1.4; for (const sd of [-1, 1]) { g.beginPath(); g.arc(sd * 16, 15, 5, 0, TAU * 0.8); g.stroke(); }
        cyl(g, 0, -46, 6, 18, T, 16);
        band(g, 0, -30, 17, 6, '#7a5008', '#fff0b0'); band(g, 0, -12, 18.5, 7, '#7a5008', '#fff0b0');
        g.strokeStyle = 'rgba(122,80,8,.8)'; g.lineWidth = 1.2; for (const y of [-38, -22]) { g.beginPath(); for (let x = -14; x <= 14; x += 4) g.lineTo(x, y + (x % 8 ? 2 : -2)); g.stroke(); }
        rim(g, 0, -46, 20, T, 6.5); gem(g, 0, -12, 6, T.gem); gem(g, 0, 15, 4, '#2a8ae8'); break;
      }
      default: { // Sunburst: winged white-gold with halo and sapphire
        g.save(); for (let i = 0; i < 12; i++) { g.rotate(TAU / 12); g.fillStyle = 'rgba(255,240,150,.55)'; g.beginPath(); g.moveTo(-3, -30); g.lineTo(0, -58); g.lineTo(3, -30); g.closePath(); g.fill(); } g.restore();
        for (const sd of [-1, 1]) { g.fillStyle = lin(g, sd * 10, -30, sd * 44, 0, [[0, '#ffffff'], [1, '#e8d090']]); g.strokeStyle = '#8a6a20'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(sd * 14, -26); g.quadraticCurveTo(sd * 46, -50, sd * 46, -14); g.quadraticCurveTo(sd * 36, -18, sd * 38, -6); g.quadraticCurveTo(sd * 28, -10, sd * 28, 0); g.lineTo(sd * 14, -4); g.closePath(); g.fill(); g.stroke();
          g.strokeStyle = 'rgba(160,120,40,.6)'; g.lineWidth = 1; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(sd * (18 + k * 6), -12 - k * 6); g.lineTo(sd * (30 + k * 5), -26 - k * 4); g.stroke(); } }
        g.fillStyle = lin(g, -30, 0, 30, 0, [[0, '#a07a20'], [0.5, '#fffbe6'], [1, '#94701a']]);
        g.beginPath(); g.moveTo(-30, 22); g.quadraticCurveTo(-30, 8, -20, 6); g.lineTo(20, 6); g.quadraticCurveTo(30, 8, 30, 22); g.closePath(); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        cyl(g, 0, -48, 6, 19, T, 17);
        band(g, 0, -32, 18, 6, '#a07a20', '#fff6c8'); band(g, 0, -12, 19.5, 7, '#a07a20', '#fff6c8');
        rim(g, 0, -48, 21, T, 7); gem(g, 0, -12, 6.5, T.gem); gem(g, -12, 15, 3.5, '#e8203a'); gem(g, 12, 15, 3.5, '#20c060');
        break;
      }
    }
    // specular sparkle on high tiers
    if (idx >= 9) { g.fillStyle = 'rgba(255,255,255,.9)'; for (const [x, y, r] of [[-8, -34, 2.4], [10, -18, 1.6]]) { g.beginPath(); g.moveTo(x, y - r * 2.5); g.lineTo(x + r * 0.6, y); g.lineTo(x, y + r * 2.5); g.lineTo(x - r * 0.6, y); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x - r * 2.5, y); g.lineTo(x, y + r * 0.6); g.lineTo(x + r * 2.5, y); g.lineTo(x, y - r * 0.6); g.closePath(); g.fill(); } }
  }

  const CW = 130, CHH = 140, OX = 65, OYY = 84, RES = 3;
  const cache = new Map();
  function cannonSprite(idx) {
    if (cache.has(idx)) return cache.get(idx);
    const c = document.createElement('canvas'); c.width = CW * RES; c.height = CHH * RES;
    const g = c.getContext('2d'); g.scale(RES, RES); g.translate(OX, OYY); drawTurretRaw(g, idx);
    cache.set(idx, c); return c;
  }
  function tierGemIcon(g, x, y, r, T) {
    g.fillStyle = lin(g, x, y - r, x, y + r, [[0, T.light], [1, T.main]]); g.strokeStyle = OUT; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y - r * 1.25); g.quadraticCurveTo(x + r * 1.1, y, x, y + r); g.quadraticCurveTo(x - r * 1.1, y, x, y - r * 1.25); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.1, r * 0.2, r * 0.35, 0, 0, TAU); g.fill();
  }
  function valueTag(g, x, y, v, sc = 1, alpha = 1) {
    g.save(); g.globalAlpha = alpha;
    const s = fmt(v), w = (36 + s.length * 12.5) * sc, h = 27 * sc, T = tierOf(v);
    plaque(g, x, y, w, h, 'rgba(26,16,10,.92)', T.glow, 1.6 * sc);
    tierGemIcon(g, x - w / 2 + 10 * sc, y, 8 * sc, T);
    text(g, s, x + 7 * sc, y + 1 * sc, 21 * sc, '#ffffff', '#000000', 'center', '900');
    g.restore();
  }
  function drawCannon(g, x, y, v, sc = 1, alpha = 1, showTag = true, t = 0) {
    const idx = tierIdx(v), key = 'cannon' + String(idx + 1).padStart(2, '0'), raster = has(key);
    g.save(); g.globalAlpha = alpha;
    if (idx >= 10) { // live pulsing aura for the top tiers
      const p = 0.5 + 0.5 * Math.sin(t * 3);
      g.fillStyle = rad(g, x, y - 12 * sc, 4, (58 + p * 10) * sc, [[0, TIERS[idx].glow + '66'], [1, TIERS[idx].glow + '00']]);
      g.beginPath(); g.arc(x, y - 12 * sc, (58 + p * 10) * sc, 0, TAU); g.fill();
    }
    if (raster) {
      g.fillStyle = 'rgba(70,35,5,.28)'; g.beginPath(); g.ellipse(x, y + 24 * sc, 34 * sc, 8 * sc, 0, 0, TAU); g.fill();
      g.imageSmoothingQuality = 'high'; fitImg(g, IMG[key], x, y + 28 * sc, 90 * sc, 88 * sc);
    } else { const spr = cannonSprite(idx); g.drawImage(spr, x - OX * sc, y - OYY * sc, CW * sc, CHH * sc); }
    g.restore();
    if (showTag) valueTag(g, x + 3 * sc, y + 33 * sc, v, sc, alpha);
  }

  // ================= SCORPIONS =================
  const PAL = {
    crawler:   { shell: '#c24a2e', shell2: '#7a2210', hi: '#f08a5a', belly: '#e88a52', claw: '#f6b83a', claw2: '#a85e0a', eye: '#ffeaa0', line: '#3a0e04' },
    hatchling: { shell: '#7c2c24', shell2: '#36100c', hi: '#c0584a', belly: '#b34a36', claw: '#e0703a', claw2: '#6a2208', eye: '#ffd27a', line: '#1e0604' },
    giant:     { shell: '#8e6646', shell2: '#46301c', hi: '#d0a678', belly: '#b88a5e', claw: '#cfa67c', claw2: '#5e3e22', eye: '#ff8a3a', line: '#22140a' },
    queen:     { shell: '#3c3644', shell2: '#141018', hi: '#7a7088', belly: '#c4283a', claw: '#d83c3c', claw2: '#5a0a14', eye: '#ff4a4a', line: '#08060a' },
  };
  const BUG_BOX = { crawler: [96, 92], hatchling: [70, 66], giant: [186, 118], queen: [186, 116] };
  function drawScorpion(g, cx, cy, type, t, sc = 1) {
    if (has(type) && BUG_BOX[type]) {
      const [bw, bh] = BUG_BOX[type], breathe = 1 + Math.sin(t * 2.4) * 0.018, sway = Math.sin(t * 1.7) * 0.025;
      g.save(); g.translate(cx, cy + bh * sc / 2 - 6 * sc);
      g.fillStyle = 'rgba(90,45,5,.25)'; g.beginPath(); g.ellipse(0, -4 * sc, bw * 0.42 * sc, bh * 0.14 * sc, 0, 0, TAU); g.fill();
      g.rotate(sway); g.scale(breathe, 2 - breathe); g.imageSmoothingQuality = 'high';
      fitImg(g, IMG[type], 0, 0, bw * sc, bh * sc);
      g.restore(); return;
    }
    const p = PAL[type];
    const s = (type === 'giant' ? 50 : type === 'queen' ? 46 : type === 'hatchling' ? 26 : 33) * sc;
    const wide = type === 'giant' || type === 'queen';
    g.save(); g.translate(cx, cy); if (wide) g.scale(1.45, 1);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const lw = Math.max(1.4, s * 0.055);
    // ground shadow
    g.fillStyle = 'rgba(110,55,8,.28)'; g.beginPath(); g.ellipse(0, s * 0.64, s * 1.02, s * 0.28, 0, 0, TAU); g.fill();
    // legs: 4 per side, two segments with joints and tips
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const ph = t * 7 + i * 1.6 + (side > 0 ? Math.PI : 0), wig = Math.sin(ph) * s * 0.05, lift = Math.max(0, Math.cos(ph)) * s * 0.04;
      const y0 = -s * 0.24 + i * s * 0.15, kx = side * s * 0.68, ky = y0 - s * 0.16 - lift, fx = side * s * (0.86 + i * 0.02), fy = y0 + s * 0.16 + wig;
      for (const [w, c] of [[lw * 2.8, p.line], [lw * 1.5, p.shell2]]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(side * s * 0.28, y0); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke(); }
      g.fillStyle = p.hi; g.beginPath(); g.arc(kx, ky, lw * 0.9, 0, TAU); g.fill();
    }
    // tail: segmented arc rising behind, stinger curled forward
    const segs = 6, sway = Math.sin(t * 2.2) * s * 0.07, pts = [];
    for (let i = 0; i <= segs; i++) { const a = i / segs; pts.push([sway * a + Math.sin(a * 1.6) * s * 0.07, -s * 0.36 - Math.sin(a * Math.PI * 0.62) * s * 0.98 + a * a * s * 0.28]); }
    for (let i = segs; i >= 1; i--) {
      const [x, y] = pts[i], r = s * (0.24 - i * 0.02);
      g.fillStyle = rad(g, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.2, [[0, p.hi], [0.45, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.ellipse(x, y, r * 1.08, r * 0.82, 0, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = lw * 0.7; g.beginPath(); g.ellipse(x, y + r * 0.15, r * 0.75, r * 0.45, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.35, r * 0.38, r * 0.18, -0.4, 0, TAU); g.fill();
    }
    { const [x, y] = pts[segs]; // stinger
      g.fillStyle = lin(g, x, y - s * 0.35, x + s * 0.2, y, [[0, type === 'queen' ? '#ffffff' : '#fff0c0'], [1, type === 'queen' ? '#a01020' : p.claw2]]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x - s * 0.12, y - s * 0.04); g.quadraticCurveTo(x + s * 0.02, y - s * 0.42, x + s * 0.26, y - s * 0.12); g.quadraticCurveTo(x + s * 0.13, y - s * 0.13, x + s * 0.11, y + s * 0.07); g.closePath(); g.fill(); g.stroke(); }
    // claws
    for (const side of [-1, 1]) {
      const sw = Math.sin(t * 3.2 + side) * 0.07, snap = Math.max(0, Math.sin(t * 1.7 + side * 2)) * 0.25;
      g.save(); g.rotate(side * sw);
      for (const [w, c] of [[s * 0.22, p.line], [s * 0.15, p.shell]]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(side * s * 0.24, s * 0.14); g.quadraticCurveTo(side * s * 0.64, s * 0.16, side * s * 0.6, s * 0.46); g.stroke(); }
      g.strokeStyle = p.hi; g.lineWidth = s * 0.04; g.beginPath(); g.moveTo(side * s * 0.3, s * 0.12); g.quadraticCurveTo(side * s * 0.58, s * 0.14, side * s * 0.56, s * 0.36); g.stroke();
      const px = side * s * 0.58, py = s * 0.62;
      g.fillStyle = rad(g, px - side * s * 0.06, py - s * 0.08, s * 0.02, s * 0.3, [[0, '#fff2c0'], [0.35, p.claw], [1, p.claw2]]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.ellipse(px, py, s * 0.25, s * 0.21, 0, 0, TAU); g.fill(); g.stroke();
      // pincer fingers (open/close)
      g.save(); g.translate(px, py + s * 0.1); g.rotate(-side * snap);
      g.beginPath(); g.moveTo(-side * s * 0.18, 0); g.quadraticCurveTo(-side * s * 0.26, s * 0.32, -side * s * 0.02, s * 0.34); g.quadraticCurveTo(-side * s * 0.06, s * 0.14, side * s * 0.02, s * 0.04); g.closePath(); g.fill(); g.stroke(); g.restore();
      g.save(); g.translate(px, py + s * 0.1); g.rotate(side * snap * 0.6);
      g.beginPath(); g.moveTo(side * s * 0.12, s * 0.02); g.quadraticCurveTo(side * s * 0.16, s * 0.36, 0, s * 0.4); g.quadraticCurveTo(side * s * 0.03, s * 0.2, -side * s * 0.02, s * 0.06); g.closePath(); g.fill(); g.stroke(); g.restore();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(px - side * s * 0.08, py - s * 0.08, s * 0.07, s * 0.04, -0.4 * side, 0, TAU); g.fill();
      g.restore();
    }
    // body carapace
    const breathe = 1 + Math.sin(t * 2.4) * 0.015;
    g.save(); g.scale(breathe, 1 / breathe);
    g.fillStyle = rad(g, -s * 0.12, -s * 0.22, s * 0.05, s * 0.55, [[0, p.hi], [0.5, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw * 1.3;
    g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.41, s * 0.43, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = p.line; g.lineWidth = lw * 0.9;
    for (let i = 0; i < 4; i++) { const y = -s * 0.32 + i * s * 0.12; g.beginPath(); g.moveTo(-s * 0.37 + Math.abs(i - 1.5) * s * 0.03, y); g.quadraticCurveTo(0, y + s * 0.08, s * 0.37 - Math.abs(i - 1.5) * s * 0.03, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = lw * 0.6; for (let i = 0; i < 4; i++) { const y = -s * 0.3 + i * s * 0.12; g.beginPath(); g.moveTo(-s * 0.3, y); g.quadraticCurveTo(0, y + s * 0.07, s * 0.3, y); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.ellipse(-s * 0.15, -s * 0.28, s * 0.13, s * 0.06, -0.4, 0, TAU); g.fill();
    g.restore();
    if (type === 'queen') {
      g.fillStyle = p.belly; for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(sd * s * 0.22, -s * 0.07, s * 0.08, s * 0.17, sd * 0.3, 0, TAU); g.fill(); }
      g.fillStyle = lin(g, 0, -s * 0.3, 0, s * 0.06, [[0, '#ff6a5a'], [1, '#a01020']]); g.strokeStyle = p.line; g.lineWidth = lw;
      g.beginPath(); g.moveTo(-s * 0.28, s * 0.06); g.lineTo(-s * 0.2, -s * 0.14); g.lineTo(-s * 0.1, -s * 0.02); g.lineTo(0, -s * 0.26); g.lineTo(s * 0.1, -s * 0.02); g.lineTo(s * 0.2, -s * 0.14); g.lineTo(s * 0.28, s * 0.06); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(0, -s * 0.08, s * 0.035, 0, TAU); g.fill();
    }
    if (type === 'giant') {
      for (const [x, y, r] of [[-s * 0.3, -s * 0.3, 0.17], [s * 0.3, -s * 0.3, 0.17], [0, -s * 0.44, 0.15], [-s * 0.4, -s * 0.02, 0.13], [s * 0.4, -s * 0.02, 0.13], [-s * 0.14, -s * 0.12, 0.1], [s * 0.14, -s * 0.12, 0.1]]) {
        g.fillStyle = lin(g, x, y - s * r, x, y + s * r, [[0, '#e0c098'], [1, '#6e4a2a']]); g.strokeStyle = p.line; g.lineWidth = lw;
        g.beginPath(); g.moveTo(x - s * r, y + s * r * 0.5); g.lineTo(x - s * r * 0.3, y - s * r * 0.9); g.lineTo(x + s * r * 0.2, y - s * r * 1.25); g.lineTo(x + s * r, y + s * r * 0.5); g.closePath(); g.fill(); g.stroke();
      }
    }
    // head + mandibles + eyes
    g.fillStyle = rad(g, -s * 0.05, s * 0.2, s * 0.02, s * 0.3, [[0, p.hi], [0.5, p.shell], [1, p.shell2]]); g.strokeStyle = p.line; g.lineWidth = lw;
    g.beginPath(); g.ellipse(0, s * 0.28, s * 0.28, s * 0.17, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = p.claw2; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(sd * s * 0.05, s * 0.4); g.lineTo(sd * s * 0.1, s * 0.5); g.lineTo(sd * s * 0.13, s * 0.4); g.closePath(); g.fill(); g.stroke(); }
    const blink = Math.sin(t * 1.1 + cx * 0.1) > 0.985 ? 0.2 : 1;
    for (const sd of [-1, 1]) {
      g.fillStyle = p.eye; g.strokeStyle = p.line; g.lineWidth = lw * 0.8; g.beginPath(); g.ellipse(sd * s * 0.1, s * 0.25, s * 0.075, s * 0.08 * blink, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#120604'; g.beginPath(); g.ellipse(sd * s * 0.1, s * 0.27, s * 0.04, s * 0.05 * blink, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(sd * s * 0.1 - s * 0.02, s * 0.235, s * 0.018, 0, TAU); g.fill();
    }
    g.restore();
  }

  // ================= FIELD CANNON BUBBLE =================
  function drawPickup(g, x, y, v, t, sc = 1) {
    if (has('orb')) {
      const bob = Math.sin(t * 3) * 2.5;
      g.save(); g.translate(x, y + bob); g.scale(sc, sc);
      g.fillStyle = 'rgba(20,60,120,.28)'; g.beginPath(); g.arc(0, 0, 27, 0, TAU); g.fill();
      drawCannon(g, 0, 4, v, 0.44, 1, false);
      g.globalCompositeOperation = 'lighter'; g.drawImage(IMG.orb, -33, -33, 66, 66); g.globalCompositeOperation = 'source-over';
      g.restore();
      valueTag(g, x, y + bob + 36 * sc, v, 0.85 * sc); return;
    }
    g.save(); g.translate(x, y); g.scale(sc, sc);
    const r = 28, bob = Math.sin(t * 3) * 2.5; g.translate(0, bob);
    g.fillStyle = rad(g, 0, 0, 2, r + 12, [[0, 'rgba(120,200,255,0)'], [0.7, 'rgba(120,200,255,.3)'], [1, 'rgba(120,200,255,0)']]); g.beginPath(); g.arc(0, 0, r + 12, 0, TAU); g.fill();
    g.fillStyle = rad(g, -7, -9, 2, r, [[0, 'rgba(255,255,255,.9)'], [0.45, 'rgba(150,215,255,.5)'], [1, 'rgba(30,110,200,.8)']]); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.strokeStyle = '#d0f0ff'; g.lineWidth = 2.5; g.stroke(); g.strokeStyle = 'rgba(20,70,140,.6)'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, r + 1.5, 0, TAU); g.stroke();
    g.save(); g.rotate(-0.45); drawCannon(g, 0, 8, v, 0.4, 1, false); g.restore();
    g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.ellipse(-10, -14, 8, 4, -0.6, 0, TAU); g.fill();
    g.restore();
    valueTag(g, x, y + bob + 36 * sc, v, 0.85 * sc);
  }

  // ================= HP BAR =================
  function hpBar(g, cx, cy, w, hp, maxHp) {
    plaque(g, cx, cy, w + 10, 21, 'rgba(40,14,8,.9)', 'rgba(255,200,150,.25)');
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    g.save(); g.beginPath(); g.rect(cx - w / 2, cy - 10, w * frac, 20); g.clip();
    plaque(g, cx, cy, w, 14, lin(g, 0, cy - 7, 0, cy + 7, [[0, '#ff6a52'], [0.5, '#d42a1e'], [1, '#8a120c']]));
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(cx - w / 2, cy - 6, w, 3);
    g.restore();
    text(g, fmt(Math.max(0, Math.ceil(hp))), cx, cy + 1, 16, '#fff', 'rgba(30,6,2,.95)', 'center', '900');
  }

  // ================= BARRICADE =================
  function drawBarricade(g, x0, x1, cy, broken) {
    const key = broken ? 'barricade_broken' : 'barricade';
    if (has(key)) {
      const im = IMG[key], w = x1 - x0 + 10, h = Math.min(w * im.naturalHeight / im.naturalWidth, broken ? 50 : 58);
      g.save(); g.fillStyle = 'rgba(90,45,5,.22)'; g.beginPath(); g.ellipse((x0 + x1) / 2, cy + h * 0.42, w * 0.46, 8, 0, 0, TAU); g.fill();
      g.imageSmoothingQuality = 'high'; g.drawImage(im, x0 - 5, cy + h * 0.5 - h, w, h); g.restore(); return;
    }
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    const logY = cy - 2;
    const log = (ax, ay, bx, by, r) => {
      const ang = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay);
      g.save(); g.translate(ax, ay); g.rotate(ang);
      g.fillStyle = lin(g, 0, -r, 0, r, [[0, '#d69a5e'], [0.35, '#a8703e'], [0.8, '#6a4220'], [1, '#4a2c14']]); g.strokeStyle = '#2e1a0a'; g.lineWidth = 2;
      rr(g, 0, -r, len, r * 2, r); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(60,30,10,.5)'; g.lineWidth = 1.1;
      for (let i = 8; i < len - 10; i += 9) { const o = ((i * 37) % 5) - 2; g.beginPath(); g.moveTo(i, -r * 0.6 + o * 0.4); g.lineTo(i + 8, -r * 0.5 + o * 0.4); g.stroke(); g.beginPath(); g.moveTo(i + 3, r * 0.35); g.lineTo(i + 9, r * 0.45); g.stroke(); }
      g.strokeStyle = 'rgba(255,220,160,.35)'; g.beginPath(); g.moveTo(4, -r * 0.62); g.lineTo(len - 6, -r * 0.62); g.stroke();
      g.fillStyle = lin(g, len - r, 0, len + r, 0, [[0, '#c8935a'], [1, '#f0c890']]); g.strokeStyle = '#2e1a0a'; g.lineWidth = 1.8; g.beginPath(); g.ellipse(len, 0, r * 0.5, r, 0, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(110,60,20,.6)'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(len, 0, r * 0.28, r * 0.55, 0, 0, TAU); g.stroke();
      g.restore();
    };
    const post = (x, y, tilt) => {
      g.save(); g.translate(x, y); g.rotate(tilt);
      g.fillStyle = 'rgba(80,40,10,.3)'; g.beginPath(); g.ellipse(0, 14, 18, 5, 0, 0, TAU); g.fill();
      for (const [dx, dy, a, L] of [[-12, -14, -0.7, 17], [12, -14, 0.7, 17], [-14, 4, -1.6, 16], [14, 4, 1.6, 16], [-6, -22, -0.25, 14], [6, -22, 0.25, 14]]) {
        g.save(); g.translate(dx, dy); g.rotate(a); g.fillStyle = lin(g, -3, 0, 3, 0, [[0, '#b08050'], [0.5, '#f0d0a0'], [1, '#9a6a3a']]); g.strokeStyle = '#2e1a0a'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(-3.5, 0); g.lineTo(0, -L); g.lineTo(3.5, 0); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
      g.fillStyle = lin(g, -11, 0, 11, 0, [[0, '#5a361a'], [0.45, '#b98250'], [1, '#4a2c12']]); g.strokeStyle = '#2e1a0a'; g.lineWidth = 2;
      rr(g, -11, -24, 22, 36, 6); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(40,20,5,.45)'; g.lineWidth = 1; for (const xx of [-5, 1, 6]) { g.beginPath(); g.moveTo(xx, -18); g.lineTo(xx + 1, 8); g.stroke(); }
      g.fillStyle = '#e8bc84'; g.beginPath(); g.ellipse(0, -24, 11, 5, 0, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(110,60,20,.6)'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(0, -24, 6, 2.6, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(0, -24, 2.5, 1.1, 0, 0, TAU); g.stroke();
      for (let i = 0; i < 3; i++) { g.strokeStyle = '#7a5a30'; g.lineWidth = 4; g.beginPath(); g.moveTo(-12, -8 + i * 5); g.lineTo(12, -5 + i * 5); g.stroke(); g.strokeStyle = '#ecd6a4'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-12, -8 + i * 5); g.lineTo(12, -5 + i * 5); g.stroke(); }
      g.fillStyle = '#9aa0a8'; for (const [nx, ny] of [[-6, 4], [6, 6]]) { g.beginPath(); g.arc(nx, ny, 1.8, 0, TAU); g.fill(); }
      g.restore();
    };
    if (!broken) {
      log(x0 + 10, logY - 7, x1 - 10, logY - 7, 7.5);
      log(x0 + 10, logY + 7, x1 - 10, logY + 7, 7.5);
      // cross lashing ropes
      g.strokeStyle = '#ecd6a4'; g.lineWidth = 2;
      for (let x = x0 + 50; x < x1 - 40; x += 44) { g.beginPath(); g.moveTo(x - 6, logY - 14); g.lineTo(x + 6, logY + 14); g.moveTo(x + 6, logY - 14); g.lineTo(x - 6, logY + 14); g.stroke(); }
      post(x0 + 18, cy + 4, 0); post(x1 - 18, cy + 4, 0); if (x1 - x0 > 150) post((x0 + x1) / 2, cy + 4, 0);
      g.strokeStyle = '#ecd6a4'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 18, cy - 12); g.quadraticCurveTo((x0 + x1) / 2, cy - 1, x1 - 18, cy - 12); g.stroke();
    } else {
      const m = (x0 + x1) / 2;
      g.fillStyle = 'rgba(90,50,20,.35)'; g.beginPath(); g.ellipse(m, cy + 16, 58, 9, 0, 0, TAU); g.fill();
      log(x0 + 8, logY + 10, m - 16, logY - 4, 7.5); log(m + 24, logY + 13, x1 - 6, logY + 2, 7.5); log(m - 26, logY + 18, m + 12, logY + 14, 5);
      post(x0 + 18, cy + 8, -0.4); post(x1 - 18, cy + 8, 0.45);
      g.fillStyle = '#e0bc88'; g.strokeStyle = '#2e1a0a'; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) { const sx = m - 36 + i * 9, sy = cy + ((i * 37) % 13) - 4; g.save(); g.translate(sx, sy); g.rotate(i * 1.3); g.beginPath(); g.moveTo(-2, 0); g.lineTo(0, -11); g.lineTo(2, 0); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      g.strokeStyle = '#ecd6a4'; g.lineWidth = 2; g.beginPath(); g.moveTo(m - 20, cy + 2); g.quadraticCurveTo(m, cy + 18, m + 18, cy + 4); g.stroke();
    }
    g.restore();
  }

  // ================= ITEM ICONS =================
  function itemIcon(g, k, x, y, s = 1) {
    if (has('item_' + k)) { g.save(); g.imageSmoothingQuality = 'high'; fitImg(g, IMG['item_' + k], x, y + 21 * s, 44 * s, 44 * s); g.restore(); return; }
    g.save(); g.translate(x, y); g.scale(s, s); g.lineWidth = 2; g.strokeStyle = OUT; g.lineJoin = 'round';
    if (k === 'spray') {
      g.fillStyle = lin(g, -11, 0, 11, 0, [[0, '#2a7a2a'], [0.45, '#8ee07a'], [1, '#1e5a1e']]); rr(g, -11, -8, 22, 28, 6); g.fill(); g.stroke();
      g.fillStyle = '#fff4c0'; rr(g, -8, 0, 16, 11, 2); g.fill(); g.fillStyle = '#c0281a'; g.beginPath(); g.arc(0, 5.5, 3.5, 0, TAU); g.fill();
      g.fillStyle = lin(g, -6, 0, 6, 0, [[0, '#8a8a8a'], [0.5, '#f0f0f0'], [1, '#7a7a7a']]); rr(g, -6, -17, 12, 10, 2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(220,255,220,.9)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(9 + i * 4, -17 - i * 2 + (i % 2) * 4, 2.6 - i * 0.2, 0, TAU); g.fill(); }
    } else if (k === 'fire') {
      g.fillStyle = rad(g, -9, 6, 1, 10, [[0, '#9a9aa8'], [1, '#3a3a44']]); g.beginPath(); g.arc(-8, 9, 9, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.arc(8, 11, 7, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = lin(g, 0, -22, 0, 8, [[0, '#ffe14a'], [0.5, '#ff7a2a'], [1, '#d0281a']]); g.beginPath(); g.moveTo(2, -22); g.quadraticCurveTo(19, -4, 10, 6); g.quadraticCurveTo(2, 10, -6, 4); g.quadraticCurveTo(-15, -6, 2, -22); g.fill(); g.stroke();
      g.fillStyle = '#fff4b0'; g.beginPath(); g.moveTo(2, -8); g.quadraticCurveTo(9, 0, 5, 4); g.lineTo(-2, 4); g.quadraticCurveTo(-5, -2, 2, -8); g.fill();
    } else if (k === 'super') {
      g.fillStyle = lin(g, 0, -19, 0, 19, [[0, '#fff0a0'], [1, '#b87a08']]); g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 13 : 19.5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#2e1e4e'; g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = rad(g, -2, -2, 0.5, 6, [[0, '#ffffff'], [0.5, '#c08aff'], [1, '#6a2ab0']]); g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
    }
    g.restore();
  }

  window.SandArt = { IMG, has, loadAssets, fitImg, ASSETS, TIERS, tierIdx, tierOf, rr, text, lin, rad, plaque, fmt, drawCannon, valueTag, cannonSprite, drawScorpion, drawPickup, hpBar, drawBarricade, itemIcon, shade };
})();
