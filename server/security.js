// WortheyFlow security helpers (Phase 1 lockdown)
// - required secrets come from the environment only (no hardcoded fallbacks)
// - deny-by-default auth gate for /api/*
// - explicit public static-file allowlist
// - lead-level permissions
// - Twilio webhook signature validation, simple in-memory rate limiting
const crypto = require('crypto');
const path = require('path');

// ---------- Secrets ----------
// SHA-256 digests of the values that used to be hardcoded in server.js (they are in public
// git history). Used only to warn at startup when an env var still holds a leaked value.
const LEGACY_SECRET_SHA256 = {
    SUPABASE_SERVICE_ROLE_KEY: '54c139d500c39cb17f5b18e6e74949b5faeeedde725157233fe31ad359899245',
    JWT_SECRET: '301a4ddf94bdfd4fd9625dec0a12e70b81be191422960e0a02affa04b4f69d76',
    GHL_WEBHOOK_SECRET: '6461cd96920b6183eb0d2ddc1ef6ab175bd2d694d2cd40f51bb151888ae18d8b',
    AQUABOT_API_KEY: '0d5b891a7eb79a48da5d3f98d0d6b482d124fb47c6d8f2989706f1b9788c4ba0',
    REPORT_SECRET: '297a1c7d4e32cb45b39c2ce3bbec75e1bb9349ba75bedde6b8ba198ed400ff70'
};
const REQUIRED_SECRETS = Object.keys(LEGACY_SECRET_SHA256);

function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

// Reads all required secrets from process.env. Logs presence (never values) and exits
// with [FATAL] if any is missing, so a misconfigured deploy fails instead of running
// with a guessable default. On Render the previous deploy keeps serving in that case.
function loadRequiredSecrets(env = process.env) {
    const missing = REQUIRED_SECRETS.filter(k => !env[k] || !String(env[k]).trim());
    for (const k of REQUIRED_SECRETS) {
        if (missing.includes(k)) { console.log(`[ENV] ${k}: MISSING`); continue; }
        const leaked = sha256(env[k]) === LEGACY_SECRET_SHA256[k];
        console.log(`[ENV] ${k}: set${leaked ? ' (WARNING: still the old value from git history — rotate it)' : ''}`);
    }
    if (missing.length) {
        console.error(`[FATAL] Missing required env var(s): ${missing.join(', ')}. Set them in Render > Environment (or server/.env locally). Refusing to start.`);
        process.exit(1);
    }
    const out = {};
    for (const k of REQUIRED_SECRETS) out[k] = String(env[k]).trim();
    return out;
}

// Constant-time string comparison for shared secrets.
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

// ---------- Static files ----------
// Only these files from the repo root are served. Everything else (data dumps, server/,
// marketing/, .env, logs, node_modules, ...) is never exposed.
const PUBLIC_FILES = new Set([
    'index.html', 'app.js', 'style.css', 'manifest.json',
    'logo.png', 'logo-water.png', 'logo-small.png', 'logo-horizontal.svg',
    'favicon-32.png', 'favicon-192.png',
    'login-direct.html', 'booth.html', 'booth-qr.png', 'booth-qr-print.png', 'wortheyflow-qr.png',
    'mc-shared.css'
]);
// Admin-only Mission Control pages: served through an authenticated loader.
const MC_PAGES = ['mission-control.html', 'mc-agents.html', 'mc-revenue.html', 'mc-marketing.html'];

function publicStatic(rootDir) {
    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const name = req.path.replace(/^\/+/, '');
        if (name.includes('/') || !PUBLIC_FILES.has(name)) return next();
        res.sendFile(path.join(rootDir, name));
    };
}

// ---------- Auth gate ----------
// Routes that are reachable without a user JWT. Each one is protected by its own
// mechanism (shared secret, API key, Twilio signature, or is a public intake form).
const PUBLIC_API_ROUTES = [
    { method: 'POST', path: '/api/auth/login' },                 // login (rate limited)
    { method: 'GET', path: '/api/health' },                      // health check
    { method: 'POST', path: '/api/webhook/ghl' },                // GHL_WEBHOOK_SECRET
    { method: 'POST', path: '/api/booth-lead' },                 // public booth form (rate limited)
    { method: 'POST', path: '/api/sms/inbound' },                // Twilio signature
    { method: 'GET', prefix: '/api/bot/' },                      // AQUABOT_API_KEY
    { method: 'GET', path: '/api/response-metrics' },            // REPORT_SECRET or JWT (checked in route)
    { method: 'GET', path: '/api/daily-report' },                // REPORT_SECRET or admin JWT (checked in route)
    { method: 'GET', path: '/api/weekly-report' }                // REPORT_SECRET or admin JWT (checked in route)
];

