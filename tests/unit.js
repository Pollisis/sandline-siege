// Focused rule checks: node tests/unit.js
const G = require('../game.js');
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('ok - ' + m); };
const R = G.ROWS - 1, P = G.POCKET;
function fresh() { const S = G.newGame(1); S.enemies.length = 0; S.tray.fill(0); S.pocket = 0; S.rs = 12345; return S; }
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
assert(S.pocket === 4 && !S.enemies.some((e) => e.id === 50) && S.enemies.find((e) => e.id === 51).hp === 5, 'a shot collects the first field cannon in the lane (absorbing the shot), scorpion behind is untouched');
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
S = fresh(); for (let i = 0; i < G.ITEM_USES; i++) { S.tray[0] = 1; G.useItem(S, 'super', 0); }
assert(S.items.super === 0 && !G.useItem(S, 'super', 0).ok, `each item is limited to ${G.ITEM_USES} uses per game`);

// 2-wide bugs
S = fresh(); S.enemies.push({ id: 97, type: 'queen', lane: 3, row: 2, w: 2, hp: 5, maxHp: 100 }); S.tray[3] = 8;
G.fire(S); const h = S.enemies.filter((e) => e.type === 'hatchling');
assert(h.length === 3 && h.every((e) => e.row === 2) && h.map((e) => e.lane).sort().join() === '2,3,4' && h.every((e) => e.maxHp === 20), 'queen at lanes 4-5 splits into 3 hatchlings at lanes 3,4,5 with 20% HP');
S = fresh(); S.enemies.push({ id: 96, type: 'giant', lane: 1, row: 1, w: 2, hp: 100, maxHp: 100 }); S.tray[1] = 8; S.tray[2] = 16; S.tray[7] = 4;
G.fire(S); assert(S.enemies[0].hp === 72, 'giant is hit by cannons in both of its lanes (front + back rows)');
console.log('all unit checks passed');
