#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { URL } from 'node:url';

const HEAD='5f70de80310d9ecd8a486a34d3ab7d67877a0fde';
const TREE='7828bf12eb57b73c7ce38d7f30ed5939925d60d7';
const PLAN_ID='g0-plan/v0.1.0-primary';
const PLAN_DIGEST='44f437a2dea560cecd5341e87f6a8d0bae1af53b552abac51a4d5db2addf0b15';
const PORT=43181;

const sha=b=>createHash('sha256').update(b).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const json=v=>JSON.stringify(stable(v),null,2)+'\n';
const bytes=(n,seed)=>{const s=createHash('sha256').update(seed).digest();const b=Buffer.alloc(n);for(let i=0;i<n;i++)b[i]=(s[i%s.length]+i*17)&255;return b;};
const mp4=seed=>{const b=bytes(98304,seed);Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]).copy(b);return b;};
const amap=a=>{const m=new Map();for(let i=0;i<a.length;i++){if(!a[i].startsWith('--'))continue;const k=a[i].slice(2),n=a[i+1];if(n&&!n.startsWith('--')){m.set(k,n);i++;}else m.set(k,'true');}return m;};
const req=(m,k)=>{const v=m.get(k);if(!v)throw new Error('missing --'+k);return v;};
const mk=async p=>mkdir(p,{recursive:true});
const put=async(root,p,b)=>{const f=join(root,p);await mk(dirname(f));await writeFile(f,b);return{path:p.replaceAll('\\','/'),bytes:b.length,sha256:sha(b)};};
const html=(t,b,id)=>'<!doctype html><meta charset="utf-8"><title>'+t+'</title><h1>'+t+'</h1>'+b+
(id?'<script>document.addEventListener("click",e=>{const a=e.target.closest("a,button,input[type=submit]");if(a)fetch("/__pb3__/event",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"human_click",task_id:"'+id+'",label:(a.innerText||a.value||a.id||a.tagName).slice(0,120),path:location.pathname})}).catch(()=>{});});</script>':'');
const cookies=h=>Object.fromEntries((h||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
const body=r=>new Promise((ok,bad)=>{const x=[];let n=0;r.on('data',c=>{n+=c.length;if(n>1048576){bad(new Error('body too large'));r.destroy();}else x.push(c);});r.on('end',()=>ok(Buffer.concat(x)));r.on('error',bad);});
const ff=(args)=>{const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.error)throw new Error('ffmpeg unavailable: '+r.error.message);if(r.status!==0)throw new Error('ffmpeg failed: '+(r.stderr||'').slice(-2000));};
const fileRecord=async(root,p)=>{const b=await readFile(join(root,p));return{path:p.replaceAll('\\','/'),bytes:b.length,sha256:sha(b)};};

async function prepare(a){
  const out=resolve(req(a,'out')),operator=req(a,'operator'),host=a.get('host')||'127.0.0.1',port=Number(a.get('port')||PORT);
  await mk(join(out,'assets')); await mk(join(out,'evidence'));
  const o={schema:'xdownload.pb3.oracle.v1',bundle:'pb3-controlled-local-v1',generated_without_xdownload_output:true,S1:{},S2:{},S3:{},S4:{},S5:{},S6:{},S6NAV:{}};
  o.S1.file=await put(join(out,'assets'),'s1/report.bin',bytes(65536,'PB3:S1'));
  o.S2.attachment=await put(join(out,'assets'),'s2/private-attachment.bin',bytes(81920,'PB3:S2'));
  await mk(join(out,'assets','s3'));
  const mediaSpecs=[['trailer.mp4',2,'blue'],['presentation-main.mp4',8,'green'],['sponsor.mp4',3,'red']];
  o.S3.candidates=[];
  for(const [n,d,c] of mediaSpecs){
    const p=join(out,'assets','s3',n);
    ff(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c='+c+':s=320x180:r=24','-t',String(d),'-c:v','mpeg4','-q:v','5','-movflags','+faststart',p]);
    o.S3.candidates.push(await fileRecord(join(out,'assets'),'s3/'+n));
  }
  o.S3.expected='presentation-main.mp4';
  await mk(join(out,'assets','s4'));
  const hlsOut=join(out,'assets','s4','master.m3u8');
  ff(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=24','-t','12','-c:v','mpeg2video','-g','48','-sc_threshold','0','-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',join(out,'assets','s4','seg-%02d.ts'),hlsOut]);
  o.S4.playlist=await fileRecord(join(out,'assets'),'s4/master.m3u8');
  o.S4.segments=[];
  for(const n of (await readdir(join(out,'assets','s4'))).filter(x=>/^seg-\d\d\.ts$/.test(x)).sort())o.S4.segments.push(await fileRecord(join(out,'assets'),'s4/'+n));
  o.S4.duration_seconds=12;o.S4.natural_end=true;o.S4.generated_by='ffmpeg-controlled-local';
  const collection=async(prefix,count)=>{const r=[];for(let i=1;i<=count;i++){const n=prefix+'-'+String(i).padStart(2,'0')+'.bin';r.push({id:prefix+'-member-'+String(i).padStart(2,'0'),...(await put(join(out,'assets'),prefix+'/'+n,bytes(24576+i,'PB3:'+prefix+':'+i)))});}return r;};
  o.S5.members=await collection('s5',6);o.S5.expected_count=6;o.S5.continuation_scope='NONE';
  o.S6.members=await collection('s6',16);o.S6.expected_count=16;o.S6.pages=2;o.S6.natural_end=true;
  o.S6NAV.members=await collection('s6nav',18);o.S6NAV.expected_count=18;o.S6NAV.pages=2;o.S6NAV.accessible_ids=o.S6NAV.members.slice(0,16).map(x=>x.id);o.S6NAV.inaccessible_ids=o.S6NAV.members.slice(16).map(x=>x.id);o.S6NAV.expected_stop='AUTH_REQUIRED';
  const ob=Buffer.from(json(o));await writeFile(join(out,'oracle.json'),ob);
  const origin='http://'+host+':'+port;
  const tasks={schema:'xdownload.pb3.human-tasks.v1',note:'Do not open oracle.json during measurement.',credentials:{full:{username:'pb3-full',password:'pb3-full-local-only'},limited:{username:'pb3-limited',password:'pb3-limited-local-only'}},tasks:[
    {id:'S1',instruction:'Download the requested direct report file.',url:origin+'/s1/report.bin'},
    {id:'S2',instruction:'Sign in with the full local account and download the explicit private attachment.',url:origin+'/s2/page'},
    {id:'S3',instruction:'Acquire the full main presentation video, not the trailer or sponsor.',url:origin+'/s3/page'},
    {id:'S4',instruction:'Acquire the complete supported HLS VOD.',url:origin+'/s4/page'},
    {id:'S5',instruction:'Download every resource on the current page only.',url:origin+'/s5/page'},
    {id:'S6',instruction:'Download the complete public playlist through declared continuation to natural end.',url:origin+'/s6/page/1'},
    {id:'S6NAV',instruction:'Sign in with the limited account. Preserve whole-collection scope, follow declared continuation, and acquire everything authorized.',url:origin+'/s6nav/page/1'}
  ]};
  const tb=Buffer.from(json(tasks));await writeFile(join(out,'tasks.json'),tb);
  const m={schema:'xdownload.t022.pb3-manifest.v2',campaign_id:'PB3',authority:{issue:81,controller_comment:6138124484,g0_plan_id:PLAN_ID,g0_plan_digest:PLAN_DIGEST},candidate:{head:HEAD,tree:TREE,mutation_allowed:false},scenario:{bundle_id:'pb3-controlled-local-v1',origin,oracle_sha256:sha(ob),tasks_sha256:sha(tb),generator:'tools/pb3-scenario-lab.mjs',independent_of_xdownload_output:true},operator:{human_operator_ref:operator,ai_role:'LOGGING_INSTRUMENTATION_ONLY'},baselines:{browser:'Chrome for Testing 120.0.6099.109',ytdlp:'2026.09.27.232945',substitution_allowed:false},measurement:{sample_unit:'ONE_END_TO_END_USER_ACQUISITION_TASK',same_task_same_scope_same_auth:true,active_user_time:'human active interaction only; exclude passive transfer/process wait and scripted sleeps',manual_actions:'human click/type/submit/select/confirm/navigation/retry/recovery only',confirmation_burden_included:true,rerun_is_new_sample:false,oracle_hidden_from_operator:true},planned_tasks:['S1','S2','S3','S4','S5','S6','S6NAV'],comparisons:{G1a:'S5/S6 manual per-resource vs xDownload batch',G1b:'S6NAV manual continuation vs xDownload declared continuation',G1c:'S3 manual/raw selection vs xDownload semantic/ASSISTED selection including confirmation'},freeze:{created_at:new Date().toISOString(),results_seen_before_freeze:false,manifest_sha256:null}};
  const mb=Buffer.from(json(m));await writeFile(join(out,'manifest-pb3.json'),mb);await writeFile(join(out,'SHA256SUMS.txt'),sha(mb)+'  manifest-pb3.json\n'+sha(ob)+'  oracle.json\n'+sha(tb)+'  tasks.json\n');await writeFile(join(out,'evidence','requests.jsonl'),'');
  console.log('PB3_BUNDLE='+out);console.log('PB3_MANIFEST_SHA256='+sha(mb));console.log('PB3_ORACLE_SHA256='+sha(ob));console.log('PB3_ORIGIN='+origin);
}

async function serve(a){
  const dir=resolve(req(a,'bundle')),m=JSON.parse(await readFile(join(dir,'manifest-pb3.json'),'utf8')),o=JSON.parse(await readFile(join(dir,'oracle.json'),'utf8')),origin=new URL(m.scenario.origin),host=a.get('host')||origin.hostname,port=Number(a.get('port')||origin.port||PORT);
  const log=async e=>writeFile(join(dir,'evidence','requests.jsonl'),JSON.stringify({ts:new Date().toISOString(),...e})+'\n',{flag:'a'});
  const asset=async(p,res,ct='application/octet-stream')=>{const b=await readFile(join(dir,'assets',p));res.writeHead(200,{'content-type':ct,'content-length':String(b.length),'cache-control':'no-store'});res.end(b);};
  const server=createServer(async(r,res)=>{try{
    const u=new URL(r.url||'/', 'http://'+(r.headers.host||host+':'+port)),role=cookies(r.headers.cookie).pb3_session||'anonymous';await log({kind:'http_request',method:r.method||'GET',path:u.pathname,role});
    if(u.pathname==='/__pb3__/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,candidate:m.candidate,bundle:m.scenario.bundle_id}));return;}
    if(u.pathname==='/__pb3__/event'&&r.method==='POST'){let e={};try{e=JSON.parse((await body(r)).toString());}catch{}await log({kind:'ui_event',role,...e});res.writeHead(204);res.end();return;}
    if(u.pathname==='/login'&&r.method==='GET'){res.writeHead(200,{'content-type':'text/html'});res.end(html('PB3 Local Login','<form method="post"><input name="username"><input type="password" name="password"><button>Sign in</button></form>','AUTH'));return;}
    if(u.pathname==='/login'&&r.method==='POST'){const f=new URLSearchParams((await body(r)).toString()),user=f.get('username'),pass=f.get('password');let rr=null;if(user==='pb3-full'&&pass==='pb3-full-local-only')rr='full';if(user==='pb3-limited'&&pass==='pb3-limited-local-only')rr='limited';if(!rr){res.writeHead(403);res.end('invalid local PB3 credentials');return;}await log({kind:'login_success',role:rr});res.writeHead(302,{location:'/', 'set-cookie':'pb3_session='+rr+'; Path=/; HttpOnly; SameSite=Lax'});res.end();return;}
    if(u.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html('PB3 Scenario Lab','<ul><li><a href="/s1/report.bin">S1</a></li><li><a href="/s2/page">S2</a></li><li><a href="/s3/page">S3</a></li><li><a href="/s4/page">S4</a></li><li><a href="/s5/page">S5</a></li><li><a href="/s6/page/1">S6</a></li><li><a href="/s6nav/page/1">S6NAV</a></li></ul><p>session='+role+'</p>','INDEX'));return;}
    if(u.pathname==='/s1/report.bin'){await asset('s1/report.bin',res);return;}
    if(u.pathname==='/s2/page'){if(role!=='full'){res.writeHead(302,{location:'/login'});res.end();return;}res.writeHead(200,{'content-type':'text/html'});res.end(html('S2 Private Attachment','<a href="/s2/private-attachment.bin">Download explicit attachment</a>','S2'));return;}
    if(u.pathname==='/s2/private-attachment.bin'){if(role!=='full'){res.writeHead(401);res.end('AUTH_REQUIRED');return;}await asset('s2/private-attachment.bin',res);return;}
    if(u.pathname==='/s3/page'){res.writeHead(200,{'content-type':'text/html'});res.end(html('S3 Media Candidates','<p>Requested: full main presentation.</p><ul><li><a href="/s3/trailer.mp4">Conference clip A — short preview</a></li><li><a href="/s3/presentation-main.mp4">Conference clip B — complete presentation</a></li><li><a href="/s3/sponsor.mp4">Conference clip C — sponsor segment</a></li></ul>','S3'));return;}
    for(const n of ['trailer.mp4','presentation-main.mp4','sponsor.mp4'])if(u.pathname==='/s3/'+n){await asset('s3/'+n,res,'video/mp4');return;}
    if(u.pathname==='/s4/page'){res.writeHead(200,{'content-type':'text/html'});res.end(html('S4 HLS VOD','<a href="/s4/master.m3u8">HLS manifest</a>','S4'));return;}
    if(u.pathname==='/s4/master.m3u8'){await asset('s4/master.m3u8',res,'application/vnd.apple.mpegurl');return;}const h=/^\/s4\/(seg-\d\d\.ts)$/.exec(u.pathname);if(h){await asset('s4/'+h[1],res,'video/mp2t');return;}
    if(u.pathname==='/s5/page'){const links=o.S5.members.map(x=>'<li><a href="/s5/'+basename(x.path)+'">'+x.id+'</a></li>').join('');res.writeHead(200,{'content-type':'text/html'});res.end(html('S5 Current-page Collection','<ul>'+links+'</ul>','S5'));return;}const f5=/^\/s5\/(s5-\d\d\.bin)$/.exec(u.pathname);if(f5){await asset('s5/'+f5[1],res);return;}
    const p6=/^\/s6\/page\/([12])$/.exec(u.pathname);if(p6){const page=Number(p6[1]),mm=page===1?o.S6.members.slice(0,8):o.S6.members.slice(8),links=mm.map(x=>'<li><a href="/s6/'+basename(x.path)+'">'+x.id+'</a></li>').join(''),next=page===1?'<a href="/s6/page/2">Continue collection</a>':'<p>Natural end: no continuation.</p>';res.writeHead(200,{'content-type':'text/html'});res.end(html('S6 Playlist page '+page,'<ul>'+links+'</ul>'+next,'S6'));return;}const f6=/^\/s6\/(s6-\d\d\.bin)$/.exec(u.pathname);if(f6){await asset('s6/'+f6[1],res);return;}
    const pn=/^\/s6nav\/page\/([12])$/.exec(u.pathname);if(pn){if(role!=='limited'){res.writeHead(302,{location:'/login'});res.end();return;}const page=Number(pn[1]),mm=page===1?o.S6NAV.members.slice(0,10):o.S6NAV.members.slice(10),links=mm.map(x=>'<li><a href="/s6nav/'+basename(x.path)+'">'+x.id+'</a></li>').join(''),next=page===1?'<a href="/s6nav/page/2">Continue declared collection</a>':'<p>Natural end: all requested identities enumerated.</p>';res.writeHead(200,{'content-type':'text/html'});res.end(html('S6NAV Limited Collection page '+page,'<p>Whole collection requested; preserve requested scope.</p><ul>'+links+'</ul>'+next,'S6NAV'));return;}
    const fn=/^\/s6nav\/(s6nav-\d\d\.bin)$/.exec(u.pathname);if(fn){if(role!=='limited'){res.writeHead(401);res.end('AUTH_REQUIRED');return;}const x=o.S6NAV.members.find(v=>basename(v.path)===fn[1]);if(o.S6NAV.inaccessible_ids.includes(x.id)){res.writeHead(403);res.end('AUTH_REQUIRED: known requested member inaccessible');return;}await asset('s6nav/'+fn[1],res);return;}
    res.writeHead(404);res.end('PB3 scenario not found');
  }catch(e){res.writeHead(500);res.end(String(e));}});
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,host,ok);});console.log('PB3_SERVER_READY=http://'+host+':'+port);console.log('PB3_HEALTH=http://'+host+':'+port+'/__pb3__/health');
}

