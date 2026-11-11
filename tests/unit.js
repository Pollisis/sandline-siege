// Focused rule checks: node tests/unit.js
const G = require('../game.js');
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('ok - ' + m); };
const R = G.ROWS - 1, P = G.POCKET;
function fresh() { const S = G.newGame(1); S.enemies.length = 0; S.tray.fill(0); S.pocket = 0; S.rs = 12345; S.items = { spray: 10, fire: 10, super: 10 }; return S; }
const noSpawn = (S) => { S.dry = -999; G.rand = G.rand; };

let S = G.newGame(3);
assert(G.LANES === 5 && G.ROWS === 6 && G.SLOTS === 10, 'field is 5 lanes x 6 rows, tray 5x2');
assert(S.tray.filter((v) => v).length === 1 && S.tray.includes(1) && S.pocket === 0, 'start with a single cannon of value 1 and an empty pocket');

// swap / merge / move incl. pocket
S = fresh(); S.tray[0] = 4; S.tray[1] = 8; G.playerMove(S, { type: 'move', from: 0, to: 1 });
assert(S.tray[0] === 8 && S.tray[1] === 4, 'dropping on a different value swaps');
G.playerMove(S, { type: 'move', from: 1, to: 2 }); assert(S.tray[1] === 0 && S.tray[2] === 4, 'dropping on empty moves');
S.tray[3] = 4; G.playerMove(S, { type: 'move', from: 3, to: 2 }); assert(S.tray[2] === 8 && S.tray[3] === 0, 'dropping on equal value merges (doubles)');
G.playerMove(S, { type: 'move', from: 2, to: P }); assert(S.pocket === 8 && S.tray[2] === 0, 'tray cannon can be dropped into the empty pocket');
S.tray[4] = 2; G.playerMove(S, { type: 'move', from: 4, to: P }); assert(S.pocket === 2 && S.tray[4] === 8, 'tray -> occupied pocket with different value swaps');
S.tray[5] = 2; G.playerMove(S, { type: 'move', from: P, to: 5 }); assert(S.pocket === 0 && S.tray[5] === 4, 'pocket -> equal tray cannon merges');

// field cannons
S = fresh(); S.tray[1] = 1; S.enemies.push({ id: 50, type: 'pickup', lane: 1, row: 2, w: 1, value: 4, hp: 1, maxHp: 1 }, { id: 51, type: 'crawler', lane: 1, row: 1, w: 1, hp: 5, maxHp: 5 });
let ev = G.fire(S);
assert(S.pocket === 4 && !S.enemies.some((e) => e.id === 50) && S.enemies.find((e) => e.id === 51).hp === 4, 'a shot collects the field cannon in front and carries on (full damage) to the scorpion behind');
S = fresh(); S.pocket = 2; S.tray[0] = 1; S.tray[3] = 1;
S.enemies.push({ id: 60, type: 'pickup', lane: 0, row: 1, w: 1, value: 8, hp: 1, maxHp: 1 }, { id: 61, type: 'pickup', lane: 3, row: 3, w: 1, value: 32, hp: 1, maxHp: 1 });
ev = G.fire(S); const c = ev.find((e) => e.type === 'collect');
assert(S.pocket === 32 && c.lost.length === 1 && c.lost[0].value === 8 && c.replaced === 2, 'only one cannon per turn: highest wins, others lost, it replaces the pocket');
S = fresh(); S.tray[0] = 1; S.enemies.push({ id: 70, type: 'pickup', lane: 4, row: R, w: 1, value: 2, hp: 1, maxHp: 1 });
G.advance(S); assert(!S.enemies.some((e) => e.id === 70) && S.walls[0] && S.walls[1] && !S.over, 'field cannon reaching the barricades just disappears');
const before = S.tray.slice(); G.takeTurn(S, { type: 'move', from: 0, to: 1 });
assert(S.tray.filter((v) => v).length === before.filter((v) => v).length, 'no auto-refill of tray slots');

