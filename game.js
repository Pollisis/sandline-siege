/* Sandline Siege - pure game logic (no DOM). Works in browser (window.SandGame) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SandGame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANES = 5, ROWS = 6, SLOTS = 10, POCKET = 10, KILLS_PER_LEVEL = 25, ITEM_USES = 10;
  // Two barricade sections split down the middle of lane 3 (index 2).
  const WALLS = [[0, 1, 2], [2, 3, 4]];
  const WALL_SPANS = [[0, 2.5], [2.5, 5]]; // lane units, for drawing
  const laneWalls = (l) => (l < 2 ? [0] : l > 2 ? [1] : [0, 1]);

  const TYPES = {
    crawler:   { name: 'Dune Crawler',  w: 1, pts: 100, hp: 1.0, desc: 'The common sand scorpion. Takes one lane.' },
    giant:     { name: 'Giant Crawler', w: 2, pts: 200, hp: 3.0, desc: 'Huge and armored. 2 lanes wide, so cannons in both lanes hit it.' },
    queen:     { name: 'Brood Queen',   w: 2, pts: 200, hp: 2.5, desc: '2 lanes wide. When slain, by any means, 3 Hatchlings (20% of her HP each) hatch where she fell on the next move.' },
    hatchling: { name: 'Hatchling',     w: 1, pts: 60,  hp: 0.2, desc: 'Small and quick to squash. Counts as a kill.' },
    pickup:    { name: 'Field Cannon',  w: 1, pts: 0,   hp: 0,   desc: 'Shoot it to collect it. It drops into your pocket.' },
  };
  const ITEMS = ['spray', 'fire', 'super'];
  const ITEM_INFO = {
    spray: { name: 'Bug Spray', desc: 'Repairs a destroyed barricade and drives off the scorpions closest to it, earning their points.' },
    fire:  { name: 'Extra Firepower', desc: 'Tap a scorpion: it takes damage equal to 50% of the total attack of all your cannons.' },
    super: { name: 'Super Component', desc: 'Tap a cannon with attack 32 or less to double it.' },
  };

  // Serializable RNG (state lives in S.rs so a state can be cloned with JSON).
  function rand(S) {
    S.rs = (S.rs + 0x6D2B79F5) | 0;
    let t = Math.imul(S.rs ^ (S.rs >>> 15), 1 | S.rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- Tunables ----
  const HP_BASE = 2, HP_GROWTH = 1.45;
  const baseHp = (level) => Math.max(2, Math.round(HP_BASE * Math.pow(HP_GROWTH, level - 1)));
  const bonusPct = (level) => 5 * (level - 1);
  const pickupExp = (level) => Math.min(10, Math.floor((level - 1) / 2.4));
  const EARN_CHANCE_BIG = 0.4, START_ITEMS = { spray: 1, fire: 0, super: 0 };
  // Scorpion HP keeps up with the player's cannons: max(level curve, POWER_K * cannon power) +/- HP_JITTER
  const POWER_K = 0.4, HP_JITTER = 0.15;
  const SUPER_MAX = 32; // Super Component doubles cannons of value <= 32
  const playerPower = (S) => totalAttack(S) + S.pocket;
  const PICKUP_CHANCE = 0.4, PICKUP_DRY_TURNS = 3, PICKUP_BONUS_CHANCE = 0.3;
  const totalAttack = (S) => S.tray.reduce((a, b) => a + b, 0);
  const lanesOf = (e) => (e.w === 2 ? [e.lane, e.lane + 1] : [e.lane]);
  const isBug = (e) => e.type !== 'pickup';
  const clone = (S) => JSON.parse(JSON.stringify(S));

  function newGame(seed) {
    if (seed === undefined) seed = (Math.random() * 2 ** 31) | 0;
    const S = {
      seed, rs: seed | 0 || 1, level: 1, kills: 0, totalKills: 0, score: 0, turn: 0,
      walls: [true, true], wallHits: 0,
      tray: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], // index = row*5 + lane, row 0 = front (nearest the barricades)
      pocket: 0,
      enemies: [], // scorpions and field cannons (type 'pickup')
      items: { spray: START_ITEMS.spray, fire: START_ITEMS.fire, super: START_ITEMS.super }, itemUsed: { spray: 0, fire: 0, super: 0 }, brood: [],
      over: false, nextId: 1, dry: 0,
    };
    spawnEnemy(S, 'crawler', 0, 0, []);
    spawnEnemy(S, 'pickup', 2, 1, [], 1);
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

  function spawnEnemy(S, type, lane, row, ev, valueOrHp) {
    const T = TYPES[type];
    let e;
    if (type === 'pickup') e = { id: S.nextId++, type, lane, row, w: 1, value: valueOrHp, hp: 1, maxHp: 1 };
    else {
      const base = Math.max(baseHp(S.level), POWER_K * playerPower(S)) * (1 - HP_JITTER + 2 * HP_JITTER * rand(S));
      const hp = valueOrHp || Math.max(1, Math.round(base * T.hp));
      e = { id: S.nextId++, type, lane, row, w: T.w, hp, maxHp: hp };
    }
    S.enemies.push(e);
    ev.push({ type: 'spawn', id: e.id });
    return e;
  }

  // First thing (scorpion or field cannon) in a lane, closest to the barricades.
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
    onBigDeath(S, e, ev);
  }

  // Brood Queen / Giant deaths (any cause): queue the brood, maybe drop a power-up charge.
  function onBigDeath(S, e, ev) {
    if (e.type === 'queen') {
      S.brood.push({ row: e.row, lane: e.lane, hp: Math.max(1, Math.round(e.maxHp * 0.2)), from: e.id });
      ev.push({ type: 'broodPending', id: e.id });
    }
    if ((e.type === 'queen' || e.type === 'giant') && rand(S) < EARN_CHANCE_BIG) earnItem(S, ev, e.type, e);
  }

  function earnItem(S, ev, source, e) {
    const avail = ITEMS.filter((k) => S.itemUsed[k] + S.items[k] < ITEM_USES);
    if (!avail.length) return;
    const k = avail[(rand(S) * avail.length) | 0];
    S.items[k]++;
    ev.push({ type: 'itemEarned', item: k, source, lane: e ? e.lane + (e.w - 1) / 2 : null, row: e ? e.row : null });
  }

  // Hatchlings appear on the move after the Queen dies: in her row, across her 2 lanes plus one adjacent lane.
  function resolveBrood(S, ev) {
    const list = S.brood; S.brood = [];
    for (const b of list) {
      const L = b.lane, R = b.row;
      const st = L - 1 >= 0 && (L + 2 >= LANES || rand(S) < 0.5) ? L - 1 : Math.min(L, LANES - 3);
      const want = [st, st + 1, st + 2];
      for (const lane of want) {
        let placed = null;
        for (const r of [R, R - 1, R - 2, R + 1]) {
          if (r < 0 || r >= ROWS) continue;
          const order = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((d) => lane + d).filter((l) => l >= 0 && l < LANES);
          for (const l of order) if (cellsFree(S, r, l, 1)) { placed = [r, l]; break; }
          if (placed) break;
        }
        if (placed) { const h = spawnEnemy(S, 'hatchling', placed[1], placed[0], ev, b.hp); h.fromQueen = b.from; ev.push({ type: 'hatch', id: h.id, from: b.from }); }
      }
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
      ev.push({ type: 'levelUp', level: S.level, bonus: bonusPct(S.level) });
      earnItem(S, ev, 'level', null);
    }
  }

  // Collected field cannons: only one per turn; the highest value wins and replaces the pocket.
  function resolveCollected(S, got, ev) {
    if (!got.length) return;
    got.sort((a, b) => b.value - a.value);
    const win = got[0];
    const replaced = S.pocket;
    S.pocket = win.value;
    ev.push({ type: 'collect', id: win.id, value: win.value, replaced, lost: got.slice(1).map((g) => ({ id: g.id, value: g.value })) });
  }

  // ---- Player move (one turn). Slots 0-9 = tray, 10 = pocket. ----
  const getSlot = (S, i) => (i === POCKET ? S.pocket : S.tray[i]);
  const setSlot = (S, i, v) => { if (i === POCKET) S.pocket = v; else S.tray[i] = v; };

  function playerMove(S, a) {
    const ev = [];
    if (S.over) return { ok: false, msg: 'Game over' };
    if (a.type !== 'move') return { ok: false, msg: 'Unknown move' };
    const { from, to } = a;
    const ok = (i) => Number.isInteger(i) && i >= 0 && i <= POCKET;
    if (!ok(from) || !ok(to) || from === to || !getSlot(S, from)) return { ok: false, msg: 'Invalid move' };
    const vf = getSlot(S, from), vt = getSlot(S, to);
    // Parking a cannon in an EMPTY pocket is free: no shots, scorpions don't advance.
    if (to === POCKET && !vt) { setSlot(S, to, vf); setSlot(S, from, 0); ev.push({ type: 'moveT', from, to, value: vf, free: true }); return { ok: true, free: true, events: ev }; }
    if (!vt) { setSlot(S, to, vf); setSlot(S, from, 0); ev.push({ type: 'moveT', from, to, value: vf }); }
    else if (vt === vf) { setSlot(S, to, vf * 2); setSlot(S, from, 0); ev.push({ type: 'merge', from, to, value: vf * 2 }); }
    else { setSlot(S, to, vf); setSlot(S, from, vt); ev.push({ type: 'swap', from, to }); }
    return { ok: true, free: false, events: ev };
  }
  const isFreeMove = (S, a) => a && a.to === POCKET && a.from !== POCKET && !S.pocket && !!getSlot(S, a.from);

  // ---- Turn step 1: every tray cannon fires up its lane ----
  // Overkill carries through: surplus damage continues to the next thing behind in the same lane.
  // Field cannons are collected when the shot reaches them and do not absorb any damage.
  function fire(S) {
    const ev = [], got = [];
    for (let lane = 0; lane < LANES; lane++) {
      for (const r of [0, 1]) {
        const slot = r * LANES + lane, v = S.tray[slot];
        if (!v) continue;
        const hits = [];
        let left = v;
        const inLane = S.enemies.filter((e) => lane >= e.lane && lane < e.lane + e.w).sort((a, b) => b.row - a.row);
        for (const t of inLane) {
          if (left <= 0) break;
          if (!S.enemies.includes(t)) continue;
          if (t.type === 'pickup') {
            S.enemies.splice(S.enemies.indexOf(t), 1);
            got.push(t);
            hits.push({ targetId: t.id, pickup: true, row: t.row });
            continue;
          }
          const dmg = Math.min(left, t.hp), killed = t.hp <= left;
          hits.push({ targetId: t.id, dmg, killed, row: t.row });
          left -= dmg;
          damage(S, t, dmg, ev);
        }
        // first hit kept on the event for compatibility
        ev.push({ type: 'shot', slot, lane, dmg: v, hits, targetId: hits.length ? hits[0].targetId : null, killed: !!(hits[0] && hits[0].killed), pickup: !!(hits[0] && hits[0].pickup), surplus: left });
      }
    }
    resolveCollected(S, got, ev);
    checkLevel(S, ev);
    return ev;
  }

  // ---- Turn step 2: scorpions at the barricades smash through, others step down, new things spawn ----
  function advance(S) {
    const ev = [];
    if (S.over) return ev;
    const sorted = S.enemies.slice().sort((a, b) => b.row - a.row);
    let hitThisMove = -1; // scorpions reaching the wall on the same move count as ONE hit
    for (const e of sorted) {
      if (e.row !== ROWS - 1) continue;
      S.enemies.splice(S.enemies.indexOf(e), 1);
      if (!isBug(e)) { ev.push({ type: 'pickupLost', id: e.id }); continue; }
      const touched = [...new Set(lanesOf(e).flatMap(laneWalls))];
      if (hitThisMove >= 0) { ev.push({ type: 'wallHit', id: e.id, wall: hitThisMove, fatal: false, same: true }); continue; }
      if (S.wallHits >= 1) {
        S.wallHits++; S.over = true;
        ev.push({ type: 'wallHit', id: e.id, wall: touched.find((w) => S.walls[w]) ?? touched[0], fatal: true });
        break;
      }
      const intact = touched.filter((w) => S.walls[w]);
      const wi = intact.length ? intact[(rand(S) * intact.length) | 0] : touched[0];
      S.walls[wi] = false; S.wallHits = 1; hitThisMove = wi;
      ev.push({ type: 'wallHit', id: e.id, wall: wi, fatal: false });
    }
    if (S.over) { ev.push({ type: 'gameOver' }); S.turn++; return ev; }
    for (const e of sorted) {
      if (!S.enemies.includes(e) || e.row >= ROWS - 1) continue;
      if (cellsFree(S, e.row + 1, e.lane, e.w, e.id)) { e.row++; ev.push({ type: 'move', id: e.id }); }
    }
    resolveBrood(S, ev);
    spawn(S, ev);
    S.turn++;
    return ev;
  }

  function pickType(S) {
    const L = S.level;
    const w = [['crawler', 70], ['giant', L >= 2 ? 8 + 2 * L : 3], ['queen', L >= 3 ? 5 + 2 * L : 0]];
    let r = rand(S) * w.reduce((a, b) => a + b[1], 0);
    for (const [t, x] of w) { if ((r -= x) < 0) return t; }
    return 'crawler';
  }

  function topLanes(S, w) { const o = []; for (let l = 0; l + w <= LANES; l++) if (cellsFree(S, 0, l, w)) o.push(l); return o; }

  function spawn(S, ev) {
    const bugs = S.enemies.filter(isBug).length;
    const early = S.turn < 8 ? 0.35 : S.turn < 20 ? 0.6 : 0.8;
    if (rand(S) < Math.min(0.92, early + 0.01 * S.level) || bugs < 1) {
      let t = pickType(S), o = topLanes(S, TYPES[t].w);
      if (!o.length) { t = 'crawler'; o = topLanes(S, 1); }
      if (o.length) spawnEnemy(S, t, o[(rand(S) * o.length) | 0], 0, ev);
    }
    // Field cannons: random chance, guaranteed after a dry spell (or when the player is short of cannons).
    const onField = S.enemies.some((e) => e.type === 'pickup');
    const owned = S.tray.filter((v) => v).length + (S.pocket ? 1 : 0);
    S.dry++;
    if (rand(S) < PICKUP_CHANCE || (!onField && (S.dry >= PICKUP_DRY_TURNS || owned < 3))) {
      let o = topLanes(S, 1);
      // when forced, prefer a lane the player can already shoot
      if (S.dry >= PICKUP_DRY_TURNS) { const armed = o.filter((l) => S.tray[l] || S.tray[l + LANES]); if (armed.length) o = armed; }
      if (o.length) {
        const exp = pickupExp(S.level) + (rand(S) < PICKUP_BONUS_CHANCE ? 1 : 0);
        spawnEnemy(S, 'pickup', o[(rand(S) * o.length) | 0], 0, ev, Math.pow(2, exp));
        S.dry = 0;
      }
    }
  }

  // ---- Items: free actions, max ITEM_USES each per game ----
  function frontBugs(S, wi) {
    const out = new Set();
    for (const l of WALLS[wi]) {
      let best = null;
      for (const e of S.enemies) if (isBug(e) && l >= e.lane && l < e.lane + e.w && (!best || e.row > best.row)) best = e;
      if (best) out.add(best);
    }
    return [...out];
  }

  function useItem(S, item, arg) {
    const ev = [];
    if (S.over) return { ok: false, msg: 'Game over' };
    if (S.itemUsed[item] >= ITEM_USES) return { ok: false, msg: `Used ${ITEM_USES} times already this game` };
    if (!S.items[item]) return { ok: false, msg: 'No charges. Slay Giants and Brood Queens or level up to earn more.' };
    if (item === 'spray') {
      const wi = S.walls.findIndex((w) => !w);
      if (wi < 0) return { ok: false, msg: 'Both barricades are intact' };
      S.walls[wi] = true; S.wallHits = 0;
      ev.push({ type: 'repair', wall: wi });
      for (const e of frontBugs(S, wi)) {
        S.enemies.splice(S.enemies.indexOf(e), 1);
        ev.push({ type: 'pushedOff', id: e.id, enemy: e, pts: awardPts(S, TYPES[e.type].pts) });
        onBigDeath(S, e, ev);
      }
    } else if (item === 'fire') {
      const e = S.enemies.find((x) => x.id === arg && isBug(x));
      if (!e) return { ok: false, msg: 'Tap a scorpion' };
      const dmg = Math.max(1, Math.ceil(totalAttack(S) * 0.5));
      ev.push({ type: 'blast', id: e.id, dmg, killed: e.hp <= dmg });
      damage(S, e, dmg, ev);
      checkLevel(S, ev);
    } else if (item === 'super') {
      const v = getSlot(S, arg);
      if (!v) return { ok: false, msg: 'Tap a cannon of 32 or less' };
      if (v > SUPER_MAX) return { ok: false, msg: 'Super Component only works on cannons of 32 or less' };
      setSlot(S, arg, v * 2); ev.push({ type: 'super', slot: arg, value: v * 2 });
    } else return { ok: false, msg: 'Unknown item' };
    S.items[item]--; S.itemUsed[item]++;
    return { ok: true, events: ev };
  }

  function takeTurn(S, action) {
    const r = playerMove(S, action);
    if (!r.ok) return r;
    if (r.free) return { ok: true, free: true, events: r.events };
    return { ok: true, events: r.events.concat(fire(S), advance(S)) };
  }

  // Damage preview for a pending move: what the NEXT volley would do to each target (incl. overkill carry-through).
  // Returns { free, hits: { [enemyId]: { dmg, kill } } }. Pure: works on a clone, S is untouched.
  function previewMove(S, a) {
    const C = clone(S); let free = false;
    if (a && a.from !== a.to) { const r = playerMove(C, a); if (!r.ok) return null; free = !!r.free; }
    const hits = {};
    if (free) return { free, hits };
    for (const e of fire(C)) if (e.type === 'shot') for (const h of e.hits) {
      if (h.pickup) continue;
      const o = hits[h.targetId] || (hits[h.targetId] = { dmg: 0, kill: false });
      o.dmg += h.dmg; if (h.killed) o.kill = true;
    }
    return { free, hits };
  }

  function legalMoves(S) {
    const m = [];
    for (let f = 0; f <= POCKET; f++) {
      if (!getSlot(S, f)) continue;
      for (let t = 0; t <= POCKET; t++) if (t !== f) m.push({ type: 'move', from: f, to: t });
    }
    return m;
  }

  return { LANES, ROWS, SLOTS, POCKET, KILLS_PER_LEVEL, ITEM_USES, WALLS, WALL_SPANS, laneWalls, TYPES, ITEMS, ITEM_INFO, playerPower, POWER_K,
    newGame, playerMove, fire, advance, useItem, takeTurn, legalMoves, previewMove, isFreeMove, SUPER_MAX, targetInLane, totalAttack, bonusPct,
    baseHp, pickupExp, lanesOf, isBug, clone, getSlot, rand };
});
