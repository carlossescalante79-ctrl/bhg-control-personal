import { nextMovement } from './_movement.js';
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

// Centro provisional: confirmar el punto exacto en Google Maps antes de desplegar.
const WORKSHOP_LAT = Number(process.env.BHG_WORKSHOP_LAT || '21.1465383');
const WORKSHOP_LON = Number(process.env.BHG_WORKSHOP_LON || '-101.6186346');
const MAX_DISTANCE_METERS = 30;
const MAX_ACCURACY_METERS = 35;
const MAX_FIX_AGE_MS = 20000;
function metersBetween(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180, earth = 6371000;
  const dlat = (lat2-lat1)*rad, dlon=(lon2-lon1)*rad;
  const a = Math.sin(dlat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dlon/2)**2;
  return 2*earth*Math.asin(Math.min(1,Math.sqrt(a)));
}
function validateLocation(location) {
  const lat=Number(location?.latitude), lon=Number(location?.longitude);
  const accuracy=Number(location?.accuracy), timestamp=Number(location?.timestamp);
  if (!location || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(accuracy) || !Number.isFinite(timestamp) || Math.abs(lat)>90 || Math.abs(lon)>180 || accuracy<=0) {
    return 'Se requiere ubicación GPS válida para registrar asistencia.';
  }
  if (Math.abs(Date.now()-timestamp)>MAX_FIX_AGE_MS) return 'La ubicación caducó. Intenta nuevamente.';
  const distance=metersBetween(lat,lon,WORKSHOP_LAT,WORKSHOP_LON);
  // Si incluso descontando el margen de error GPS queda fuera del radio,
  // podemos indicar que está lejos sin confundir precisión con distancia.
  if (distance - accuracy > MAX_DISTANCE_METERS) {
    return `Registro bloqueado: estás fuera del radio permitido de ${MAX_DISTANCE_METERS} metros del taller (distancia aproximada: ${Math.round(distance)} m).`;
  }
  // Nunca autorizar una marcación basada en una lectura imprecisa.
  if (accuracy>MAX_ACCURACY_METERS) {
    return `No se pudo verificar que estés dentro de los ${MAX_DISTANCE_METERS} metros del taller. GPS poco preciso (±${Math.round(accuracy)} m). Intenta nuevamente en un lugar abierto.`;
  }
  if (distance>MAX_DISTANCE_METERS) {
    return `Registro bloqueado: estás fuera del radio permitido de ${MAX_DISTANCE_METERS} metros del taller (distancia aproximada: ${Math.round(distance)} m).`;
  }
  return null;
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
    // GPS obligatorio en todos los movimientos, tanto QR como Terminal.
    // Una sesión de administrador nunca omite el control de ubicación.
    const locationError=validateLocation(req.body?.location);
    if (locationError) return res.status(403).json({error:locationError});

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
