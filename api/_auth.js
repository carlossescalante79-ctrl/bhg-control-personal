import crypto from 'crypto';

export const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

function secret() {
  return process.env.SESSION_SECRET || 'CAMBIA_ESTA_CLAVE_EN_VERCEL';
}

export function makeSession() {
  const payload = `admin.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function validSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)bhg_admin=([^;]+)/);
  if (!m) return false;
  const token = decodeURIComponent(m[1]);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return false;
  } catch { return false; }
  const age = Date.now() - Number(parts[1]);
  return Number.isFinite(age) && age >= 0 && age < 8 * 60 * 60 * 1000;
}

export function setAdminCookie(res, token) {
  res.setHeader('Set-Cookie', `bhg_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=28800`);
}

export function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'bhg_admin=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
}
