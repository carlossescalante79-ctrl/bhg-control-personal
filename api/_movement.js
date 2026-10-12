// Misma lógica para la pantalla PIN y para el registro efectivo.
// Si la entrada laboral ocurre >= 120 minutos después de la hora programada,
// se omiten ambos movimientos de comida durante toda esa jornada.
export async function nextMovement(sql, employeeId) {
  const rows=await sql`
    SELECT movement,
      EXTRACT(HOUR FROM (registered_at AT TIME ZONE 'America/Mexico_City'))::int AS hour,
      EXTRACT(MINUTE FROM (registered_at AT TIME ZONE 'America/Mexico_City'))::int AS minute
    FROM attendance
    WHERE employee_id=${employeeId}
      AND (registered_at AT TIME ZONE 'America/Mexico_City')::date
        = (NOW() AT TIME ZONE 'America/Mexico_City')::date
    ORDER BY registered_at ASC, id ASC
  `;
  if (!rows.length) return 'Entrada laboral';
  const last=rows[rows.length-1].movement;
  if(last==='Salida laboral') return null;
  if(last==='Entrada comida') return 'Salida laboral';
  if(last==='Salida comida') return 'Entrada comida';
  if(last!=='Entrada laboral') return 'Entrada laboral';

  const entry=rows.find(r=>r.movement==='Entrada laboral');
  if(!entry) return 'Salida comida';
  const [employee]=await sql`
    SELECT use_custom_schedule, custom_work_start
    FROM employees WHERE id=${employeeId}
  `;
  const [settings]=await sql`SELECT work_start FROM settings WHERE id=1`;
  const start=employee?.use_custom_schedule && employee.custom_work_start
    ? employee.custom_work_start : settings?.work_start;
  if(!start) return 'Salida comida';
  const [h,m]=String(start).slice(0,5).split(':').map(Number);
  const scheduled=h*60+m;
  const actual=Number(entry.hour)*60+Number(entry.minute);
  return actual-scheduled>=120 ? 'Salida laboral' : 'Salida comida';
}
