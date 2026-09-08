import { db } from './_db.js';
import { hashPin } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST requerido' });

  if (!process.env.SETUP_KEY || req.headers['x-setup-key'] !== process.env.SETUP_KEY) {
    return res.status(401).json({ error: 'SETUP_KEY inválida' });
  }

  const sql = db();

  try {
    await sql`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      admin_pin_hash TEXT NOT NULL,
      work_start TIME NOT NULL DEFAULT '08:00',
      work_tolerance INTEGER NOT NULL DEFAULT 10,
      food_out TIME NOT NULL DEFAULT '14:00',
      food_out_tolerance INTEGER NOT NULL DEFAULT 10,
      food_in TIME NOT NULL DEFAULT '15:00',
      food_in_tolerance INTEGER NOT NULL DEFAULT 10,
      work_end TIME NOT NULL DEFAULT '18:00',
      work_end_tolerance INTEGER NOT NULL DEFAULT 10,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS employees (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      pin_hash TEXT UNIQUE NOT NULL,
      pay_type TEXT NOT NULL DEFAULT 'Semanal' CHECK (pay_type IN ('Semanal','Quincenal')),
      salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    /* Horario personalizado por empleado.
       Si use_custom_schedule = FALSE se usa el horario general de settings. */
    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS use_custom_schedule BOOLEAN NOT NULL DEFAULT FALSE`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_work_start TIME`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_work_tolerance INTEGER`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_food_out TIME`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_food_out_tolerance INTEGER`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_food_in TIME`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_food_in_tolerance INTEGER`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_work_end TIME`;

    await sql`ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS custom_work_end_tolerance INTEGER`;

    await sql`CREATE TABLE IF NOT EXISTS attendance (
      id BIGSERIAL PRIMARY KEY,
      employee_id BIGINT NOT NULL REFERENCES employees(id),
      movement TEXT NOT NULL CHECK (movement IN ('Entrada laboral','Salida comida','Entrada comida','Salida laboral')),
      status TEXT,
      method TEXT NOT NULL CHECK (method IN ('QR','Terminal','Administrador')),
      photo_data TEXT,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
      ON attendance(employee_id, registered_at)`;

    await sql`CREATE TABLE IF NOT EXISTS incidents (
      id BIGSERIAL PRIMARY KEY,
      employee_id BIGINT NOT NULL REFERENCES employees(id),
      incident_date DATE NOT NULL,
      type TEXT NOT NULL,
      justified BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS adjustments (
      id BIGSERIAL PRIMARY KEY,
      employee_id BIGINT NOT NULL REFERENCES employees(id),
      adjust_date DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Descuento','Bono')),
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      reason TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS payroll_cuts (
      id BIGSERIAL PRIMARY KEY,
      employee_id BIGINT NOT NULL REFERENCES employees(id),
      period_type TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      payment_date DATE NOT NULL,
      base_salary NUMERIC(12,2) NOT NULL,
      bonuses NUMERIC(12,2) NOT NULL DEFAULT 0,
      discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
      net_pay NUMERIC(12,2) NOT NULL,
      entries INTEGER NOT NULL DEFAULT 0,
      late_count INTEGER NOT NULL DEFAULT 0,
      incidents_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`INSERT INTO settings (id, admin_pin_hash)
      VALUES (1, ${hashPin('9999')})
      ON CONFLICT (id) DO NOTHING`;

    const existing = await sql`SELECT COUNT(*)::int AS count FROM employees`;

    if (existing[0].count === 0) {
      await sql`INSERT INTO employees (name, role, pin_hash, pay_type, salary) VALUES
        ('Juan Pérez', 'Mecánico', ${hashPin('1234')}, 'Semanal', 3000),
        ('Luis García', 'Ayudante', ${hashPin('5678')}, 'Semanal', 2500)`;
    }

    return res.json({
      ok: true,
      message: 'Base de datos lista. Se habilitaron horarios personalizados por empleado.'
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
