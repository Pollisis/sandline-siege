# Sandline Siege

A turn-based merge-defense browser game: hold the desert outpost against sand scorpions.
Original canvas art, no build step. Play at https://pollisis.github.io/sandline-siege/

## Rules
- Field: 5 lanes x 6 rows. Your cannon tray: 5 x 2, plus a one-cannon **pocket** (bottom right).
- You start with a single cannon of value 1.
- Overkill carries through: leftover damage from a kill keeps going to the next target in the lane (field cannons are collected without absorbing damage).
- Each turn, drag one cannon: onto an empty square (move), onto the same number (merge, which doubles it), or onto a different number (swap). The pocket follows the same rules.
- After your move every tray cannon fires up its lane and hits the first thing in it. Then scorpions step one row and new things may appear at the top.
- **Field cannons** (blue bubbles) march down with the scorpions. Shoot one to collect it into the pocket. Only one is collected per turn (highest value wins), and it replaces whatever is in the pocket. A field cannon that reaches the barricades disappears.
- Two log barricades are split down the middle of lane 3. A scorpion that reaches a barricade smashes it and leaves. One hit is free; the second hit ends the run.
- 25 kills = next Defense Level: tougher scorpions, bigger field cannons, +5% points.
- Items, 10 uses each per game, free actions: Bug Spray, Extra Firepower, Super Component. (No stamina/fuel system.)

## Files
- `game.js`: pure game logic (browser + Node)
- `main.js`: canvas art, animation, input, WebAudio
- `tests/unit.js`: rule checks; `tests/sim.js`: balance and invariant simulation; `tests/e2e.js`: Playwright browser test with screenshots

## Tuning knobs (top of game.js)
`HP_BASE`, `HP_GROWTH`, `pickupExp`, `PICKUP_CHANCE`, `PICKUP_DRY_TURNS`, `PICKUP_BONUS_CHANCE`, `ITEM_USES`, `KILLS_PER_LEVEL`, spawn weights in `pickType`, early spawn rates in `spawn`.