// barricades: one free hit, second hit = game over
S = fresh(); S.tray[0] = 1; S.enemies.push({ id: 80, type: 'crawler', lane: 0, row: R, w: 1, hp: 50, maxHp: 50 });
G.advance(S); assert(!S.walls[0] && S.walls[1] && !S.over && !S.enemies.some((e) => e.id === 80), 'first scorpion at the barricade destroys its section and leaves');
S.enemies.push({ id: 81, type: 'crawler', lane: 4, row: R, w: 1, hp: 50, maxHp: 50 }); G.advance(S);
assert(S.over, 'any second hit (even on the other section) is game over');
S = fresh(); S.enemies.push({ id: 82, type: 'crawler', lane: 2, row: R, w: 1, hp: 50, maxHp: 50 }); S.walls[0] = true; S.walls[1] = true;
G.advance(S); assert(S.walls.filter((w) => !w).length === 1 && !S.over, 'lane-3 scorpion destroys one intact section');
S = fresh(); S.walls[1] = false; S.wallHits = 1;
let r = G.useItem(S, 'spray'); assert(r.ok && S.walls[1] && S.wallHits === 0, 'Bug Spray repairs a destroyed section (free hit restored)');
S = fresh(); S.walls[0] = false; S.wallHits = 1;
S.enemies.push({ id: 90, type: 'crawler', lane: 0, row: 4, w: 1, hp: 9, maxHp: 9 }, { id: 91, type: 'crawler', lane: 0, row: 1, w: 1, hp: 9, maxHp: 9 }, { id: 92, type: 'crawler', lane: 4, row: 4, w: 1, hp: 9, maxHp: 9 });
const sc = S.score; G.useItem(S, 'spray');
assert(!S.enemies.some((e) => e.id === 90) && S.enemies.some((e) => e.id === 91) && S.enemies.some((e) => e.id === 92) && S.score > sc, 'Bug Spray drives off the front scorpions of that section and awards their points');

// items
S = fresh(); S.tray[0] = 16; S.tray[1] = 32; r = G.useItem(S, 'super', 1); assert(!r.ok, 'Super Component refuses 32');
r = G.useItem(S, 'super', 0); assert(r.ok && S.tray[0] === 32, 'Super Component doubles a cannon below 32');
S.tray = [8, 8, 0, 0, 0, 4, 0, 0, 0, 0]; S.enemies.push({ id: 93, type: 'crawler', lane: 3, row: 2, w: 1, hp: 100, maxHp: 100 });
G.useItem(S, 'fire', 93); assert(S.enemies.find((e) => e.id === 93).hp === 90, 'Extra Firepower deals 50% of total cannon attack');
S = fresh(); S.items.super = 15; for (let i = 0; i < G.ITEM_USES; i++) { S.tray[0] = 1; G.useItem(S, 'super', 0); }
S.tray[0] = 1; assert(S.itemUsed.super === G.ITEM_USES && !G.useItem(S, 'super', 0).ok, `each item is limited to ${G.ITEM_USES} uses per game even with charges left`);

// 2-wide bugs
S = fresh(); S.enemies.push({ id: 96, type: 'giant', lane: 1, row: 1, w: 2, hp: 100, maxHp: 100 }); S.tray[1] = 8; S.tray[2] = 16; S.tray[7] = 4;
G.fire(S); assert(S.enemies[0].hp === 72, 'giant is hit by cannons in both of its lanes (front + back rows)');

