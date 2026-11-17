// Validation, profanity filter and anti-cheat sanity checks (pure; unit-tested in test.js)
const crypto = require('crypto');

const LIMITS = { nameMin: 1, nameMax: 16, scoreMax: 50_000_000, levelMax: 1000, killsMax: 200_000, turnsMax: 200_000 };
// game constants mirrored from game.js: 25 kills per level, max 200 pts per kill, +5% points per level,
// Bug Spray can drive off at most ~3 scorpions per use x 10 uses (points without a kill).
const KILLS_PER_LEVEL = 25, MAX_PTS = 200, SPRAY_BONUS_BUGS = 30;

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'fag', 'nigg', 'nigga', 'retard', 'rape', 'porn', 'penis', 'vagina', 'twat', 'wank', 'jizz', 'cum', 'tits', 'boob', 'nazi', 'hitler', 'kkk', 'sex', 'anal', 'dildo', 'piss', 'crap', 'damn', 'hell', 'arse', 'prick', 'spic', 'chink', 'kike', 'wetback', 'dyke', 'tranny', 'molest', 'pedo'];
// short words that only count as whole words (avoid blocking e.g. "Michelle", "Cassandra", "Scunthorpe")
const WHOLE_ONLY = new Set(['cum', 'sex', 'anal', 'hell', 'damn', 'crap', 'piss', 'arse', 'tits', 'kkk', 'spic', 'dick', 'cock', 'rape', 'fag', 'boob', 'prick']);
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const norm = (s) => s.toLowerCase().replace(/[0134578@$!|]/g, (c) => LEET[c] || c);

function isProfane(name) {
  const n = norm(name), squashed = n.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'), words = n.split(/[^a-z]+/).filter(Boolean);
  for (const w of BAD) {
    if (WHOLE_ONLY.has(w)) { if (words.includes(w) || words.includes(w + 's') || squashed === w) return true; }
    else if (squashed.includes(w.replace(/(.)\1+/g, '$1'))) return true;
  }
  return false;
}

function cleanName(raw) {
  if (typeof raw !== 'string') return { ok: false, msg: 'Name required' };
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return { ok: false, msg: 'Name must be 1-16 characters' };
  if (!/^[\p{L}\p{N} ._'\-]+$/u.test(name)) return { ok: false, msg: 'Letters, numbers, spaces and . _ \' - only' };
  if (isProfane(name)) return { ok: false, msg: 'Please pick a friendlier name' };
  return { ok: true, name };
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// Run tokens: stateless HMAC over runId + issue time (ms). One leaderboard entry per run (unique run_id in the DB).
const sign = (secret, runId, t) => crypto.createHmac('sha256', secret).update(`${runId}.${t}`).digest('hex').slice(0, 32);
function newRun(secret, now = Date.now()) { const runId = crypto.randomBytes(9).toString('base64url'); return { runId, t: now, sig: sign(secret, runId, now) }; }

function checkSubmission(b, secret, now = Date.now()) {
  if (!b || typeof b !== 'object') return { ok: false, msg: 'Bad request' };
  const n = cleanName(b.name); if (!n.ok) return n;
  const { score, level, kills, turns, runId, t, sig } = b;
  if (!int(score, 1, LIMITS.scoreMax)) return { ok: false, msg: 'Score out of range' };
  if (!int(level, 1, LIMITS.levelMax) || !int(kills, 0, LIMITS.killsMax) || !int(turns, 1, LIMITS.turnsMax)) return { ok: false, msg: 'Stats out of range' };
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(runId) || !Number.isInteger(t) || typeof sig !== 'string') return { ok: false, msg: 'Missing run token' };
  const good = sign(secret, runId, t);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return { ok: false, msg: 'Invalid run token' };
  if (t > now + 60_000 || now - t > 7 * 24 * 3600_000) return { ok: false, msg: 'Run token expired' };
  // --- sanity checks against the game's own rules ---
  if (level !== 1 + Math.floor(kills / KILLS_PER_LEVEL)) return { ok: false, msg: 'Level does not match kills' };
  const maxScore = Math.ceil((kills + SPRAY_BONUS_BUGS) * MAX_PTS * (1 + 0.05 * (level - 1)) * 1.02) + 50;
  if (score > maxScore) return { ok: false, msg: 'Score is not plausible for this run' };
  if (kills > turns * 20 + 40) return { ok: false, msg: 'Too many kills for the number of turns' };
  if (turns > 40 && now - t < turns * 120) return { ok: false, msg: 'Run finished too quickly' };
  return { ok: true, entry: { name: n.name, score, level, kills, turns, runId } };
}

module.exports = { LIMITS, isProfane, cleanName, newRun, sign, checkSubmission };
