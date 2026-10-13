#!/usr/bin/env node
// Evidence-only operator console; human interactions must be genuine.
// Not a product gate validator. Generated oracle is never exposed to the UI.
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const args=new Map();
for(let i=3;i<process.argv.length;i+=2)args.set(process.argv[i].slice(2),process.argv[i+1]);
const need=k=>{const x=args.get(k);if(!x)throw Error('Missing --'+k);return x;};
const tick=()=>Number(process.hrtime.bigint()/1000000n);
async function openBundle(root){
 const mb=await readFile(join(root,'manifest-pb3.json'));
 const m=JSON.parse(mb);
 const ob=await readFile(join(root,'oracle.json')),tb=await readFile(join(root,'tasks.json'));
 if(sha(ob)!==m.scenario.oracle_sha256||sha(tb)!==m.scenario.tasks_sha256)throw Error('Oracle/task digest drift');
 if(m.candidate.head!=='973740ea5fbd58ec8be95fcb67fb042e6839cea6')throw Error('Candidate drift');
 if(m.run_roster?.length!==16||m.scenario.corpus_kind!=='CONTROLLED_HTTP_LAB')throw Error('Pre-registration missing');
 return {m,o:JSON.parse(ob),tasks:JSON.parse(tb),digest:sha(mb)};
}
const body=r=>new Promise((ok,no)=>{let b='';r.on('data',c=>{b+=c;if(b.length>4096){r.destroy();no(Error('too large'));}});r.on('end',()=>{try{ok(JSON.parse(b));}catch(e){no(e);}});r.on('error',no);});
const enc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function serve(root,bundle){
 const port=Number(args.get('port')||43182);
 const evidence=join(root,'evidence');await mkdir(evidence,{recursive:true});
 const path=join(evidence,'human-events.jsonl');
 try{const old=await readFile(path,'utf8');if(old.trim())throw Error('Existing measurements present: never reset active timer across process restart');}catch(e){if(e.code!=='ENOENT')throw e;}
 const all=new Map();let current=null;
 const append=async x=>writeFile(path,JSON.stringify({ts:new Date().toISOString(),protocol_digest:bundle.digest,operator_ref:bundle.m.operator.human_operator_ref,...x})+'\n',{flag:'a'});
 const state=()=>({protocol_digest:bundle.digest,current,runs:[...all].map(([id,s])=>({run_id:id,status:s.status,active_user_ms:s.active+(s.status==='ACTIVE'?tick()-s.begin:0),external_manual_actions:s.actions,outcome:s.outcome||null}))});
 const options=bundle.m.run_roster.map(r=>'<option value="'+enc(r.run_id)+'">'+enc(r.run_id)+' ('+enc(r.workflow)+')</option>').join('');
 const page='<!doctype html><meta charset="utf-8"><title>PB3 Human Console</title><style>body{font:17px/1.5 system-ui;max-width:850px;margin:24px auto;padding:12px}button,select{font:inherit;padding:9px;margin:5px}pre{white-space:pre-wrap;background:#eee;padding:12px}</style><h2>PB3 Human Measurement</h2><p>Human-only controls. Pause during passive download/processing waits. Agent automation must not click these controls.</p><p>Protocol: '+bundle.digest+'</p><select id="run">'+options+'</select><div><button onclick="send(\'start\')">Start</button><button onclick="send(\'pause\')">Pause passive wait</button><button onclick="send(\'resume\')">Resume</button><button onclick="send(\'action\')">+1 external manual action</button></div><select id="outcome"><option>SUCCESS_REPORTED</option><option>FAILED</option><option>ABANDONED</option><option>UNKNOWN</option><option>NOT_EXECUTED</option></select><button onclick="send(\'finish\')">Finish</button><p>Use +1 for CLI/keyboard/manual actions that the scenario web page does not log. Do not double-count. Reported success is NOT oracle verification.</p><pre id="status"></pre><script>async function send(kind){const r=await fetch("/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,run_id:document.querySelector("#run").value,outcome:document.querySelector("#outcome").value})});const v=await r.json();if(!r.ok)alert(v.error);refresh()}async function refresh(){document.querySelector("#status").textContent=JSON.stringify(await (await fetch("/state")).json(),null,2)}refresh();setInterval(refresh,2000)</script>';
 const server=createServer(async(req,res)=>{const reply=(code,obj,cookie)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store',...(cookie?{'set-cookie':cookie}:{})});res.end(json(obj));};try{
  const u=new URL(req.url||'/','http://127.0.0.1:'+port);
  if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page);return;}
  if(req.method==='GET'&&u.pathname==='/state'){reply(200,state());return;}
  if(req.method!=='POST'||u.pathname!=='/api'){reply(404,{error:'no route'});return;}
  if(req.headers['content-type']!=='application/json'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+port)){reply(403,{error:'origin/content-type denied'});return;}
  const {kind,run_id,outcome}=await body(req),r=bundle.m.run_roster.find(x=>x.run_id===run_id);
  if(!r){reply(400,{error:'unregistered run'});return;}
  let s=all.get(run_id);
  if(kind==='start'&&!current&&!s){s={status:'ACTIVE',begin:tick(),active:0,actions:0};all.set(run_id,s);current=run_id;await append({event:'start',run_id,task_id:r.task_id,workflow:r.workflow});reply(200,state(),'pb3_run='+encodeURIComponent(run_id)+'; Path=/; SameSite=Lax');return;}
  if(!s||current!==run_id){reply(409,{error:'no active matching run'});return;}
  if(kind==='pause'&&s.status==='ACTIVE'){s.active+=tick()-s.begin;s.status='PAUSED';await append({event:'pause',run_id,active_user_ms:s.active});reply(200,state());return;}
  if(kind==='resume'&&s.status==='PAUSED'){s.status='ACTIVE';s.begin=tick();await append({event:'resume',run_id});reply(200,state());return;}
  if(kind==='action'&&s.status==='ACTIVE'){s.actions++;await append({event:'external_manual_action',run_id});reply(200,state());return;}
  if(kind==='finish'&&['SUCCESS_REPORTED','FAILED','ABANDONED','UNKNOWN','NOT_EXECUTED'].includes(outcome)){
    if(s.status==='ACTIVE')s.active+=tick()-s.begin;s.status='FINISHED';s.outcome=outcome;current=null;
    await append({event:'finish',run_id,active_user_ms:s.active,external_manual_actions:s.actions,reported_outcome:outcome,verified:'PENDING'});
    await writeFile(join(evidence,'human-observations.json'),json({schema:'xdownload.pb3.observations.v1',protocol_digest:bundle.digest,corpus_kind:'CONTROLLED_HTTP_LAB',gate_verdict:'NOT_ISSUED',runs:[...all].filter(([_,v])=>v.status==='FINISHED').map(([id,v])=>({run_id:id,active_user_ms:v.active,external_manual_actions:v.actions,reported_outcome:v.outcome,verified:'PENDING'}))}));
    reply(200,state(),'pb3_run=; Path=/; Max-Age=0; SameSite=Lax');return;
  }
  reply(409,{error:'invalid state transition'});
 }catch(e){reply(500,{error:String(e)});}});
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
 console.log('PB3_HUMAN_CONSOLE=http://127.0.0.1:'+port);
 console.log('PB3_PROTOCOL_DIGEST='+bundle.digest);
}
async function collect(dir){
 const found=[];async function walk(d){for(const x of await readdir(d,{withFileTypes:true})){const p=join(d,x.name);if(x.isDirectory())await walk(p);else if(x.isFile()){found.push(p);if(found.length>400)throw Error('too many files');}}}await walk(dir);return found;
}
function frames(path){
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',path,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});
 if(r.error||r.status!==0)throw Error('ffmpeg unable to decode media');
 return r.stdout.split('\n').filter(s=>s.trim()&&!s.startsWith('#')).map(s=>s.split(',').pop().trim());
}
async function audit(root,b){
 const run=need('run'),r=b.m.run_roster.find(x=>x.run_id===run);if(!r)throw Error('Unregistered run ID');
 const folder=resolve(need('downloads')),paths=await collect(folder),observed=[];
 for(const path of paths){const data=await readFile(path);observed.push({file:basename(path),sha256:sha(data),bytes:data.length});}
 const o=b.o,t=r.task_id;
 const expected=t==='S1'?[o.S1.file]:t==='S2'?[o.S2.attachment]:t==='S3'?[o.S3.candidates.find(x=>basename(x.path)===o.S3.expected)]:t==='S4'?[o.S4.playlist,...o.S4.segments]:t==='S5'?o.S5.members:t==='S6'?o.S6.members:t==='S6NAV'?o.S6NAV.members.filter(x=>o.S6NAV.accessible_ids.includes(x.id)):null;
 if(!expected)throw Error('Unsupported task');
 const count=new Map();for(const x of observed)count.set(x.sha256,(count.get(x.sha256)||0)+1);
 let complete=true;for(const x of expected){const n=count.get(x.sha256)||0;if(n)count.set(x.sha256,n-1);else complete=false;}
 let verdict=complete&&[...count.values()].every(n=>n===0)?'BYTE_OR_MEMBERSHIP_MATCH':'INCOMPLETE_OR_MISMATCH';
 if(t==='S4'&&verdict!=='BYTE_OR_MEMBERSHIP_MATCH'){
  try{const truth=frames(join(root,'assets','s4','master.m3u8'));const match=paths.filter(p=>!p.endsWith('.m3u8')&&!p.endsWith('.ts')).some(p=>{try{const got=frames(p);return got.length>0&&got.length===truth.length&&truth.every((x,i)=>x===got[i]);}catch{return false;}});if(match)verdict='DECODED_FRAMES_MATCH';}catch{verdict='NOT_EXECUTED_MEDIA_VALIDATOR_ERROR';}
 }
 const proof={schema:'xdownload.pb3.output-audit.v1',run_id:run,task_id:t,protocol_digest:b.digest,expected_count:expected.length,observed_count:observed.length,verdict,gate_verdict:'NOT_ISSUED',observed};
 const evidence=join(root,'evidence','audits');await mkdir(evidence,{recursive:true});await writeFile(join(evidence,run+'.json'),json(proof));
 console.log('PB3_OUTPUT_AUDIT='+verdict);
 if(!['BYTE_OR_MEMBERSHIP_MATCH','DECODED_FRAMES_MATCH'].includes(verdict))process.exitCode=1;
}
try{const root=resolve(need('bundle')),b=await openBundle(root);if(process.argv[2]==='serve')await serve(root,b);else if(process.argv[2]==='audit')await audit(root,b);else throw Error('Use serve --bundle <dir> or audit --bundle <dir> --run <id> --downloads <dir>');}catch(e){console.error(String(e));process.exitCode=1;}