// overkill carry-through
S = fresh(); S.tray[0] = 10;
S.enemies.push({ id: 200, type: 'crawler', lane: 0, row: 4, w: 1, hp: 3, maxHp: 3 }, { id: 201, type: 'crawler', lane: 0, row: 2, w: 1, hp: 4, maxHp: 4 }, { id: 202, type: 'crawler', lane: 0, row: 0, w: 1, hp: 9, maxHp: 9 });
ev = G.fire(S);
assert(!S.enemies.some((e) => e.id === 200 || e.id === 201) && S.enemies.find((e) => e.id === 202).hp === 6 && S.kills === 2, 'overkill carries through: 10 dmg kills 3hp + 4hp, remaining 3 hits the next (9 -> 6)');
S = fresh(); S.tray[1] = 5;
S.enemies.push({ id: 210, type: 'crawler', lane: 1, row: 3, w: 1, hp: 5, maxHp: 5 }, { id: 211, type: 'crawler', lane: 1, row: 1, w: 1, hp: 5, maxHp: 5 });
G.fire(S); assert(!S.enemies.some((e) => e.id === 210) && S.enemies.find((e) => e.id === 211).hp === 5, 'exact kill leaves no surplus');
S = fresh(); S.tray[0] = 8; S.tray[5] = 1;
S.enemies.push({ id: 220, type: 'crawler', lane: 0, row: 4, w: 1, hp: 6, maxHp: 6 }, { id: 221, type: 'crawler', lane: 0, row: 3, w: 1, hp: 6, maxHp: 6 });
G.fire(S); assert(S.enemies.find((e) => e.id === 221).hp === 3, 'each cannon shot carries separately (front 8: kills 6, 2 carry; back 1 hits next)');
S = fresh(); S.tray[1] = 20;
S.enemies.push({ id: 230, type: 'giant', lane: 1, row: 4, w: 2, hp: 12, maxHp: 12 }, { id: 231, type: 'crawler', lane: 1, row: 2, w: 1, hp: 5, maxHp: 5 }, { id: 232, type: 'crawler', lane: 2, row: 2, w: 1, hp: 5, maxHp: 5 });
G.fire(S); assert(!S.enemies.some((e) => e.id === 230) && !S.enemies.some((e) => e.id === 231) && S.enemies.find((e) => e.id === 232).hp === 5, '2-wide bug: surplus continues only down the lane of the shot that killed it');
S = fresh(); S.tray[3] = 10; S.tray[4] = 10;
S.enemies.push({ id: 240, type: 'crawler', lane: 3, row: 4, w: 1, hp: 2, maxHp: 2 }, { id: 241, type: 'pickup', lane: 3, row: 3, w: 1, value: 4, hp: 1, maxHp: 1 }, { id: 242, type: 'crawler', lane: 3, row: 1, w: 1, hp: 20, maxHp: 20 },
  { id: 243, type: 'pickup', lane: 4, row: 2, w: 1, value: 16, hp: 1, maxHp: 1 });
ev = G.fire(S); const col = ev.find((e) => e.type === 'collect');
assert(S.enemies.find((e) => e.id === 242).hp === 12 && col.value === 16 && col.lost.length === 1 && S.pocket === 16, 'surplus collects a field cannon and keeps going; still only one collect per turn (highest wins)');

// ---- earned power-ups ----
S = G.newGame(4); assert(S.items.spray === 1 && S.items.fire === 0 && S.items.super === 0, 'power-ups start at 0 (1 Bug Spray)');
{ let earned = 0, ok = true; const N = 400;
  for (let i = 0; i < N; i++) {
    S = G.newGame(1000 + i); S.items = { spray: 0, fire: 0, super: 0 }; S.tray[1] = 999; S.enemies = [{ id: 300, type: 'giant', lane: 1, row: 3, w: 2, hp: 50, maxHp: 50 }];
    ev = G.fire(S); const got = ev.some((e) => e.type === 'itemEarned'), n = S.items.spray + S.items.fire + S.items.super;
    if (got) earned++; if (n !== (got ? 1 : 0)) ok = false;
  }
  assert(ok && earned / N > 0.3 && earned / N < 0.5, `slaying a Giant earns a power-up charge about 40% of the time (${earned}/${N})`); }
S = fresh(); S.items = { spray: 0, fire: 0, super: 0 }; S.kills = 24; S.tray[0] = 5; S.enemies.push({ id: 301, type: 'crawler', lane: 0, row: 3, w: 1, hp: 2, maxHp: 2 });
ev = G.fire(S); assert(S.level === 2 && ev.some((e) => e.type === 'itemEarned' && e.source === 'level'), 'each Defense Level up earns a random power-up');
S = fresh(); S.items = { spray: 0, fire: 0, super: 0 }; assert(!G.useItem(S, 'super', 0).ok, 'cannot use a power-up with no charges');

