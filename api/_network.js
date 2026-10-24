// Restricción por IP pública. Nunca confiar en una IP enviada en el cuerpo de la petición.
export function requestIp(req) {
  // En Vercel, x-vercel-forwarded-for refleja la IP observada por la plataforma.
  const header=req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  const ip=String(Array.isArray(header)?header[0]:header||'').split(',')[0].trim();
  return ip.startsWith('::ffff:')?ip.slice(7):ip;
}
export async function ensureNetworkTables(sql){
  await sql`CREATE TABLE IF NOT EXISTS attendance_network_policy (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
    mode TEXT NOT NULL DEFAULT 'monitor' CHECK(mode IN ('monitor','enforce')),
    ipv4 TEXT NOT NULL DEFAULT '189.203.149.219',
    ipv6 TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`INSERT INTO attendance_network_policy(id) VALUES(1) ON CONFLICT(id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS attendance_network_attempts (
    id BIGSERIAL PRIMARY KEY, employee_id BIGINT,
    attempted_ip TEXT, reason TEXT NOT NULL,
    mode TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
export function networkAllowed(ip,policy){
  return Boolean(ip) && [policy.ipv4,policy.ipv6].some(v=>v&&v.trim()===ip);
}
