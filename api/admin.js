import { db } from './_db.js';
import { hashPin, validSession } from './_auth.js';

function requireAdmin(req,res){
  if(!validSession(req)){
    res.status(401).json({error:'Sesión de administrador requerida'});
    return false;
  }
  return true;
}

export default async function handler(req,res){
  if(!requireAdmin(req,res)) return;
  const sql=db();

  try{
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT`;
    await sql`CREATE TABLE IF NOT EXISTS attendance_corrections (
      id BIGSERIAL PRIMARY KEY, attendance_id BIGINT NOT NULL,
      original_movement TEXT NOT NULL, corrected_movement TEXT NOT NULL,
      original_registered_at TIMESTAMPTZ NOT NULL, corrected_registered_at TIMESTAMPTZ NOT NULL,
      original_status TEXT, corrected_status TEXT, reason TEXT NOT NULL,
      corrected_by TEXT NOT NULL DEFAULT 'Administrador', corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE payroll_cuts ADD COLUMN IF NOT EXISTS detail_json JSONB`;
    if(req.method==='GET'){
      const [settings,employees,attendance,incidents,adjustments,cuts,corrections]=await Promise.all([
        sql`SELECT id,work_start,work_tolerance,food_out,food_out_tolerance,food_in,food_in_tolerance,work_end,work_end_tolerance FROM settings WHERE id=1`,
        sql`SELECT
          id,name,role,phone,pay_type,salary,active,created_at,
          use_custom_schedule,
          custom_work_start,custom_work_tolerance,
          custom_food_out,custom_food_out_tolerance,
          custom_food_in,custom_food_in_tolerance,
          custom_work_end,custom_work_end_tolerance
        FROM employees
        ORDER BY active DESC,name`,
        sql`SELECT a.id,a.employee_id,e.name,a.movement,a.status,a.method,a.photo_data,a.registered_at FROM attendance a JOIN employees e ON e.id=a.employee_id ORDER BY a.registered_at DESC LIMIT 3000`,
        sql`SELECT i.id,i.employee_id,e.name,i.incident_date,i.type,i.justified,i.notes,i.created_at FROM incidents i JOIN employees e ON e.id=i.employee_id ORDER BY i.incident_date DESC,i.id DESC LIMIT 300`,
        sql`SELECT a.id,a.employee_id,e.name,a.adjust_date,a.type,a.amount,a.reason,a.notes,a.created_at FROM adjustments a JOIN employees e ON e.id=a.employee_id ORDER BY a.adjust_date DESC,a.id DESC LIMIT 300`,
        sql`SELECT p.id,p.employee_id,e.name,e.phone,p.period_type,p.start_date,p.end_date,p.payment_date,p.base_salary,p.bonuses,p.discounts,p.net_pay,p.entries,p.late_count,p.incidents_count,p.detail_json,p.created_at FROM payroll_cuts p JOIN employees e ON e.id=p.employee_id ORDER BY p.created_at DESC LIMIT 200`,
        sql`SELECT * FROM attendance_corrections ORDER BY corrected_at DESC LIMIT 1000`
      ]);

      return res.json({
        settings:settings[0],
        employees,
        attendance,
        incidents,
        adjustments,
        cuts,corrections
      });
    }

    if(req.method!=='POST'){
      return res.status(405).json({error:'Método no permitido'});
    }

    const a=req.body?.action;

    if(a==='employee.create'){
      const {
        name,role,phone,pin,payType,salary,
        useCustomSchedule,
        customWorkStart,customWorkTolerance,
        customFoodOut,customFoodOutTolerance,
        customFoodIn,customFoodInTolerance,
        customWorkEnd,customWorkEndTolerance
      }=req.body;

      if(
        !String(name||'').trim() ||
        !/^\d{4,6}$/.test(String(pin||'')) ||
        Number(salary)<0
      ){
        return res.status(400).json({error:'Datos inválidos'});
      }

      const cleanPhone=String(phone||'').replace(/\D/g,'');
      if(cleanPhone && !/^\d{10,15}$/.test(cleanPhone)) return res.status(400).json({error:'Celular inválido: utiliza 10 a 15 dígitos'});
      const custom=!!useCustomSchedule;

      if(custom && (!customWorkStart || !customFoodOut || !customFoodIn || !customWorkEnd)){
        return res.status(400).json({error:'Completa los cuatro horarios personalizados'});
      }

      await sql`
        INSERT INTO employees(
          name,role,phone,pin_hash,pay_type,salary,
          use_custom_schedule,
          custom_work_start,custom_work_tolerance,
          custom_food_out,custom_food_out_tolerance,
          custom_food_in,custom_food_in_tolerance,
          custom_work_end,custom_work_end_tolerance
        )
        VALUES(
          ${String(name).trim()},
          ${String(role||'').trim()||null},
          ${cleanPhone||null},
          ${hashPin(String(pin))},
          ${payType==='Quincenal'?'Quincenal':'Semanal'},
          ${Number(salary)},
          ${custom},
          ${custom?customWorkStart:null},
          ${custom?Number(customWorkTolerance||0):null},
          ${custom?customFoodOut:null},
          ${custom?Number(customFoodOutTolerance||0):null},
          ${custom?customFoodIn:null},
          ${custom?Number(customFoodInTolerance||0):null},
          ${custom?customWorkEnd:null},
          ${custom?Number(customWorkEndTolerance||0):null}
        )
      `;

      return res.json({ok:true});
    }

    if(a==='employee.update'){
      const id=Number(req.body.id);
      const name=String(req.body.name||'').trim();
      const role=String(req.body.role||'').trim();
      const cleanPhone=String(req.body.phone||'').replace(/\D/g,'');
      if(cleanPhone && !/^\d{10,15}$/.test(cleanPhone)) return res.status(400).json({error:'Celular inválido: utiliza 10 a 15 dígitos'});
      const pin=String(req.body.pin||'').trim();
      const payType=req.body.payType==='Quincenal'?'Quincenal':'Semanal';
      const salary=Number(req.body.salary);
      const custom=!!req.body.useCustomSchedule;

      if(!Number.isInteger(id)||id<=0||!name||salary<0){
        return res.status(400).json({error:'Datos inválidos'});
      }

      if(pin && !/^\d{4,6}$/.test(pin)){
        return res.status(400).json({error:'El PIN debe tener de 4 a 6 números'});
      }

      if(custom && (
        !req.body.customWorkStart ||
        !req.body.customFoodOut ||
        !req.body.customFoodIn ||
        !req.body.customWorkEnd
      )){
        return res.status(400).json({error:'Completa los cuatro horarios personalizados'});
      }

      const exists=await sql`SELECT id FROM employees WHERE id=${id}`;

      if(!exists.length){
        return res.status(404).json({error:'Empleado no encontrado'});
      }

      const pinHash=pin?hashPin(pin):null;

      await sql`
        UPDATE employees
        SET
          name=${name},
          role=${role||null},
          phone=${cleanPhone||null},
          pay_type=${payType},
          salary=${salary},
          use_custom_schedule=${custom},
          custom_work_start=${custom?req.body.customWorkStart:null},
          custom_work_tolerance=${custom?Number(req.body.customWorkTolerance||0):null},
          custom_food_out=${custom?req.body.customFoodOut:null},
          custom_food_out_tolerance=${custom?Number(req.body.customFoodOutTolerance||0):null},
          custom_food_in=${custom?req.body.customFoodIn:null},
          custom_food_in_tolerance=${custom?Number(req.body.customFoodInTolerance||0):null},
          custom_work_end=${custom?req.body.customWorkEnd:null},
          custom_work_end_tolerance=${custom?Number(req.body.customWorkEndTolerance||0):null},
          pin_hash=CASE WHEN ${pinHash}::text IS NULL THEN pin_hash ELSE ${pinHash} END
        WHERE id=${id}
      `;

      return res.json({ok:true,message:'Empleado actualizado correctamente'});
    }

    if(a==='employee.toggle'){
      await sql`
        UPDATE employees
        SET active=${!!req.body.active}
        WHERE id=${Number(req.body.id)}
      `;
      return res.json({ok:true});
    }

    if(a==='employee.delete'){
      const id=Number(req.body.id);

      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:'Empleado inválido'});
      }

      const emp=await sql`SELECT id,name FROM employees WHERE id=${id}`;
      if(!emp.length){
        return res.status(404).json({error:'Empleado no encontrado'});
      }

      await sql`DELETE FROM payroll_cuts WHERE employee_id=${id}`;
      await sql`DELETE FROM adjustments WHERE employee_id=${id}`;
      await sql`DELETE FROM incidents WHERE employee_id=${id}`;
      await sql`DELETE FROM attendance WHERE employee_id=${id}`;
      await sql`DELETE FROM employees WHERE id=${id}`;

      return res.json({
        ok:true,
        message:`Empleado ${emp[0].name} eliminado correctamente`
      });
    }

    if(a==='settings.update'){
      const r=req.body;

      await sql`
        UPDATE settings SET
          work_start=${r.workStart},
          work_tolerance=${Number(r.workTolerance)},
          food_out=${r.foodOut},
          food_out_tolerance=${Number(r.foodOutTolerance)},
          food_in=${r.foodIn},
          food_in_tolerance=${Number(r.foodInTolerance)},
          work_end=${r.workEnd},
          work_end_tolerance=${Number(r.workEndTolerance)},
          updated_at=NOW()
        WHERE id=1
      `;

      return res.json({ok:true});
    }

    if(a==='admin.pin'){
      const pin=String(req.body.pin||'');

      if(!/^\d{4,6}$/.test(pin)){
        return res.status(400).json({error:'PIN inválido'});
      }

      await sql`
        UPDATE settings
        SET admin_pin_hash=${hashPin(pin)},updated_at=NOW()
        WHERE id=1
      `;

      return res.json({ok:true});
    }

    if(a==='incident.create'){
      const r=req.body;

      await sql`
        INSERT INTO incidents(employee_id,incident_date,type,justified,notes)
        VALUES(
          ${Number(r.employeeId)},
          ${r.date},
          ${r.type},
          ${!!r.justified},
          ${r.notes||null}
        )
      `;

      return res.json({ok:true});
    }

    if(a==='adjustment.create'){
      const r=req.body;

      await sql`
        INSERT INTO adjustments(employee_id,adjust_date,type,amount,reason,notes)
        VALUES(
          ${Number(r.employeeId)},
          ${r.date},
          ${r.type==='Bono'?'Bono':'Descuento'},
          ${Number(r.amount)},
          ${r.reason},
          ${r.notes||null}
        )
      `;

      return res.json({ok:true});
    }

    if(a==='attendance.correct'){
      const id=Number(req.body.id);
      const movement=String(req.body.movement||'');
      const reason=String(req.body.reason||'').trim();
      const local=String(req.body.localDateTime||'');
      if(!Number.isInteger(id)||id<=0||!['Entrada laboral','Salida comida','Entrada comida','Salida laboral'].includes(movement)||reason.length<5||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.test(local))return res.status(400).json({error:'Completa movimiento, fecha y motivo (mínimo 5 caracteres)'});
      const utc=new Date(local+':00-06:00');
      if(!Number.isFinite(utc.getTime()))return res.status(400).json({error:'Fecha inválida'});
      const current=(await sql`SELECT * FROM attendance WHERE id=${id}`)[0];
      if(!current)return res.status(404).json({error:'Marcación no encontrada'});
      const emp=(await sql`SELECT * FROM employees WHERE id=${current.employee_id}`)[0];
      const settings=(await sql`SELECT * FROM settings WHERE id=1`)[0];
      const workStart=String(emp?.use_custom_schedule?(emp.custom_work_start||settings.work_start):settings.work_start).slice(0,5);
      const foodIn=String(emp?.use_custom_schedule?(emp.custom_food_in||settings.food_in):settings.food_in).slice(0,5);
      const tolerance=Number(movement==='Entrada laboral'?(emp?.use_custom_schedule?emp.custom_work_tolerance:settings.work_tolerance):(emp?.use_custom_schedule?emp.custom_food_in_tolerance:settings.food_in_tolerance))||0;
      const toMin=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
      const newStatus=['Entrada laboral','Entrada comida'].includes(movement)?(toMin(local.slice(11,16))>toMin(movement==='Entrada laboral'?workStart:foodIn)+tolerance?'RETARDO':'A TIEMPO'):null;
      await sql`INSERT INTO attendance_corrections(attendance_id,original_movement,corrected_movement,original_registered_at,corrected_registered_at,original_status,corrected_status,reason)
        VALUES(${id},${current.movement},${movement},${current.registered_at},${utc.toISOString()},${current.status},${newStatus},${reason})`;
      await sql`UPDATE attendance SET movement=${movement},registered_at=${utc.toISOString()},status=${newStatus} WHERE id=${id}`;
      return res.json({ok:true});
    }

    if(a==='attendance.delete'){
      const id=Number(req.body.id);

      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:'Registro inválido'});
      }

      const deleted=await sql`
        DELETE FROM attendance
        WHERE id=${id}
        RETURNING id
      `;

      if(!deleted.length){
        return res.status(404).json({error:'Registro no encontrado'});
      }

      return res.json({
        ok:true,
        message:'Registro eliminado correctamente'
      });
    }

    if(a==='payroll.calculate'){
      const r=req.body;
      const eid=Number(r.employeeId);
      if(!Number.isInteger(eid)||eid<=0||!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(r.endDate||'')||r.endDate<r.startDate){
        return res.status(400).json({error:'Empleado o fechas inválidas'});
      }
      const emp=(await sql`SELECT * FROM employees WHERE id=${eid}`)[0];
      if(!emp)return res.status(404).json({error:'Empleado no encontrado'});
      const settings=(await sql`SELECT * FROM settings WHERE id=1`)[0];
      const schedule=emp.use_custom_schedule?{
        work_start:emp.custom_work_start||settings.work_start,
        food_out:emp.custom_food_out||settings.food_out,
        food_in:emp.custom_food_in||settings.food_in,
        work_end:emp.custom_work_end||settings.work_end,
        work_tolerance:emp.custom_work_tolerance??settings.work_tolerance,
        food_in_tolerance:emp.custom_food_in_tolerance??settings.food_in_tolerance
      }:settings;
      const mins=v=>{const [h,m]=String(v).slice(0,5).split(':').map(Number);return h*60+m};
      const start=mins(schedule.work_start), foodOut=mins(schedule.food_out), foodIn=mins(schedule.food_in), end=mins(schedule.work_end);
      const dailyMinutes=(end-start)-Math.max(0,foodIn-foodOut);
      if(dailyMinutes<=0)return res.status(400).json({error:'Revisa los horarios del empleado: la jornada debe tener minutos positivos'});
      const base=Number(emp.salary);
      const periodDays=(r.periodType==='Quincenal'||(!r.periodType&&emp.pay_type==='Quincenal'))?10:5;
      const minuteRate=base/(periodDays*dailyMinutes);
      const movements=await sql`
        SELECT movement,status,
          (registered_at AT TIME ZONE 'America/Mexico_City')::date::text AS day,
          EXTRACT(HOUR FROM (registered_at AT TIME ZONE 'America/Mexico_City'))::int AS h,
          EXTRACT(MINUTE FROM (registered_at AT TIME ZONE 'America/Mexico_City'))::int AS m
        FROM attendance WHERE employee_id=${eid}
        AND (registered_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${r.startDate} AND ${r.endDate}
        ORDER BY registered_at,id
      `;
      const incidents=await sql`
        SELECT incident_date::text AS day,type,justified,notes FROM incidents
        WHERE employee_id=${eid} AND incident_date BETWEEN ${r.startDate} AND ${r.endDate}
        ORDER BY incident_date,id
      `;
      const adjustments=await sql`
        SELECT type,COALESCE(SUM(amount),0)::numeric AS total FROM adjustments
        WHERE employee_id=${eid} AND adjust_date BETWEEN ${r.startDate} AND ${r.endDate}
        GROUP BY type
      `;
      const bonuses=Number(adjustments.find(x=>x.type==='Bono')?.total||0);
      const manualDiscounts=Number(adjustments.find(x=>x.type==='Descuento')?.total||0);
      const byDay=new Map();
      for(const m of movements){const d=String(m.day).slice(0,10);if(!byDay.has(d))byDay.set(d,{});const obj=byDay.get(d);if(!obj[m.movement])obj[m.movement]=m.h*60+m.m;}
      const incidentsByDay=new Map();
      for(const i of incidents){const d=String(i.day).slice(0,10);if(!incidentsByDay.has(d))incidentsByDay.set(d,[]);incidentsByDay.get(d).push(i);}
      const days=[];let proposedMinutes=0,late=0,entries=0,missing=0,unjustifiedAbsences=0,justifiedAbsences=0;
      const currentMexico=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const nowDate=currentMexico.match(/^\d{4}-\d{2}-\d{2}$/)?currentMexico:new Date().toLocaleDateString('sv-SE',{timeZone:'America/Mexico_City'});
      const from=new Date(r.startDate+'T12:00:00Z'),to=new Date(r.endDate+'T12:00:00Z');
      if((to-from)/86400000>45)return res.status(400).json({error:'El periodo no puede superar 46 días'});
      for(let dt=new Date(from);dt<=to;dt.setUTCDate(dt.getUTCDate()+1)){
        const day=dt.toISOString().slice(0,10),weekday=dt.getUTCDay();
        if(weekday===0||weekday===6||day>nowDate)continue;
        // No inferir faltas antes de la fecha de alta en el sistema.
        const created=emp.created_at?new Date(emp.created_at).toLocaleDateString('sv-SE',{timeZone:'America/Mexico_City'}):null;
        if(created && day<created)continue;
        const a=byDay.get(day)||{}, ins=incidentsByDay.get(day)||[];
        const justified=ins.some(i=>i.justified),absence=ins.some(i=>i.type==='Falta');
        let unworked=0,note='',review=false,incomplete=false;
        if(a['Entrada laboral']!=null){
          entries++;
          const actual=a['Entrada laboral'];
          if(actual>start+Number(schedule.work_tolerance||0))late++;
          if(a['Entrada comida']!=null && a['Entrada comida']>foodIn+Number(schedule.food_in_tolerance||0))late++;
          if(a['Salida laboral']==null){review=true;incomplete=true;note='JORNADA INCOMPLETA: falta salida laboral. Requiere decisión del administrador';}
          else{
            const exit=a['Salida laboral'];
            // Se computan exclusivamente minutos de jornada no trabajados; la comida no se paga.
            const first=Math.max(0,Math.min(actual,foodOut)-start);
            const second=Math.max(0,Math.min(actual,end)-foodIn);
            const early=Math.max(0,end-Math.max(start,exit));
            // Si existe comida registrada, el exceso sobre la hora de regreso cuenta una sola vez.
            const lunchOver=a['Salida comida']!=null && a['Entrada comida']!=null
              ?Math.max(0,Math.min(end,a['Entrada comida'])-foodIn):0;
            // Entrada tardía después de comida: no duplicar retraso con lunchOver.
            unworked=Math.min(dailyMinutes,Math.max(0,first+second+early+(actual<=foodOut?lunchOver:0)));
            if(exit<actual){review=true;incomplete=true;unworked=0;note='JORNADA INCOMPLETA: salida anterior a entrada. Requiere revisión';}
            else note=unworked?'Minutos de jornada no trabajados':'Jornada completa';
          }
        }else if(absence){
          if(justified){justifiedAbsences++;review=true;note='Falta justificada: revisar si procede ajuste';}
          else{unjustifiedAbsences++;unworked=dailyMinutes;note='Falta no justificada registrada';}
        }else{
          missing++;unjustifiedAbsences++;unworked=dailyMinutes;review=true;note='FALTA propuesta: sin marcaciones (puedes justificarla)';
        }
        if(justified && unworked>0){review=true;unworked=0;note='Incidencia justificada: no se propone ajuste automático';}
        proposedMinutes+=unworked;
        days.push({day,minutes:unworked,amount:Math.round(unworked*minuteRate*100)/100,note,review,absence:absence||a['Entrada laboral']==null,incomplete,justified,incidents:ins.map(x=>x.type+(x.justified?' (justificada)':''))});
      }
      const proposedAdjustment=Math.round(proposedMinutes*minuteRate*100)/100;
      const net=Math.max(0,base+bonuses-manualDiscounts);
      return res.json({employee:{id:emp.id,name:emp.name,pay_type:emp.pay_type},base,bonuses,
        discounts:manualDiscounts,manualDiscounts,net,entries,late,incidents:incidents.length,
        unjustifiedAbsences,justifiedAbsences,missing,days,dailyMinutes,minuteRate,
        proposedMinutes,proposedAdjustment,requiresReview:true});
    }

    if(a==='payroll.save'){
      const r=req.body;

      await sql`
        INSERT INTO payroll_cuts(
          employee_id,
          period_type,
          start_date,
          end_date,
          payment_date,
          base_salary,
          bonuses,
          discounts,
          net_pay,
          entries,
          late_count,
          incidents_count,detail_json
        )
        VALUES(
          ${Number(r.employeeId)},
          ${r.periodType},
          ${r.startDate},
          ${r.endDate},
          ${r.paymentDate},
          ${Number(r.base)},
          ${Number(r.bonuses)},
          ${Number(r.discounts)},
          ${Number(r.net)},
          ${Number(r.entries)},
          ${Number(r.late)},
          ${Number(r.incidents)},
          ${JSON.stringify({days:r.reviewDays||[],minuteRate:r.minuteRate,approvedAdjustment:r.approvedAdjustment??0,attendance:(await sql`SELECT movement,status,registered_at FROM attendance WHERE employee_id=${Number(r.employeeId)} AND (registered_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${r.startDate} AND ${r.endDate} ORDER BY registered_at`).map(x=>({movement:x.movement,status:x.status,registered_at:x.registered_at}))})}::jsonb
        )
      `;

      return res.json({ok:true});
    }

    return res.status(400).json({error:'Acción desconocida'});

  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message});
  }
}