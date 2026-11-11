// Focused rule checks: node tests/unit.js
const G = require('../game.js');
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('ok - ' + m); };
const R = G.ROWS - 1;
function fresh() { const S = G.newGame(1); S.enemies.length = 0; S.bubbles.length = 0; S.tray.fill(0); return S; }
assert(G.LANES === 5 && G.ROWS === 6 && G.SLOTS === 10, 'board is 5 lanes x 6 rows, tray 5x2');
// lane 3 (index 2) splits damage between both walls
let S = fresh(); S.enemies.push({ id: 99, type: 'crawler', lane: 2, row: R, w: 1, hp: 50, maxHp: 50 });
G.advance(S); assert(S.walls[0].hp === G.WALL_HP - 1 && S.walls[1].hp === G.WALL_HP - 1, 'lane-3 bug hits both walls for half damage each');
S.walls[0].hp = 0; const before = S.walls[1].hp; S.enemies = S.enemies.filter((e) => e.id === 99); G.advance(S);
assert(S.walls[1].hp === before - 2 && S.enemies.some((e) => e.id === 99), 'with West wall down, lane-3 bug deals full damage to East wall (no breach)');
S.walls[1].hp = 0; S.enemies = S.enemies.filter((e) => e.id === 99); G.advance(S);
assert(!S.enemies.some((e) => e.id === 99), 'lane 3 breaches only when both walls are down');
// lane 1 hits only West wall
S = fresh(); S.enemies.push({ id: 98, type: 'crawler', lane: 0, row: R, w: 1, hp: 50, maxHp: 50 }); G.advance(S);
assert(S.walls[0].hp === G.WALL_HP - 2 && S.walls[1].hp === G.WALL_HP, 'lane-1 bug hits only the West wall');
// queen is 2 wide; on death 3 hatchlings side by side covering her lanes
assert(G.TYPES.queen.w === 2 && G.TYPES.giant.w === 2, 'queen and giant are 2 lanes wide');
S = fresh(); S.enemies.push({ id: 97, type: 'queen', lane: 3, row: 2, w: 2, hp: 5, maxHp: 100 }); S.tray[3] = 8;
let ev = G.fire(S); let h = S.enemies.filter((e) => e.type === 'hatchling');
assert(h.length === 3 && h.every((e) => e.row === 2) && h.map((e) => e.lane).sort().join() === '2,3,4' && h.every((e) => e.maxHp === 20), 'queen at lanes 4-5 splits into 3 hatchlings at lanes 3,4,5 same row with 20% HP');
// both lanes' cannons hit a 2-wide bug
S = fresh(); S.enemies.push({ id: 96, type: 'giant', lane: 1, row: 1, w: 2, hp: 100, maxHp: 100 }); S.tray[1] = 8; S.tray[2] = 16; S.tray[7] = 4;
G.fire(S); assert(S.enemies[0].hp === 100 - 28, 'giant is hit by cannons in both of its lanes (front + back rows)');
console.log('all unit checks passed');
