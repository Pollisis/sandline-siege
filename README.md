# Sandline Siege

A turn-based merge-defense browser game. Hold the desert outpost against waves of giant crawlers.

**Play:** open `index.html` (any static host works, with no build step).

## How to play
- Drag a cannon onto an empty slot to move it, or onto a cannon with the same number to merge (8+8=16). Each drag is one turn.
- After each turn every cannon fires up its lane, the bugs step one row closer, a new bug appears at the top, and a fresh cannon drops into your tray.
- Slain bugs sometimes leave a bubble: tap it for a free cannon (doesn't use a turn).
- Bugs in the bottom row headbutt your walls. Lose both walls and it's game over.
- Every 25 kills raises the Defense Level: tougher bugs, +5% points bonus.
- Items (free): Bug Spray, Extra Firepower, Super Component, Sand Bomb.

## Files
- `game.js`: pure game logic (works in the browser and in Node)
- `main.js`: canvas rendering, input, WebAudio sound effects
- `tests/sim.js`: headless balance and invariant simulation (`node tests/sim.js 200`)
- `tests/e2e.js`: Playwright browser test with screenshots (`node tests/e2e.js http://localhost:8765/ shots`)

## Tuning knobs (game.js)
`baseHp`, `spawnTurretValue`, `bubbleValue`, `BUBBLE_CHANCE`, `ITEM_DROP_CHANCE`, `WALL_HP`, `wallDmg`, `KILLS_PER_LEVEL`, spawn weights in `pickType`.