// ---- Brood Queen: hatchlings always appear on the next move, by any death path ----
function queenScene() { const S = fresh(); S.enemies.push({ id: 400, type: 'queen', lane: 3, row: 2, w: 2, hp: 10, maxHp: 100 }); return S; }
const hatch = (S) => S.enemies.filter((e) => e.type === 'hatchling');
S = queenScene(); S.tray[3] = 10; ev = G.fire(S);
assert(!S.enemies.some((e) => e.id === 400) && hatch(S).length === 0 && S.brood.length === 1, 'exact-kill shot: brood is queued, not spawned during firing');
G.advance(S); let hs = hatch(S);
assert(hs.length === 3 && hs.every((e) => e.row === 2 && e.maxHp === 20) && hs.map((e) => e.lane).sort().join() === '2,3,4', 'after the move resolves: 3 hatchlings with 20% HP in her row across her lanes + an adjacent lane (lanes 3,4,5)');
S = queenScene(); S.tray[3] = 500; S.tray[4] = 500; ev = G.fire(S);
assert(hatch(S).length === 0 && S.brood.length === 1, 'surplus/overkill shot kills her: surplus does not hit the babies (none exist yet)');
G.advance(S); assert(hatch(S).length === 3 && hatch(S).every((e) => e.hp === 20), 'surplus kill: 3 full-HP hatchlings appear on the next move');
S = queenScene(); S.tray[3] = 12; S.enemies.push({ id: 401, type: 'crawler', lane: 3, row: 4, w: 1, hp: 2, maxHp: 2 }); ev = G.fire(S);
assert(!S.enemies.some((e) => e.id === 400) && S.brood.length === 1, 'carry-through kill (shot passes a crawler first) queues the brood'); G.advance(S); assert(hatch(S).length === 3, 'carry-through kill: hatchlings appear');
S = queenScene(); S.tray = [50, 50, 0, 0, 0, 0, 0, 0, 0, 0]; G.useItem(S, 'fire', 400);
assert(S.brood.length === 1 && hatch(S).length === 0, 'Extra Firepower kill queues the brood'); G.advance(S); assert(hatch(S).length === 3, 'Extra Firepower kill: hatchlings appear on the next move');
S = queenScene(); S.enemies[0].row = 5; S.enemies[0].lane = 0; S.walls[0] = false; S.wallHits = 1; G.useItem(S, 'spray');
assert(!S.enemies.some((e) => e.id === 400) && S.brood.length === 1, 'Bug Spray driving her off queues the brood'); G.advance(S); assert(hatch(S).length === 3, 'Bug Spray: hatchlings appear on the next move');
S = queenScene(); S.enemies[0].lane = 0; S.enemies[0].row = 3; S.tray[0] = 500;
S.enemies.push({ id: 410, type: 'crawler', lane: 2, row: 2, w: 1, hp: 999, maxHp: 999 });
G.fire(S); G.advance(S); hs = hatch(S);
assert(hs.length === 3 && new Set(hs.map((e) => e.row + ',' + e.lane)).size === 3, 'occupied target cells: hatchlings take the nearest free cells (row or row behind)');
S = fresh(); S.enemies.push({ id: 420, type: 'queen', lane: 3, row: 0, w: 2, hp: 1, maxHp: 50 }); S.tray[3] = 5; G.fire(S); G.advance(S);
assert(hatch(S).length === 3 && hatch(S).every((e) => e.row >= 0 && e.lane >= 0 && e.lane < 5), 'brood near the board edge stays on the board');

// ---- scorpion HP scales with player power ----
S = fresh(); S.level = 1; S.tray = [512, 512, 256, 256, 128, 0, 0, 0, 0, 0]; S.pocket = 64;
const e1 = G.TYPES; const ev2 = []; S.dry = -99; S.turn = 50;
const before2 = S.enemies.length; for (let i = 0; i < 40; i++) G.advance(S);
const crawlers = S.enemies.filter((e) => e.type === 'crawler');
assert(crawlers.length && crawlers.every((e) => e.maxHp >= 0.85 * G.POWER_K * G.playerPower(S) - 1), `new crawler HP >= ${G.POWER_K} x cannon power even at level 1 (power ${G.playerPower(S)})`);
console.log('all unit checks passed');
