// Run: node supabase/tests/parking-consistency.mjs
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
import{parkingCounts}from'../functions/_shared/parking-counts.ts';
import{contactParkingSlot}from'../functions/_shared/contact.ts';
assert.deepEqual(parkingCounts({parking_slot:'152',covered_parking:75}),{totalParking:152,occupiedParking:75,vacantParking:77});
assert.deepEqual(parkingCounts({parking_slot:'152',covered_parking:0}),{totalParking:152,occupiedParking:0,vacantParking:152});
assert.equal(parkingCounts({parking_slot:152,covered_parking:152}).vacantParking,0);
assert.deepEqual(parkingCounts(null),{totalParking:0,occupiedParking:0,vacantParking:0});
const users=Array.from({length:35},(_,i)=>({user_type:'owner',contact:'contact-'+i}));
const contacts=users.map((u,i)=>({contact_id:u.contact,vehicle_type:i<19?'two_wheeler':'four_wheeler'}));
function query(data){return{select(){return this},eq(){return this},in(){return this},gte(){return this},then(resolve,reject){return Promise.resolve({data,count:0,error:null}).then(resolve,reject)}}}
const client={from:table=>query(table==='SSP_Society_User'?users:table==='SSP_Contact'?contacts:[])};
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/get-dashboard/index.ts',import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,''));
const build=new Function('Deno','createClient','requireAuth','corsHeaders','parkingCounts','contactParkingSlot',source+'\nreturn buildDashboardResponse;')
 ({env:{get:()=>''},serve(){}},()=>client,fn=>fn,{},parkingCounts,contactParkingSlot);
const society={society_id:'society',parking_slot:'152',covered_parking:75,total_unit:5003};
const response=await build({user_id:'resident',role:['resident'],society,contact:null,tower:null,block:null},[],false);
assert.equal(response.status,200);
const stats=(await response.json()).data.society.statistics;
assert.equal(stats.totalParking,152);assert.equal(stats.occupiedParking,75);assert.equal(stats.vacantParking,77);
assert.equal(stats.twoWheelers,19);assert.equal(stats.fourWheelers,16);
const switchSource=readFileSync(new URL('../functions/switch-user/index.ts',import.meta.url),'utf8');
const start=switchSource.indexOf('\n      const { data: allSocietyUsers }')+1;const end=switchSource.indexOf('    } else {\n      societyDetail =',start);
const fragment=stripTypeScriptTypes(switchSource.slice(start,end));
const switchClient={from:()=>query(users.map((u,i)=>({...u,contact:{vehicle_type:i<19?'two_wheeler':'four_wheeler'}})))};
const compute=new Function('supabase','societyId','societyRecord','unwrapOne','parkingCounts','return (async()=>{let societyDetail;'+fragment+'\nreturn societyDetail;})();');
const switched=await compute(switchClient,'society',society,value=>Array.isArray(value)?value[0]:value,parkingCounts);
assert.equal(switched.vacantParkingSlots,77);assert.equal(switched.twoWheelers,19);assert.equal(switched.fourWheelers,16);
console.log('Parking consistency tests passed: 152 total, 75 occupied, 77 vacant; registered vehicle counts remain 19 and 16 in dashboard and role-switch responses.');

const dashboardUser={user_id:'41526542-03fa-42e3-b63a-62a4947496f6',role:['resident'],society,contact:{parking_slot:'DEMO-P-00009',name:'Parking testing'},tower:null,block:null};
let parkingResponse=await build(dashboardUser,[],false);
assert.equal((await parkingResponse.json()).data.user.parkingSlot,'DEMO-P-00009');
dashboardUser.contact.parking_slot='P-UPDATED';
parkingResponse=await build(dashboardUser,[],false);
assert.equal((await parkingResponse.json()).data.user.parkingSlot,'P-UPDATED');
dashboardUser.contact.parking_slot=null;
parkingResponse=await build(dashboardUser,[],false);
assert.equal((await parkingResponse.json()).data.user.parkingSlot,null);
console.log('Dashboard returns the current contact parking slot, including changed and cleared values.');
