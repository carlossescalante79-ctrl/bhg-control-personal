import { db } from './_db.js';
import { hashPin } from './_auth.js';

function timeToMinutes(v) {
  const [h,m] = String(v).slice(0,5).split(':').map(Number);
  return h*60+m;
}

function nowMinutesMexico() {
  const parts = new Intl.DateTimeFormat('en-GB',{
    timeZone:'America/Mexico_City',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).formatToParts(new Date());

  const h=Number(parts.find(x=>x.type==='hour').value);
  const m=Number(parts.find(x=>x.type==='minute').value);

  return h*60+m;
}

function effectiveSchedule(emp, settings) {
  if (!emp.use_custom_schedule) return settings;

  return {
    work_start: emp.custom_work_start || settings.work_start,
    work_tolerance: emp.custom_work_tolerance ?? settings.work_tolerance,
    food_out: emp.custom_food_out || settings.food_out,
    food_out_tolerance: emp.custom_food_out_tolerance ?? settings.food_out_tolerance,
    food_in: emp.custom_food_in || settings.food_in,
    food_in_tolerance: emp.custom_food_in_tolerance ?? settings.food_in_tolerance,
    work_end: emp.custom_work_end || settings.work_end,
    work_end_tolerance: emp.custom_work_end_tolerance ?? settings.work_end_tolerance
  };
}

function statusFor(movement, schedule) {
  const now=nowMinutesMexico();

  if (movement==='Entrada laboral') {
    const lim=timeToMinutes(schedule.work_start)+Number(schedule.work_tolerance||0);
    return now<=lim?'A TIEMPO':'RETARDO';
  }

  if (movement==='Entrada comida') {
    const lim=timeToMinutes(schedule.food_in)+Number(schedule.food_in_tolerance||0);
    return now<=lim?'A TIEMPO':'RETARDO';
  }

  return null;
}

async function nextMovement(sql, employeeId) {
  const rows=await sql`
    SELECT movement
    FROM attendance
    WHERE employee_id=${employeeId}
      AND (registered_at AT TIME ZONE 'America/Mexico_City')::date
          =(NOW() AT TIME ZONE 'America/Mexico_City')::date
    ORDER BY registered_at DESC
    LIMIT 1
  `;

  const last=rows[0]?.movement||null;

  if(!last) return 'Entrada laboral';
  if(last==='Entrada laboral') return 'Salida comida';
  if(last==='Salida comida') return 'Entrada comida';
  if(last==='Entrada comida') return 'Salida laboral';
  if(last==='Salida laboral') return null;

  return 'Entrada laboral';
}

export default async function handler(req,res){
  if(req.method!=='POST'){
    return res.status(405).json({error:'POST requerido'});
  }

  const sql=db();

  try{
    const pin=String(req.body?.pin||'').trim();
    const method=req.body?.method==='QR'?'QR':'Terminal';
    const photo=String(req.body?.photo||'');

    if(photo.length>700000){
      return res.status(413).json({error:'Foto demasiado grande'});
    }

    if(!/^\d{4,6}$/.test(pin)){
      return res.status(400).json({error:'PIN inválido'});
    }

    const emp=await sql`
      SELECT
        id,name,
        use_custom_schedule,
        custom_work_start,custom_work_tolerance,
        custom_food_out,custom_food_out_tolerance,
        custom_food_in,custom_food_in_tolerance,
        custom_work_end,custom_work_end_tolerance
      FROM employees
      WHERE active=TRUE
        AND pin_hash=${hashPin(pin)}
      LIMIT 1
    `;

    if(!emp[0]){
      return res.status(401).json({error:'PIN incorrecto'});
    }

    const next=await nextMovement(sql,emp[0].id);

    if(!next){
      return res.status(409).json({error:'La jornada de hoy ya está cerrada'});
    }

    const settings=(await sql`SELECT * FROM settings WHERE id=1`)[0];
    const schedule=effectiveSchedule(emp[0],settings);
    const status=statusFor(next,schedule);

    const inserted=await sql`
      INSERT INTO attendance(employee_id,movement,status,method,photo_data)
      VALUES(${emp[0].id},${next},${status},${method},${photo||null})
      RETURNING id,movement,status,registered_at
    `;

    const after=await nextMovement(sql,emp[0].id);

    return res.json({
      ok:true,
      employee:emp[0].name,
      record:inserted[0],
      next:after
    });

  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message});
  }
}
