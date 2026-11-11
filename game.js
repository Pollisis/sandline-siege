/* Sandline Siege - pure game logic (no DOM). Works in browser (window.SandGame) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SandGame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANES = 5, ROWS = 6, SLOTS = 10, KILLS_PER_LEVEL = 25, WALL_HP = 40;
  // Two barricades split down the middle of lane 3 (index 2):
  // West covers lanes 1-2 + half of lane 3, East covers half of lane 3 + lanes 4-5.
  const WALLS = [[0, 1, 2], [2, 3, 4]];
  const WALL_SPANS = [[0, 2.5], [2.5, 5]]; // in lane units, for drawing
  const laneWalls = (l) => (l < 2 ? [0] : l > 2 ? [1] : [0, 1]);
  const laneWall = (l) => laneWalls(l)[0];

  const TYPES = {
    crawler:   { name: 'Dune Crawler',  w: 1, pts: 100, hp: 1.0, dmg: 2, desc: 'Common desert crawler. Takes one lane.' },
    giant:     { name: 'Giant Crawler', w: 2, pts: 200, hp: 3.0, dmg: 4, desc: 'Huge and armored. Spans two lanes, so cannons in both lanes hit it.' },
    queen:     { name: 'Brood Queen',   w: 2, pts: 200, hp: 2.6, dmg: 4, desc: 'When slain she bursts into 3 Hatchlings (20% of her HP each) side by side where she fell.' },
    hatchling: { name: 'Hatchling',     w: 1, pts: 60,  hp: 0.2, dmg: 2, desc: 'Small and quick to squash. Counts as a kill.' },
  };
  const ITEMS = ['spray', 'fire', 'super', 'bomb'];
  const ITEM_INFO = {
    spray: { name: 'Bug Spray', desc: 'Fully repairs your most damaged wall (even a broken one) and pushes every bug back one row. Bugs pushed off the top still pay their points.' },
    fire:  { name: 'Extra Firepower', desc: 'Tap a bug to blast it for 50% of your total cannon power.' },
    super: { name: 'Super Component', desc: 'Tap a cannon numbered 32 or lower to double it.' },
    bomb:  { name: 'Sand Bomb', desc: 'Tap a tile: every bug in the 3x3 area around it loses half of its max HP.' },
  };

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Tunables
  const baseHp = (level) => Math.round(30 * Math.pow(1.27, level - 1));
  const bonusPct = (level) => 5 * (level - 1);
  const spawnTurretValue = (level) => Math.pow(2, 1 + Math.min(4, Math.floor((level - 1) / 4))); // 2,4,8..
  const bubbleValue = (level) => spawnTurretValue(level) * 2;
  const BUBBLE_CHANCE = 0.12, BUBBLE_TTL = 4, ITEM_DROP_CHANCE = 0.04;
  const wallDmg = (type, level) => TYPES[type].dmg + Math.floor((level - 1) / 4);
  const totalAttack = (S) => S.tray.reduce((a, b) => a + b, 0);
  const lanesOf = (e) => (e.w === 2 ? [e.lane, e.lane + 1] : [e.lane]);

  function newGame(seed) {
    if (seed === undefined) seed = (Math.random() * 2 ** 31) | 0;
    const S = {
      seed, level: 1, kills: 0, totalKills: 0, score: 0, turn: 0,
      walls: [{ hp: WALL_HP, max: WALL_HP }, { hp: WALL_HP, max: WALL_HP }],
      tray: [4, 2, 4, 2, 4, 2, 2, 0, 0, 0], // index = row*5 + lane, row 0 = front (nearest wall)
      enemies: [], bubbles: [],
      items: { spray: 1, fire: 1, super: 1, bomb: 1 },
      over: false, nextId: 1,
    };
    Object.defineProperty(S, 'rand', { value: makeRng(seed), enumerable: false, writable: true });
    spawnEnemy(S, 'crawler', 1, 0, []);
    spawnEnemy(S, 'crawler', 3, 1, []);
    return S;
  }

  function occupant(S, row, lane, ignoreId) {
    for (const e of S.enemies) {
      if (e.id === ignoreId || e.row !== row) continue;
      if (lane >= e.lane && lane < e.lane + e.w) return e;
    }
    return null;
  }
  function cellsFree(S, row, lane, w, ignoreId) {
    if (row < 0 || row >= ROWS || lane < 0 || lane + w > LANES) return false;
    for (let l = lane; l < lane + w; l++) if (occupant(S, row, l, ignoreId)) return false;
    return true;
  }

  function spawnEnemy(S, type, lane, row, ev, hpOverride) {
    const T = TYPES[type];
    const hp = hpOverride || Math.max(1, Math.round(baseHp(S.level) * T.hp));
    const e = { id: S.nextId++, type, lane, row, w: T.w, hp, maxHp: hp };
    S.enemies.push(e);
    ev.push({ type: 'spawn', id: e.id });
    return e;
  }

  function targetInLane(S, lane) {
    let best = null;
    for (const e of S.enemies) {
      if (lane < e.lane || lane >= e.lane + e.w) continue;
      if (!best || e.row > best.row) best = e;
    }
    return best;
  }

  const awardPts = (S, pts) => { const p = Math.round(pts * (1 + bonusPct(S.level) / 100)); S.score += p; return p; };

  function killEnemy(S, e, ev) {
    S.enemies.splice(S.enemies.indexOf(e), 1);
    const pts = awardPts(S, TYPES[e.type].pts);
    S.kills++; S.totalKills++;
    ev.push({ type: 'kill', id: e.id, enemy: e, pts });
    if (e.type === 'queen') {
      const hp = Math.max(1, Math.round(e.maxHp * 0.2));
      const L = e.lane, R = e.row;
      // 3 hatchlings side by side in the same row, covering her 2 lanes (e.g. lanes 4-5 -> 3,4,5)
      const starts = [L - 1, L].filter((st) => st >= 0 && st + 2 < LANES);
      starts.sort((a, b) => [0, 1, 2].filter((k) => cellsFree(S, R, b + k, 1)).length - [0, 1, 2].filter((k) => cellsFree(S, R, a + k, 1)).length || (S.rand() - 0.5));
      const st = starts[0];
      const cand = [[R, st], [R, st + 1], [R, st + 2], [R - 1, L], [R - 1, L + 1], [R + 1, L], [R + 1, L + 1], [R - 1, st], [R - 1, st + 2]];
      let n = 0;
      for (const [r, l] of cand) {
        if (n >= 3) break;
        if (cellsFree(S, r, l, 1)) { const h = spawnEnemy(S, 'hatchling', l, r, ev, hp); h.fromQueen = e.id; n++; }
      }
    }
    if (S.rand() < BUBBLE_CHANCE) {
      const b = { id: S.nextId++, lane: e.lane + (e.w === 2 ? 0.5 : 0), row: e.row, value: bubbleValue(S.level), ttl: BUBBLE_TTL };
      S.bubbles.push(b);
      ev.push({ type: 'bubble', id: b.id });
    }
    if (S.rand() < ITEM_DROP_CHANCE) {
      const it = ITEMS[(S.rand() * ITEMS.length) | 0];
      S.items[it]++;
      ev.push({ type: 'itemDrop', item: it });
    }
  }

  function damage(S, e, dmg, ev) {
    e.hp -= dmg;
    if (e.hp <= 0) { killEnemy(S, e, ev); return true; }
    return false;
  }

  function checkLevel(S, ev) {
    while (S.kills >= KILLS_PER_LEVEL) {
      S.kills -= KILLS_PER_LEVEL;
      S.level++;
      const it = ITEMS[(S.rand() * ITEMS.length) | 0];
      S.items[it]++;
      ev.push({ type: 'levelUp', level: S.level, item: it, bonus: bonusPct(S.level) });
    }
  }

  function hasLegalMove(S) {
    const filled = S.tray.filter((v) => v).length;
    if (filled && filled < SLOTS) return true;
    for (let i = 0; i < SLOTS; i++) for (let j = i + 1; j < SLOTS; j++) if (S.tray[i] && S.tray[i] === S.tray[j]) return true;
    return false;
  }

  // ---- Player move (one turn): drag onto empty slot (move) or onto an equal number (merge) ----
  function playerMove(S, a) {
    const ev = [];
    if (S.over) return { ok: false, msg: 'Game over' };
    if (a.type === 'pass') {
      if (hasLegalMove(S)) return { ok: false, msg: 'You still have a move' };
      ev.push({ type: 'pass' });
    } else if (a.type === 'move') {
      const { from, to } = a;
      if (from === to || !S.tray[from] || to < 0 || to >= SLOTS) return { ok: false, msg: 'Invalid move' };
      if (!S.tray[to]) { S.tray[to] = S.tray[from]; S.tray[from] = 0; ev.push({ type: 'moveT', from, to }); }
      else if (S.tray[to] === S.tray[from]) { S.tray[to] *= 2; S.tray[from] = 0; ev.push({ type: 'merge', from, to, value: S.tray[to] }); }
      else return { ok: false, msg: 'Only matching numbers merge' };
      S.lastVacated = from;
    } else return { ok: false, msg: 'Unknown move' };
    return { ok: true, events: ev };
  }

  // ---- Turn step 1: every cannon fires up its lane ----
  function fire(S) {
    const ev = [];
    for (let lane = 0; lane < LANES; lane++) {
      for (const r of [0, 1]) {
        const slot = r * LANES + lane, v = S.tray[slot];
        if (!v) continue;
        const t = targetInLane(S, lane);
        if (!t) { ev.push({ type: 'shot', slot, lane, dmg: v, targetId: null }); continue; }
        ev.push({ type: 'shot', slot, lane, dmg: v, targetId: t.id, killed: t.hp <= v });
        damage(S, t, v, ev);
      }
    }
    checkLevel(S, ev);
    return ev;
  }

  // ---- Turn step 2: bottom-row bugs headbutt walls, others step down, a new bug spawns, a new cannon appears ----
  function advance(S) {
    const ev = [];
    if (S.over) return ev;
    const sorted = S.enemies.slice().sort((a, b) => b.row - a.row);
    for (const e of sorted) {
      if (e.row !== ROWS - 1) continue;
      // Damage is shared equally by the intact walls this bug touches (lane 3 touches both).
      const ws = [...new Set(lanesOf(e).flatMap(laneWalls))].filter((w) => S.walls[w].hp > 0);
      if (!ws.length) { S.enemies.splice(S.enemies.indexOf(e), 1); ev.push({ type: 'breach', id: e.id }); continue; }
      const d = wallDmg(e.type, S.level) / ws.length;
      for (const wi of ws) {
        const W = S.walls[wi];
        W.hp = Math.max(0, W.hp - d);
        ev.push({ type: 'wallHit', wall: wi, dmg: d, id: e.id });
        if (W.hp === 0) ev.push({ type: 'wallBreak', wall: wi });
      }
    }
    for (const e of sorted) {
      if (!S.enemies.includes(e) || e.row >= ROWS - 1) continue;
      if (cellsFree(S, e.row + 1, e.lane, e.w, e.id)) { e.row++; ev.push({ type: 'move', id: e.id }); }
    }
    // bubbles drift and expire
    for (const b of S.bubbles.slice()) {
      b.ttl--;
      if (b.ttl <= 0) { S.bubbles.splice(S.bubbles.indexOf(b), 1); ev.push({ type: 'bubblePop', id: b.id }); }
    }
    spawn(S, ev);
    // auto-spawn a new low cannon (prefer the slot just vacated)
    let slot = S.lastVacated != null && !S.tray[S.lastVacated] ? S.lastVacated : S.tray.indexOf(0);
    S.lastVacated = null;
    if (slot >= 0) { const v = spawnTurretValue(S.level); S.tray[slot] = v; ev.push({ type: 'newTurret', slot, value: v }); }
    S.turn++;
    if (S.walls[0].hp <= 0 && S.walls[1].hp <= 0) { S.over = true; ev.push({ type: 'gameOver' }); }
    return ev;
  }

  function pickType(S) {
    const L = S.level;
    const w = [['crawler', 70], ['giant', L >= 2 ? 8 + 2 * L : 4], ['queen', L >= 2 ? 4 + 2 * L : 2]];
    let r = S.rand() * w.reduce((a, b) => a + b[1], 0);
    for (const [t, x] of w) { if ((r -= x) < 0) return t; }
    return 'crawler';
  }

  function spawnAtTop(S, type, ev) {
    const w = TYPES[type].w, opts = [];
    for (let l = 0; l + w <= LANES; l++) if (cellsFree(S, 0, l, w)) opts.push(l);
    if (!opts.length) return null;
    return spawnEnemy(S, type, opts[(S.rand() * opts.length) | 0], 0, ev);
  }

  function spawn(S, ev) {
    const bugs = S.enemies.length;
    if (S.rand() < Math.min(0.92, 0.8 + 0.01 * S.level) || bugs < 2) {
      if (!spawnAtTop(S, pickType(S), ev)) spawnAtTop(S, 'crawler', ev);
    }
  }

  // ---- Free actions (no turn used) ----
  function collectBubble(S, id) {
    const b = S.bubbles.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Gone' };
    const slot = S.tray.indexOf(0);
    if (slot < 0) return { ok: false, msg: 'Tray is full - merge to make room' };
    S.bubbles.splice(S.bubbles.indexOf(b), 1);
    S.tray[slot] = b.value;
    return { ok: true, events: [{ type: 'collect', id, slot, value: b.value }] };
  }

  function useItem(S, item, arg) {
    const ev = [];
    if (S.over || !S.items[item]) return { ok: false, msg: 'None left' };
    if (item === 'spray') {
      let wi = 0;
      if (S.walls[1].hp / S.walls[1].max < S.walls[0].hp / S.walls[0].max) wi = 1;
      S.walls[wi].hp = S.walls[wi].max;
      ev.push({ type: 'repair', wall: wi });
      for (const e of S.enemies.slice().sort((a, b) => a.row - b.row)) {
        if (e.row === 0) {
          S.enemies.splice(S.enemies.indexOf(e), 1);
          ev.push({ type: 'pushedOff', id: e.id, enemy: e, pts: awardPts(S, TYPES[e.type].pts) });
        } else if (cellsFree(S, e.row - 1, e.lane, e.w, e.id)) e.row--;
      }
    } else if (item === 'fire') {
      const e = S.enemies.find((x) => x.id === arg);
      if (!e) return { ok: false, msg: 'Tap a bug' };
      const dmg = Math.max(1, Math.ceil(totalAttack(S) * 0.5));
      ev.push({ type: 'blast', id: e.id, dmg, killed: e.hp <= dmg });
      damage(S, e, dmg, ev);
      checkLevel(S, ev);
    } else if (item === 'super') {
      const v = S.tray[arg];
      if (!v || v > 32) return { ok: false, msg: 'Tap a cannon of 32 or less' };
      S.tray[arg] = v * 2; ev.push({ type: 'super', slot: arg, value: v * 2 });
    } else if (item === 'bomb') {
      const { row, lane } = arg || {};
      if (row == null || lane == null) return { ok: false, msg: 'Tap a tile' };
      ev.push({ type: 'bomb', row, lane });
      const hit = S.enemies.filter((e) => Math.abs(e.row - row) <= 1 && lanesOf(e).some((l) => Math.abs(l - lane) <= 1));
      for (const e of hit) {
        if (!S.enemies.includes(e)) continue;
        const dmg = Math.ceil(e.maxHp / 2);
        ev.push({ type: 'blast', id: e.id, dmg, killed: e.hp <= dmg });
        damage(S, e, dmg, ev);
      }
      checkLevel(S, ev);
    } else return { ok: false, msg: 'Unknown item' };
    S.items[item]--;
    return { ok: true, events: ev };
  }

  function takeTurn(S, action) {
    const r = playerMove(S, action);
    if (!r.ok) return r;
    return { ok: true, events: r.events.concat(fire(S), advance(S)) };
  }

  return { LANES, ROWS, SLOTS, KILLS_PER_LEVEL, WALL_HP, WALLS, WALL_SPANS, laneWalls, TYPES, ITEMS, ITEM_INFO, laneWall,
    newGame, playerMove, fire, advance, useItem, collectBubble, takeTurn, hasLegalMove, targetInLane,
    totalAttack, bonusPct, baseHp, spawnTurretValue, lanesOf, makeRng };
});
