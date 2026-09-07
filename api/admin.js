import { db } from './_db.js';
import { hashPin, validSession } from './_auth.js';

function requireAdmin(req,res){ if(!validSession(req)){res.status(401).json({error:'Sesión de administrador requerida'});return false;} return true; }

export default async function handler(req,res){
  if(!requireAdmin(req,res)) return;
  const sql=db();
  try{
    if(req.method==='GET'){
      const [settings,employees,attendance,incidents,adjustments,cuts]=await Promise.all([
        sql`SELECT id,work_start,work_tolerance,food_out,food_out_tolerance,food_in,food_in_tolerance,work_end,work_end_tolerance FROM settings WHERE id=1`,
        sql`SELECT id,name,role,pay_type,salary,active,created_at FROM employees ORDER BY active DESC,name`,
        sql`SELECT a.id,a.employee_id,e.name,a.movement,a.status,a.method,a.photo_data,a.registered_at FROM attendance a JOIN employees e ON e.id=a.employee_id ORDER BY a.registered_at DESC LIMIT 500`,
        sql`SELECT i.id,i.employee_id,e.name,i.incident_date,i.type,i.justified,i.notes,i.created_at FROM incidents i JOIN employees e ON e.id=i.employee_id ORDER BY i.incident_date DESC,i.id DESC LIMIT 300`,
        sql`SELECT a.id,a.employee_id,e.name,a.adjust_date,a.type,a.amount,a.reason,a.notes,a.created_at FROM adjustments a JOIN employees e ON e.id=a.employee_id ORDER BY a.adjust_date DESC,a.id DESC LIMIT 300`,
        sql`SELECT p.id,p.employee_id,e.name,p.period_type,p.start_date,p.end_date,p.payment_date,p.base_salary,p.bonuses,p.discounts,p.net_pay,p.entries,p.late_count,p.incidents_count,p.created_at FROM payroll_cuts p JOIN employees e ON e.id=p.employee_id ORDER BY p.created_at DESC LIMIT 200`
      ]);
      return res.json({settings:settings[0],employees,attendance,incidents,adjustments,cuts});
    }
    if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
    const a=req.body?.action;
    if(a==='employee.create'){
      const {name,role,pin,payType,salary}=req.body;
      if(!name||!/^\d{4,6}$/.test(String(pin))||Number(salary)<0) return res.status(400).json({error:'Datos inválidos'});
      await sql`INSERT INTO employees(name,role,pin_hash,pay_type,salary) VALUES(${name},${role||null},${hashPin(pin)},${payType==='Quincenal'?'Quincenal':'Semanal'},${Number(salary)})`;
      return res.json({ok:true});
    }
    if(a==='employee.toggle'){
      await sql`UPDATE employees SET active=${!!req.body.active} WHERE id=${Number(req.body.id)}`;
      return res.json({ok:true});
    }
    if(a==='settings.update'){
      const r=req.body;
      await sql`UPDATE settings SET work_start=${r.workStart},work_tolerance=${Number(r.workTolerance)},food_out=${r.foodOut},food_out_tolerance=${Number(r.foodOutTolerance)},food_in=${r.foodIn},food_in_tolerance=${Number(r.foodInTolerance)},work_end=${r.workEnd},work_end_tolerance=${Number(r.workEndTolerance)},updated_at=NOW() WHERE id=1`;
      return res.json({ok:true});
    }
    if(a==='admin.pin'){
      const pin=String(req.body.pin||'');
      if(!/^\d{4,6}$/.test(pin)) return res.status(400).json({error:'PIN inválido'});
      await sql`UPDATE settings SET admin_pin_hash=${hashPin(pin)},updated_at=NOW() WHERE id=1`;
      return res.json({ok:true});
    }
    if(a==='incident.create'){
      const r=req.body;
      await sql`INSERT INTO incidents(employee_id,incident_date,type,justified,notes) VALUES(${Number(r.employeeId)},${r.date},${r.type},${!!r.justified},${r.notes||null})`;
      return res.json({ok:true});
    }
    if(a==='adjustment.create'){
      const r=req.body;
      await sql`INSERT INTO adjustments(employee_id,adjust_date,type,amount,reason,notes) VALUES(${Number(r.employeeId)},${r.date},${r.type==='Bono'?'Bono':'Descuento'},${Number(r.amount)},${r.reason},${r.notes||null})`;
      return res.json({ok:true});
    }
    if(a==='payroll.calculate'){
      const r=req.body, eid=Number(r.employeeId);
      const emp=(await sql`SELECT id,name,pay_type,salary FROM employees WHERE id=${eid}`)[0];
      if(!emp) return res.status(404).json({error:'Empleado no encontrado'});
      const adj=await sql`SELECT type,COALESCE(SUM(amount),0)::numeric AS total FROM adjustments WHERE employee_id=${eid} AND adjust_date BETWEEN ${r.startDate} AND ${r.endDate} GROUP BY type`;
      const bonuses=Number(adj.find(x=>x.type==='Bono')?.total||0), discounts=Number(adj.find(x=>x.type==='Descuento')?.total||0);
      const at=(await sql`SELECT COUNT(*) FILTER (WHERE movement='Entrada laboral')::int AS entries,COUNT(*) FILTER (WHERE movement='Entrada laboral' AND status='RETARDO')::int AS late FROM attendance WHERE employee_id=${eid} AND (registered_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${r.startDate} AND ${r.endDate}`)[0];
      const inc=(await sql`SELECT COUNT(*)::int AS count FROM incidents WHERE employee_id=${eid} AND incident_date BETWEEN ${r.startDate} AND ${r.endDate}`)[0].count;
      const base=Number(emp.salary), net=Math.max(0,base+bonuses-discounts);
      return res.json({employee:emp,base,bonuses,discounts,net,entries:at.entries,late:at.late,incidents:inc});
    }
    if(a==='payroll.save'){
      const r=req.body;
      await sql`INSERT INTO payroll_cuts(employee_id,period_type,start_date,end_date,payment_date,base_salary,bonuses,discounts,net_pay,entries,late_count,incidents_count)
        VALUES(${Number(r.employeeId)},${r.periodType},${r.startDate},${r.endDate},${r.paymentDate},${Number(r.base)},${Number(r.bonuses)},${Number(r.discounts)},${Number(r.net)},${Number(r.entries)},${Number(r.late)},${Number(r.incidents)})`;
      return res.json({ok:true});
    }
    return res.status(400).json({error:'Acción desconocida'});
  }catch(e){console.error(e);return res.status(500).json({error:e.message});}
}
