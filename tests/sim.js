// Headless balance + invariant simulation: node tests/sim.js [games]
const G = require('../game.js');
const N = +process.argv[2] || 200;
const L = G.LANES, SL = G.SLOTS;
const threat = (S, lane) => { const t = G.targetInLane(S, lane); return t ? t.row + 1 : 0; };

function pairs(S) {
  const p = [];
  for (let i = 0; i < SL; i++) for (let j = 0; j < SL; j++) if (i !== j && S.tray[i] && S.tray[i] === S.tray[j]) p.push([i, j]);
  return p;
}
function smart(S) {
  const p = pairs(S);
  if (p.length) {
    p.sort((a, b) => S.tray[a[0]] - S.tray[b[0]] || threat(S, b[1] % L) - threat(S, a[1] % L));
    return { type: 'move', from: p[0][0], to: p[0][1] };
  }
  // move biggest cannon toward most threatened lane
  const empties = [], full = [];
  for (let i = 0; i < SL; i++) (S.tray[i] ? full : empties).push(i);
  if (empties.length && full.length) {
    empties.sort((a, b) => threat(S, b % L) - threat(S, a % L));
    full.sort((a, b) => threat(S, a % L) - threat(S, b % L));
    return { type: 'move', from: full[0], to: empties[0] };
  }
  return { type: 'pass' };
}
function randomMove(S) {
  const opts = [];
  for (let i = 0; i < SL; i++) for (let j = 0; j < SL; j++) if (i !== j && S.tray[i] && (!S.tray[j] || S.tray[j] === S.tray[i])) opts.push([i, j]);
  if (!opts.length) return { type: 'pass' };
  const [from, to] = opts[(S.rand() * opts.length) | 0];
  return { type: 'move', from, to };
}
function freebies(S, items) {
  for (const b of S.bubbles.slice()) G.collectBubble(S, b.id);
  if (!items) return;
  for (const w of S.walls) if (w.hp < 10 && S.items.spray) { G.useItem(S, 'spray'); break; }
  const near = S.enemies.filter((e) => e.row >= G.ROWS - 2);
  if (near.length >= 2 && S.items.bomb) G.useItem(S, 'bomb', { row: near[0].row, lane: near[0].lane });
  if (near.length && S.items.fire) { near.sort((a, b) => b.hp - a.hp); if (S.enemies.includes(near[0])) G.useItem(S, 'fire', near[0].id); }
  if (S.items.super) { let best = -1; S.tray.forEach((v, i) => { if (v && v <= 32 && (best < 0 || v > S.tray[best])) best = i; }); if (best >= 0 && S.tray[best] >= 8) G.useItem(S, 'super', best); }
}
function run(policy, seed, bubbles, items) {
  const S = G.newGame(seed);
  let stuck = 0, onBoard = 0;
  while (!S.over && S.turn < 5000) {
    if (bubbles) freebies(S, items);
    const a = policy(S);
    if (a.type === 'pass') stuck++;
    const r = G.takeTurn(S, a);
    if (!r.ok) throw new Error('illegal ' + JSON.stringify(a) + ' ' + r.msg);
    onBoard += S.enemies.length;
    const cells = new Set();
    for (const e of S.enemies) {
      if (e.row < 0 || e.row >= G.ROWS || e.lane < 0 || e.lane + e.w > L || e.hp <= 0) throw new Error('bad enemy ' + JSON.stringify(e));
      for (const l of G.lanesOf(e)) { const k = e.row + ',' + l; if (cells.has(k)) throw new Error('overlap ' + k); cells.add(k); }
    }
  }
  return { turns: S.turn, level: S.level, score: S.score, over: S.over, maxT: Math.max(...S.tray), stuck, board: onBoard / Math.max(1, S.turn) };
}
function stats(name, arr) {
  const q = (k, p) => { const s = arr.map((x) => x[k]).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const avg = (k) => (arr.reduce((a, x) => a + x[k], 0) / arr.length);
  console.log(`${name.padEnd(16)} gameOver ${arr.filter((x) => x.over).length}/${arr.length} | turns avg ${avg('turns').toFixed(0)} (p10 ${q('turns', .1)}, p90 ${q('turns', .9)}) | level avg ${avg('level').toFixed(1)} (p10 ${q('level', .1)}, p90 ${q('level', .9)}) | score avg ${avg('score').toFixed(0)} | top cannon p50 ${q('maxT', .5)} | passes avg ${avg('stuck').toFixed(1)} | bugs on board ${avg('board').toFixed(1)}`);
}
const res = { random: [], smartNoBubbles: [], smart: [], smartItems: [] };
for (let i = 1; i <= N; i++) {
  const seed = i * 7919;
  res.random.push(run(randomMove, seed, false, false));
  res.smartNoBubbles.push(run(smart, seed, false, false));
  res.smart.push(run(smart, seed, true, false));
  res.smartItems.push(run(smart, seed, true, true));
}
for (const k in res) stats(k, res[k]);
const allOver = Object.values(res).every((a) => a.every((x) => x.over));
console.log(allOver ? 'OK: every run ended in game over' : 'WARN: some runs never ended');
