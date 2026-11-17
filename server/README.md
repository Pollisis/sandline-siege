# Sandline Siege leaderboard

Tiny global high-score API for [Sandline Siege](https://pollisis.github.io/sandline-siege/). Plain Node `http` + Postgres on Neon (via `@neondatabase/serverless`). Hosted on Render.

## Endpoints
- `GET /health`: wake-up ping.
- `POST /runs`: returns a signed run token `{runId, t, sig}` (requested when a game starts).
- `POST /scores` `{name, score, level, kills, turns, runId, t, sig}` → `{id, rank, scores}`
- `GET /scores?limit=20` → `{scores: [{id, name, score, level, kills, date}]}`

## Rules
- Name 1-16 characters (letters, numbers, spaces, `. _ ' -`) with a profanity filter.
- Score is the in-game point total (1 to 50,000,000). Level must equal `1 + floor(kills / 25)`. The score must be reachable with that many kills (≤ 200 pts per kill + the level bonus), and the run must not finish faster than about 0.12 s per turn.
- One entry per run token. Tokens are HMAC-signed and expire after 7 days.
- Rate limits per IP: 120 requests/min, 40 runs and 8 submissions per 10 min.
- CORS: `https://pollisis.github.io` and `localhost` only.

Env: `DATABASE_URL`, `TOKEN_SECRET`, `PORT`. Run tests with `npm test`.
