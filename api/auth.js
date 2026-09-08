import {
  db
} from './_db.js';

import {
  hashPin,
  makeSession,
  setAdminCookie,
  clearAdminCookie,
  validSession
} from './_auth.js';

export default async function handler(req,res){
  const sql=db();

  try{

    // =========================
    // CERRAR SESIÓN ADMIN
    // =========================
    if(req.method==='DELETE'){
      clearAdminCookie(res);
      return res.json({ok:true});
    }

    // =========================
    // CONSULTAR SESIÓN ADMIN
    // =========================
    if(req.method==='GET'){
      return res.json({
        admin:validSession(req)
      });
    }

    if(req.method!=='POST'){
      return res.status(405).json({
        error:'Método no permitido'
      });
    }

    const pin=String(
      req.body?.pin||''
    ).trim();

    if(!/^\d{4,6}$/.test(pin)){
      return res.status(400).json({
        error:'PIN inválido'
      });
    }

    // =========================
    // VALIDAR ADMINISTRADOR
    // =========================
    const settings=await sql`
      SELECT admin_pin_hash
      FROM settings
      WHERE id=1
    `;

    if(
      settings[0] &&
      settings[0].admin_pin_hash===hashPin(pin)
    ){
      setAdminCookie(res,makeSession());

      return res.json({
        type:'admin',
        role:'admin'
      });
    }

    // =========================
    // VALIDAR EMPLEADO
    // =========================
    const emp=await sql`
      SELECT
        id,
        name,
        role,
        pay_type,
        salary
      FROM employees
      WHERE
        active=TRUE
        AND pin_hash=${hashPin(pin)}
      LIMIT 1
    `;

    if(!emp[0]){
      return res.status(401).json({
        error:'PIN incorrecto'
      });
    }

    const next=
      await nextMovement(
        sql,
        emp[0].id
      );

    if(!next){
      return res.status(409).json({
        error:'La jornada de hoy ya está completa'
      });
    }

    /*
      Devuelvo ambos nombres para que funcione
      tanto con la versión anterior como con
      la nueva del index.html.
    */
    return res.json({
      type:'employee',
      role:'employee',
      employee:emp[0],
      next:next,
      nextMovement:next
    });

  }catch(e){

    console.error(e);

    return res.status(500).json({
      error:e.message
    });
  }
}


// =========================
// SIGUIENTE MOVIMIENTO
// =========================
async function nextMovement(
  sql,
  employeeId
){

  const rows=await sql`
    SELECT
      movement,
      registered_at
    FROM attendance

    WHERE
      employee_id=${employeeId}

      AND (
        registered_at
        AT TIME ZONE 'America/Mexico_City'
      )::date
      =
      (
        NOW()
        AT TIME ZONE 'America/Mexico_City'
      )::date

    ORDER BY registered_at DESC

    LIMIT 1
  `;

  const last=
    rows[0]?.movement||null;

  if(!last){
    return 'Entrada laboral';
  }

  if(last==='Entrada laboral'){
    return 'Salida comida';
  }

  if(last==='Salida comida'){
    return 'Entrada comida';
  }

  if(last==='Entrada comida'){
    return 'Salida laboral';
  }

  if(last==='Salida laboral'){
    return null;
  }

  return 'Entrada laboral';
}
