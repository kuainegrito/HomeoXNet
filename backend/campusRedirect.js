'use strict';

// Sends a GMU on-campus visitor from the public kuaiyu.site host to the faster on-premise
// mirror at CAMPUS_INTRANET_HOST, but only when BOTH of these hold:
//   1. the visitor's IP falls inside one of CAMPUS_IP_CIDRS (GMU's public egress ranges), and
//   2. the intranet box has heartbeated recently (see recordHeartbeat/isIntranetAlive below).
// Either check failing means "stay on kuaiyu.site" - never "redirect to something unreachable".
// Off campus (including on VPN) the IP check fails and nothing happens. If the intranet box
// dies, its heartbeat goes stale and redirects stop within CAMPUS_HEARTBEAT_TIMEOUT_MS, so a
// wrong redirect self-heals instead of stranding students on a dead link. Students also carry a
// second QR code pointed straight at the intranet host as a manual fallback, so a missed redirect
// here is an inconvenience, not an outage.
//
// All of this is OFF by default (CAMPUS_REDIRECT_ENABLED unset): a plain clone of this repo must
// not start redirecting anyone anywhere.

const ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.CAMPUS_REDIRECT_ENABLED || '').trim());
const INTRANET_HOST = String(process.env.CAMPUS_INTRANET_HOST || '10.9.53.252').trim();
const HEARTBEAT_SECRET = String(process.env.CAMPUS_HEARTBEAT_SECRET || '').trim();
const HEARTBEAT_TIMEOUT_MS = positiveIntEnv('CAMPUS_HEARTBEAT_TIMEOUT_MS', 60 * 1000);
const CIDRS = String(process.env.CAMPUS_IP_CIDRS || '')
  .split(',')
  .map(entry=>entry.trim())
  .filter(Boolean)
  .map(parseCidr)
  .filter(Boolean);

function positiveIntEnv(name, fallback){
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function parseCidr(entry){
  const [addr, prefixRaw] = entry.split('/');
  const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
  const base = ipToInt(addr);
  if(base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return {base: base & mask, mask};
}

function ipToInt(ip){
  const parts = String(ip || '').split('.');
  if(parts.length !== 4) return null;
  let value = 0;
  for(const part of parts){
    const octet = Number(part);
    if(!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function normalizeIp(ip){
  const value = String(ip || '');
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function isInCampusRange(ip){
  const value = ipToInt(normalizeIp(ip));
  if(value === null) return false;
  return CIDRS.some(({base, mask})=>(value & mask) === base);
}

// --- intranet liveness, driven by the intranet box's own outbound heartbeat ---

let lastHeartbeatAt = 0;

function recordHeartbeat(){
  lastHeartbeatAt = Date.now();
}

function isIntranetAlive(now = Date.now()){
  return lastHeartbeatAt > 0 && (now - lastHeartbeatAt) <= HEARTBEAT_TIMEOUT_MS;
}

function heartbeatHandler(req, res){
  if(!HEARTBEAT_SECRET){
    res.status(503).json({ok:false, error:'campus_heartbeat_not_configured'});
    return;
  }
  const provided = String(req.get('X-Campus-Heartbeat-Secret') || '');
  if(provided !== HEARTBEAT_SECRET){
    res.status(401).json({ok:false, error:'invalid_secret'});
    return;
  }
  recordHeartbeat();
  res.status(204).end();
}

function statusHandler(req, res){
  res.json({
    ok:true,
    enabled: ENABLED,
    intranetAlive: isIntranetAlive(),
    cidrCount: CIDRS.length
  });
}

// Middleware: only ever redirects GET/HEAD page loads, never API calls or the heartbeat route.
function redirectMiddleware(req, res, next){
  if(!ENABLED) return next();
  if(req.method !== 'GET' && req.method !== 'HEAD') return next();
  if(req.path.startsWith('/api/')) return next();
  if(!isIntranetAlive()) return next();
  const clientIp = req.ip || req.socket?.remoteAddress || '';
  if(!isInCampusRange(clientIp)) return next();
  res.redirect(302, `http://${INTRANET_HOST}${req.originalUrl}`);
}

module.exports = {
  redirectMiddleware,
  heartbeatHandler,
  statusHandler,
  recordHeartbeat,
  isIntranetAlive,
  isInCampusRange,
  parseCidr,
  ipToInt,
  ENABLED,
  INTRANET_HOST,
  HEARTBEAT_TIMEOUT_MS
};