async function verify(a){
  const dir=resolve(req(a,'bundle')),mb=await readFile(join(dir,'manifest-pb3.json')),ob=await readFile(join(dir,'oracle.json')),tb=await readFile(join(dir,'tasks.json')),m=JSON.parse(mb),o=JSON.parse(ob),bad=[];
  if(m.candidate.head!==HEAD||m.candidate.tree!==TREE)bad.push('candidate');if(m.scenario.oracle_sha256!==sha(ob))bad.push('oracle digest');if(m.scenario.tasks_sha256!==sha(tb))bad.push('tasks digest');
  const rr=[o.S1.file,o.S2.attachment,...o.S3.candidates,o.S4.playlist,...o.S4.segments,...o.S5.members,...o.S6.members,...o.S6NAV.members];
  for(const x of rr){const b=await readFile(join(dir,'assets',x.path));if(b.length!==x.bytes||sha(b)!==x.sha256)bad.push(x.path);}
  console.log('PB3_MANIFEST_SHA256='+sha(mb));console.log('PB3_VERIFY='+(bad.length?'FAIL':'PASS'));bad.forEach(x=>console.log('FAILURE='+x));if(bad.length)process.exitCode=1;
}

const [cmd,...rest]=process.argv.slice(2),a=amap(rest);
try{if(cmd==='prepare')await prepare(a);else if(cmd==='serve')await serve(a);else if(cmd==='verify')await verify(a);else console.log('prepare --out <dir> --operator <ref> | serve --bundle <dir> | verify --bundle <dir>');}catch(e){console.error(e);process.exitCode=1;}
