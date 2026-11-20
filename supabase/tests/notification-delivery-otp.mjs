import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/send-notification/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
for(const plan of ['FREE','STARTER','GROWTH','PREMIUM']) for(const verified of[false,null,true]) for(const notificationType of ['VISITOR_APPROVAL_REQUEST','VISITOR_ARRIVED']){
 const allowed=(plan!=='PREMIUM'&&notificationType==='VISITOR_APPROVAL_REQUEST')||verified===true;
 let handler,deviceReads=0,markedFailed=false;
 const client={rpc:async(name,args)=>{assert.equal(name,'visitor_phone_requirement_satisfied');assert.equal(args.p_visitor.is_otp_verified,verified);return {data:plan!=='PREMIUM'||verified===true,error:null}},from(table){if(table==='SSP_User_Device')deviceReads++;
  return{select(){return this},limit(){return this},eq(){return this},maybeSingle:async()=>({data:table==='SSP_Notification'?{notification_type:notificationType,notification_id:'n',delivery_status:'pending',recipient_id:'resident',recipient_type:'Resident',reference_table:'SSP_Non_Society_User',reference_id:'visitor'}:{role:'visitor',is_otp_verified:verified},error:null}),update(value){markedFailed=value.delivery_status==='failed';return this},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}};
 }};
 new Function('serve','createClient','DJWT','Deno','console','isUserAway',source)(fn=>handler=fn,()=>client,{}, {env:{get:()=>''}}, {log(){},error(){}},async()=>false);
 const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({record:{notification_type:notificationType,notification_id:'n',delivery_status:'pending',recipient_id:'resident',recipient_type:'Resident',reference_table:'SSP_Non_Society_User',reference_id:'visitor'}})}));
 const body=await response.json();if(!allowed){assert.equal(body.skipped,true);assert.equal(body.reason,'visitor_phone_not_verified');assert.equal(deviceReads,0);assert.equal(markedFailed,true);}else{assert.ok(deviceReads>0,'Eligible visitor reaches delivery device lookup');assert.notEqual(body.reason,'visitor_phone_not_verified');}
}
console.log('Notification delivery uses the database resident-plan rule: non-Premium walk-in approval requests proceed without OTP; Premium and arrival notifications retain OTP gating.');