function isPublicApiRoute(method, p) {
    const m = method === 'HEAD' ? 'GET' : method;
    const clean = p.length > 1 ? p.replace(/\/+$/, '') : p;
    return PUBLIC_API_ROUTES.some(r => r.method === m && (r.path ? r.path === clean : clean.startsWith(r.prefix)));
}

// Deny-by-default: every /api request needs a valid JWT unless it is on the list above.
function apiAuthGate(authMiddleware) {
    return (req, res, next) => {
        if (req.method === 'OPTIONS') return next();
        if (!req.path.startsWith('/api/') && req.path !== '/api') return next();
        if (isPublicApiRoute(req.method, req.path)) return next();
        return authMiddleware(req, res, next);
    };
}

// ---------- Lead permissions ----------
const SERVICE_JOB_TYPE_RE = /service|maintenance|equipment|repair|route/i;

function firstName(v) { return String(v || '').trim().split(/\s+/)[0].toLowerCase(); }

function isServiceJobType(jobType) { return SERVICE_JOB_TYPE_RE.test(String(jobType || '')); }

// lead: camelCase lead ({salesperson, jobType}) or DB row ({salesperson, job_type})
function canAccessLead(user, lead) {
    if (!user || !lead) return false;
    if (user.role === 'admin') return true;
    const mine = firstName(user.salesperson || user.name);
    if (mine && firstName(lead.salesperson) === mine) return true;
    if (user.role === 'service' && isServiceJobType(lead.jobType || lead.job_type)) return true;
    return false;
}

// ---------- Rate limiting (in-memory, single instance) ----------
function rateLimiter({ windowMs, max, keyFn, message }) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, Math.max(windowMs, 60000)).unref();
    const limiter = (req, res, next) => {
        const key = keyFn ? keyFn(req) : req.ip;
        const now = Date.now();
        let e = hits.get(key);
        if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
        e.count++;
        if (e.count > max) {
            res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
            return res.status(429).json({ error: message || 'Too many requests, try again later' });
        }
        next();
    };
    limiter.reset = (req) => hits.delete(keyFn ? keyFn(req) : req.ip);
    return limiter;
}

// ---------- Twilio webhook signature ----------
function twilioSignature(twilioLib) {
    let warned = false;
    return (req, res, next) => {
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!token) {
            if (!warned) { console.warn('[SECURITY] TWILIO_AUTH_TOKEN not set — /api/sms/inbound signature NOT validated'); warned = true; }
            return next();
        }
        const signature = req.headers['x-twilio-signature'];
        const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
        const url = base + req.originalUrl;
        let ok = false;
        try { ok = !!signature && twilioLib.validateRequest(token, signature, url, req.body || {}); } catch (e) { ok = false; }
        if (!ok) {
            console.warn('[SECURITY] Rejected /api/sms/inbound — invalid or missing Twilio signature');
            return res.status(403).type('text/xml').send('<Response></Response>');
        }
        next();
    };
}

// ---------- HTML escaping for server-built emails ----------
function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Mission Control loader ----------
// Browser navigations cannot send the Bearer token, so MC pages are served as a tiny
// loader that fetches the real page from an admin-only API with the stored token.
function mcLoaderHtml(page) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading…</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px">Loading…
<script>
(function () {
  var t = localStorage.getItem('wf_token');
  if (!t) { location.replace('/'); return; }
  fetch('/api/mc/page/${page}', { headers: { Authorization: 'Bearer ' + t } })
    .then(function (r) {
      if (r.status === 401 || r.status === 403) { document.body.textContent = 'Admin login required. Redirecting…'; setTimeout(function () { location.replace('/'); }, 1500); return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) { if (html == null) return; document.open(); document.write(html); document.close(); })
    .catch(function (e) { document.body.textContent = 'Failed to load page (' + e.message + ')'; });
})();
</script></body></html>`;
}

// Injected into MC pages so their same-origin /api fetches carry the user's token.
const MC_FETCH_SHIM = `<script>(function(){var t=localStorage.getItem('wf_token');if(!t||!window.fetch)return;var f=window.fetch;window.fetch=function(i,o){try{var u=typeof i==='string'?i:(i&&i.url)||'';if(u.indexOf('/api/')===0||u.indexOf(location.origin+'/api/')===0){o=o||{};var h=new Headers(o.headers||{});if(!h.has('Authorization'))h.set('Authorization','Bearer '+t);o.headers=h;}}catch(e){}return f.call(this,i,o);};})();</script>`;

function injectMcShim(html) {
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + MC_FETCH_SHIM);
    return MC_FETCH_SHIM + html;
}

module.exports = {
    REQUIRED_SECRETS, loadRequiredSecrets, safeEqual,
    PUBLIC_FILES, MC_PAGES, publicStatic,
    PUBLIC_API_ROUTES, isPublicApiRoute, apiAuthGate,
    canAccessLead, isServiceJobType,
    rateLimiter, twilioSignature, escapeHtml,
    mcLoaderHtml, injectMcShim
};
