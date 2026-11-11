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
- 25 kills = next Defense Level: tougher scorpions, bigger field cannons, +5% points and one random power-up charge.
- New scorpion HP = max(level curve, 0.4 x your firepower) with ±15% randomness, where firepower = all tray cannons + pocket. Stronger cannons bring stronger scorpions.
- Every merge tier (1, 2, 4 ... 2048+) has its own cannon design and colour: Driftwood Stub, Crimson Pot, Emerald Longgun, Bronze Bell, Teal Spiker, Twin Amethyst, Violet Mortar, Copper Drake, Copper Gatling, Glass Crystal, Royal Gold, Sunburst.
- Power-ups are earned: you start with 1 Bug Spray and nothing else. Giants and Brood Queens drop a charge 40% of the time; every level-up gives one. Each power-up can be used at most 10 times per game. Using one is a free action. Bug Spray, Extra Firepower, Super Component. (No stamina/fuel system.)
- Brood Queen: however she dies (exact kill, overkill, carry-through, Extra Firepower, Bug Spray), 3 Hatchlings with 20% of her HP appear where she fell on the next move. Surplus damage never hits them.

## Files
- `game.js`: pure game logic (browser + Node)
- `main.js`: animation, input, HUD, dialogs (settings, high scores)
- `assets/`: original raster sprites (12 cannon tiers, 4 scorpions, eggs, glass orb, 3 power-ups, barricade intact/smashed, desert background, tray tile), AI-generated for this game, cut out to transparent WebP (~0.7 MB total)
- `art.js`: preloads `assets/` (loading bar) and draws them; the original procedural canvas art stays as a fallback if any image fails to load
- `audio.js`: original WebAudio music loop (D Phrygian-dominant oud, drone and doumbek, ~38 s) and sound effects; Music/SFX volume and mute saved in localStorage
- `tests/unit.js`: rule checks; `tests/sim.js`: balance and invariant simulation; `tests/e2e.js`: Playwright browser test with screenshots

## Tuning knobs (top of game.js)
`POWER_K`, `HP_JITTER`, `EARN_CHANCE_BIG`, `START_ITEMS`, `HP_BASE`, `HP_GROWTH`, `pickupExp`, `PICKUP_CHANCE`, `PICKUP_DRY_TURNS`, `PICKUP_BONUS_CHANCE`, `ITEM_USES`, `KILLS_PER_LEVEL`, spawn weights in `pickType`, early spawn rates in `spawn`.

## High scores
Top 10 (name, score, level, date) are stored per device in localStorage. A shared online leaderboard would need a small backend (for example a Render web service with a Neon Postgres database); it is not built.
