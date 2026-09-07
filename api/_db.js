import { neon } from '@neondatabase/serverless';

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  return neon(process.env.DATABASE_URL);
}
