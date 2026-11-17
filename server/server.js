// Sandline Siege global leaderboard: tiny Node HTTP API backed by Postgres (Neon).
const http = require('http');
const crypto = require('crypto');
const { Pool, neonConfig } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = require('ws'); // Neon driver over WebSockets (port 443)
const { newRun, checkSubmission } = require('./rules');

const PORT = process.env.PORT || 10000;
const SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 30_000 });
pool.on('error', (e) => console.error('pool error', e.message));

const ALLOWED = [/^https:\/\/pollisis\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS scores (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(16) NOT NULL,
    score INTEGER NOT NULL CHECK (score > 0),
    level INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    turns INTEGER NOT NULL,
    run_id VARCHAR(24) NOT NULL UNIQUE,
    ip_hash CHAR(16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query('CREATE INDEX IF NOT EXISTS scores_rank ON scores (score DESC, created_at ASC)');
}

// in-memory sliding-window rate limits per IP
const hits = new Map();
function limited(ip, key, max, windowMs) {
  const k = key + '|' + ip, now = Date.now(), arr = (hits.get(k) || []).filter((x) => now - x < windowMs);
  arr.push(now); hits.set(k, arr); return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((x) => now - x < 3600_000)) hits.delete(k); }, 600_000).unref();

const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
const ipHash = (ip) => crypto.createHash('sha256').update(SECRET + ip).digest('hex').slice(0, 16);

function send(res, code, obj, origin) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) Object.assign(h, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
  res.writeHead(code, h); res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 4096) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
}
async function top(limit) {
  const r = await pool.query('SELECT id, name, score, level, kills, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT $1', [limit]);
  return r.rows.map((x) => ({ id: Number(x.id), name: x.name, score: x.score, level: x.level, kills: x.kills, date: x.created_at.toISOString().slice(0, 10) }));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin && ALLOWED.some((re) => re.test(req.headers.origin)) ? req.headers.origin : null;
  const url = new URL(req.url, 'http://x'), ip = ipOf(req);
  try {
    if (req.method === 'OPTIONS') return send(res, origin ? 204 : 403, {}, origin);
    if (req.headers.origin && !origin) return send(res, 403, { error: 'Origin not allowed' });
    if (url.pathname === '/health' || url.pathname === '/') return send(res, 200, { ok: true, service: 'sandline-leaderboard' }, origin);
    if (limited(ip, 'all', 120, 60_000)) return send(res, 429, { error: 'Too many requests, slow down' }, origin);
    if (url.pathname === '/runs' && req.method === 'POST') {
      if (limited(ip, 'runs', 40, 600_000)) return send(res, 429, { error: 'Too many runs started' }, origin);
      return send(res, 200, newRun(SECRET), origin);
    }
    if (url.pathname === '/scores' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      return send(res, 200, { scores: await top(limit) }, origin);
    }
    if (url.pathname === '/scores' && req.method === 'POST') {
      if (limited(ip, 'post', 8, 600_000)) return send(res, 429, { error: 'Too many submissions, try again later' }, origin);
      let b; try { b = await body(req); } catch (e) { return send(res, 400, { error: 'Bad JSON' }, origin); }
      const c = checkSubmission(b, SECRET);
      if (!c.ok) return send(res, 422, { error: c.msg }, origin);
      const e = c.entry;
      let row;
      try {
        row = (await pool.query('INSERT INTO scores (name, score, level, kills, turns, run_id, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [e.name, e.score, e.level, e.kills, e.turns, e.runId, ipHash(ip)])).rows[0];
      } catch (err) { if (err.code === '23505') return send(res, 409, { error: 'This run was already submitted' }, origin); throw err; }
      const rank = Number((await pool.query('SELECT COUNT(*) FROM scores WHERE score > $1', [e.score])).rows[0].count) + 1;
      return send(res, 201, { id: Number(row.id), rank, scores: await top(20) }, origin);
    }
    send(res, 404, { error: 'Not found' }, origin);
  } catch (err) {
    console.error(err); send(res, 500, { error: 'Server error' }, origin);
  }
});

migrate().then(() => server.listen(PORT, () => console.log('sandline-leaderboard listening on', PORT)))
  .catch((e) => { console.error('migration failed', e); process.exit(1); });
module.exports = server;
