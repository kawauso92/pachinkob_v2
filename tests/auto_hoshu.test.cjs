const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,'..');
function htmlScript(p){return fs.readFileSync(p,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]}
function context(script){const c=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById(){return {}},querySelectorAll(){return []}},console,setTimeout(){}});vm.runInContext(script,c);return c}
const a=context(htmlScript(path.join(root,'../pachinkoa_v7/index.html')));
const b=context(htmlScript(path.join(root,'index.html')));
const props=new Map([['autoHoshuStartDate_v1','2026-09-08']]);
const mk=(date,uchi,rot,kitai,sagi,cash,hoshu=0)=>{const r=Array(24).fill('');r[0]=date;r[2]='machine';r[4]=uchi;r[7]=kitai;r[10]=rot;r[14]=sagi;r[15]=hoshu;r[20]=99999;r[22]=cash;return r};
let rows=[mk('2026-09-07','代1',200,1800,10000,0,12345),mk('2026-09-08','代1',200,1500,5000,5000),mk('2026-09-08','代1',200,2100,5000,5000),mk('2026-09-08','代2',200,1500,100,0),mk('2026-09-09','代1',200,2000,5000,0),mk('2026-09-08','自分',200,2000,5000,0)];
let writes=0,locked=false;
const sheet={getLastRow:()=>rows.length+1,getRange:(r,c,n=1,w=1)=>({getValues:()=>rows.slice(r-2,r-2+n).map(v=>v.slice(c-1,c-1+w)),getValue:()=>rows[r-2][c-1],setValue:v=>{assert(locked);writes++;rows[r-2][c-1]=v}})};
const gas=vm.createContext({console,SPREADSHEET_ID:'test',SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},getMasters:()=>({kishus:[{name:'machine',jikan:200}]}),PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},Utilities:{formatDate:()=> '2026-09-09',DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,v)=>crypto.createHash('sha256').update(v).digest(),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url')},LockService:{getScriptLock:()=>({waitLock(){assert(!locked);locked=true},releaseLock(){locked=false}})}});
vm.runInContext(fs.readFileSync(path.join(root,'gas/AutoHoshu.gs'),'utf8'),gas);
const g=s=>vm.runInContext(s,gas);
let tests=0;
for(const sagi of [-1000,0,4999,5000,7500,9999,10000,12500])for(const kitai of [0,1500,1799,1800,2000,2300,2500])for(const cash of [0,10000,50000]){
assert.equal(JSON.stringify(a.calcFinalReward(sagi,kitai,cash,'代1')),JSON.stringify(b.calcFinalReward(sagi,kitai,cash,'代1')));tests++;
}
const fixtures=[
 [{date:'2026-09-08',uchi:'代1',row:2,kishu:'machine',soKaiten:200,kitaiJikyu:1500,sagitama:5000,genkinInvest:5000},{date:'2026-09-08',uchi:'代1',row:3,kishu:'machine',soKaiten:200,kitaiJikyu:2100,sagitama:5000,genkinInvest:5000}],
 [{date:'2026-09-08',uchi:'代1',row:2,kishu:'machine',soKaiten:200,kitaiJikyu:-100,sagitama:10000,genkinInvest:1000},{date:'2026-09-08',uchi:'代1',row:3,kishu:'machine',soKaiten:400,kitaiJikyu:2300,sagitama:0,genkinInvest:0}]
];
for(const recs of fixtures){let prev={rewardWeight:0,rewardWeighted:0},sagi=0,cash=0;for(const r of recs){const w=a.getRewardWeight(r.soKaiten,200,r.kitaiJikyu);prev.rewardWeight+=w.weight;prev.rewardWeighted+=w.weighted;sagi+=r.sagitama;cash+=r.genkinInvest}const avg=a.getRewardAverage(prev,{weight:0,weighted:0});const result=b.buildHoshuConfirmRows('2026-09-08',recs,[{name:'machine',jikan:200}])[0];assert.equal(a.calcFinalReward(sagi,avg,cash,'代1').final,result.hoshu)}
assert.equal(a.getRewardWeight(100,0,2000).weight,0);assert.equal(a.getRewardWeight(100,200,'').weight,0);
let result=g('AutoHoshu.run()');assert(result.success);assert.equal(result.processed.length,2);assert.equal(rows[0][15],12345);assert.equal(rows[1][15],0);assert.equal(rows[2][15],8500);assert.equal(rows[3][15],0);assert.equal(rows[4][15],0);
const firstWrites=writes;g('AutoHoshu.run()');assert.equal(writes,firstWrites,'including zero reward must skip');
rows[2][14]=7500;assert.equal(g('AutoHoshu.status()').groups.find(x=>x.uchi==='代1').status,'changed');g('AutoHoshu.run()');assert.equal(writes,firstWrites);
result=g("AutoHoshu.run('2026-09-08',true)");assert(result.success);assert.equal(rows[2][15],11000);assert.equal(g('AutoHoshu.status()').groups.find(x=>x.uchi==='代1').status,'confirmed');
assert.throws(()=>g("AutoHoshu.run('2026-09-07',true)"));assert.throws(()=>g("AutoHoshu.run('2026-09-09',true)"));assert.equal(rows[0][15],12345);
assert(rows.every(r=>r[20]===99999),'U must remain untouched');
const cache=new Map();
a.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
cache.set('ruikei_v7_2026-09-08_代1',JSON.stringify({sagitama:5000,genkinInvest:5000,choTama:100,genkinBalls:200,kitaiShigotoW:999999,shigotoTotal:500}));
assert.equal(a.getRuikeiData('代1','2026-09-08').rewardVersion,0);
assert.equal(a.getRuikeiData('代1','2026-09-08').sagitama,5000);
assert.equal(a.getRuikeiData('代1','2026-09-08').choTama,100);
cache.set('ruikei_v7_2026-09-08_代1',JSON.stringify({sagitama:5000,genkinInvest:5000,choTama:100,genkinBalls:200,rewardWeight:1,rewardWeighted:1500,rewardVersion:1}));
a.addRuikeiData('代1','2026-09-08',{sagitama:5000,genkinInvest:5000,rewardWeight:1,rewardWeighted:2100});
const carried=a.getRuikeiData('代1','2026-09-08');
assert.equal(carried.sagitama,10000);assert.equal(carried.genkinInvest,10000);assert.equal(carried.choTama,100);
assert.equal(a.getRewardAverage(carried,{weight:0,weighted:0}),1800);
assert.equal(a.calcFinalReward(carried.sagitama,1800,carried.genkinInvest,'代1').final,8500);
assert.equal(a.getRuikeiData('代1','2026-09-09').sagitama,0);
assert.equal(a.getRuikeiData('代2','2026-09-08').sagitama,0);
console.log(`PASS: ${tests} formula cases, AppA/AppB segment aggregation, GAS totals, 0 reward/idempotency, historical/current exclusions, mutation detection, manual reconfirm, locks, U preservation. No network or real storage.`);
