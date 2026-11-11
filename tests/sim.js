// Headless balance + invariant simulation: node tests/sim.js [games]
const G = require('../game.js');
const N = +process.argv[2] || 60;
const L = G.LANES;

function lanePower(S, l) { return S.tray[l] + S.tray[l + L]; }
function evaluate(S) {
  if (S.over) return -1e9 + S.score;
  let v = S.score - (S.wallHits ? 3000 * (1 + S.level / 4) : 0);
  const atk = G.totalAttack(S) + S.pocket * 0.8;
  v += 400 * Math.log2(1 + atk);
  for (const e of S.enemies) {
    const pw = G.lanesOf(e).reduce((a, l) => a + lanePower(S, l), 0);
    if (e.type === 'pickup') { v += pw ? 30 * Math.log2(1 + e.value) * (e.row + 1) : 0; continue; }
    const turnsToKill = e.hp / Math.max(0.5, pw), turnsLeft = G.ROWS - e.row;
    v -= 120 * (e.row + 1) * Math.min(4, turnsToKill / turnsLeft) * (1 + S.level / 5);
  }
  // fewer, bigger cannons are better (tray room)
  v -= 15 * S.tray.filter((x) => x).length;
  return v;
}
function lookahead(S) {
  let best = null, bv = -Infinity;
  for (const m of G.legalMoves(S)) {
    const C = G.clone(S); G.takeTurn(C, m); const v = evaluate(C);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}
function simple(S) {
  // put pocket cannon to use, merge pairs, otherwise move a cannon toward the most urgent lane
  const slots = [...S.tray, S.pocket];
  for (let i = 0; i <= 10; i++) for (let j = 0; j < 10; j++) if (i !== j && slots[i] && slots[i] === slots[j]) return { type: 'move', from: i, to: j };
  const urg = (l) => { const t = G.targetInLane(S, l); return t ? t.row + (t.type === 'pickup' ? 0 : 2) : -1; };
  const lanes = [0, 1, 2, 3, 4].sort((a, b) => urg(b) - urg(a));
  if (S.pocket) { for (const l of lanes) for (const s of [l, l + L]) if (!S.tray[s]) return { type: 'move', from: 10, to: s }; return { type: 'move', from: 10, to: S.tray.indexOf(Math.min(...S.tray)) }; }
  const l = lanes[0];
  for (const s of [l, l + L]) if (!S.tray[s]) { const f = S.tray.findIndex((v, i) => v && i % L !== l); if (f >= 0) return { type: 'move', from: f, to: s }; }
  const f = S.tray.findIndex((v) => v); return { type: 'move', from: f, to: 10 };
}
function randomMove(S) { const m = G.legalMoves(S); return m[(G.rand(S) * m.length) | 0]; }
function useItems(S) {
  if (S.wallHits && S.items.spray) G.useItem(S, 'spray');
  const bugs = S.enemies.filter(G.isBug);
  for (const e of bugs.filter((e) => e.row >= G.ROWS - 2).sort((a, b) => b.row - a.row)) {
    const pw = G.lanesOf(e).reduce((a, l) => a + lanePower(S, l), 0);
    if (e.hp > pw * (G.ROWS - 1 - e.row) && S.items.fire && S.enemies.includes(e)) G.useItem(S, 'fire', e.id);
  }
  for (const e of bugs) { if (!S.enemies.includes(e)) continue; const n = bugs.filter((o) => S.enemies.includes(o) && Math.abs(o.row - e.row) <= 1 && Math.abs(o.lane - e.lane) <= 1).length; if (n >= 3 && S.items.bomb && e.row >= 2) G.useItem(S, 'bomb', { row: e.row, lane: e.lane }); }
  if (S.items.super) { let b = -1; S.tray.forEach((v, i) => { if (v && v < 32 && (b < 0 || v > S.tray[b])) b = i; }); if (b >= 0 && S.tray[b] >= 4) G.useItem(S, 'super', b); }
}
function run(policy, seed, items) {
  const S = G.newGame(seed);
  let collected = 0, lost = 0, hits = 0;
  while (!S.over && S.turn < 3000) {
    if (items) useItems(S);
    const r = G.takeTurn(S, policy(S));
    if (!r.ok) throw new Error('illegal move ' + r.msg);
    for (const e of r.events) { if (e.type === 'collect') { collected++; lost += e.lost.length; } if (e.type === 'wallHit') hits++; }
    const cells = new Set();
    for (const e of S.enemies) {
      if (e.row < 0 || e.row >= G.ROWS || e.lane < 0 || e.lane + e.w > L || (G.isBug(e) && e.hp <= 0)) throw new Error('bad entity ' + JSON.stringify(e));
      for (const l of G.lanesOf(e)) { const k = e.row + ',' + l; if (cells.has(k)) throw new Error('overlap ' + k); cells.add(k); }
    }
    if (S.tray.concat(S.pocket).some((v) => v && (v & (v - 1)))) throw new Error('non power of 2 cannon');
    if (!S.over && !G.legalMoves(S).length) throw new Error('no legal move');
  }
  return { turns: S.turn, level: S.level, score: S.score, over: S.over, maxT: Math.max(...S.tray, S.pocket), collected, lost, hits };
}
function stats(name, arr) {
  const q = (k, p) => { const s = arr.map((x) => x[k]).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const avg = (k) => (arr.reduce((a, x) => a + x[k], 0) / arr.length);
  console.log(`${name.padEnd(17)} over ${arr.filter((x) => x.over).length}/${arr.length} | turns ${avg('turns').toFixed(0)} (p10 ${q('turns', .1)} p90 ${q('turns', .9)}) | level ${avg('level').toFixed(1)} (p10 ${q('level', .1)} p90 ${q('level', .9)}) | score ${avg('score').toFixed(0)} | top cannon p50 ${q('maxT', .5)} | collected ${avg('collected').toFixed(0)} lost-to-override ${avg('lost').toFixed(1)}`);
}
const bots = { random: [randomMove, false], simple: [simple, false], lookahead: [lookahead, false], lookaheadItems: [lookahead, true] };
const only = process.argv[3];
let allOver = true;
for (const [name, [pol, items]] of Object.entries(bots)) {
  if (only && !name.startsWith(only)) continue;
  const res = [];
  for (let i = 1; i <= N; i++) res.push(run(pol, i * 7919, items));
  stats(name, res);
  allOver = allOver && res.every((x) => x.over);
}
console.log(allOver ? 'OK: every run ended in game over; invariants held' : 'WARN: some runs hit the turn cap');
