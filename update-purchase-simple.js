const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.POSTGRES_URL,ssl:{rejectUnauthorized:false}});
const sid='809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const cid='9e16d892-4324-4568-be60-163aa1665683';
(async()=>{
  try{
    console.log('=== Updating Purchase Metadata ===\n');
    const pay=await p.query("SELECT id,metadata FROM payments WHERE student_id=$1 AND status='succeeded' AND (metadata->>'courseId'=$2 OR metadata->>'course_id'=$2) ORDER BY created_at DESC LIMIT 1",[sid,cid]);
    if(pay.rows.length===0){console.log('No payment found');p.end();return;}
    const pm=typeof pay.rows[0].metadata==='string'?JSON.parse(pay.rows[0].metadata):pay.rows[0].metadata;
    console.log('Payment found:',pay.rows[0].id);
    console.log('Payment metadata keys:',Object.keys(pm||{}).join(', '));
    const pur=await p.query('SELECT id,metadata,purchase_tier FROM student_course_purchases WHERE student_id=$1 AND course_id=$2 AND is_active=true',[sid,cid]);
    if(pur.rows.length===0){console.log('No purchase found');p.end();return;}
    const cm=pur.rows[0].metadata||{};
    const comp={...pm,...cm,courseId:cid,purchaseTier:pur.rows[0].purchase_tier||pm.purchaseTier||pm.sessionCount||30,sessionCount:pur.rows[0].purchase_tier||pm.sessionCount||pm.purchaseTier||30};
    await p.query('UPDATE student_course_purchases SET metadata=$1,updated_at=NOW() WHERE id=$2',[JSON.stringify(comp),pur.rows[0].id]);
    console.log('SUCCESS: Purchase updated');
    console.log('Purchase ID:',pur.rows[0].id);
    console.log('Complete metadata keys:',Object.keys(comp).join(', '));
    console.log('Has startDate:',!!(comp.startDate||comp.schedule?.startDate));
    console.log('Has timeSlot:',!!(comp.timeSlot||comp.schedule?.timeSlot));
    console.log('Has classTypeId:',!!comp.classTypeId);
    p.end();
  }catch(e){console.error('Error:',e.message);p.end();process.exit(1);}
})();

