import hashlib, json, os, sqlite3
from pathlib import Path
from fixture import BUDGETS, EXPECTED_DIGEST, FIXTURE_BYTES, BAD_BYTES, SNAPSHOT, SNAPSHOT_DIGEST, SNAPSHOT_JSON

class Store:
    def __init__(self,root:Path):
        self.root=root; self.db=root/"ledger.sqlite3"; self.stage_dir=root/"staging"; self.final_dir=root/"accepted"; self.markers=root/"process-markers.jsonl"
        self.stage_dir.mkdir(parents=True,exist_ok=True); self.final_dir.mkdir(parents=True,exist_ok=True); self._init()
    def cx(self):
        c=sqlite3.connect(self.db,timeout=10,isolation_level=None); c.row_factory=sqlite3.Row
        c.execute("PRAGMA synchronous=FULL"); c.execute("PRAGMA foreign_keys=ON"); c.execute("PRAGMA busy_timeout=10000"); return c
    def _init(self):
        c=self.cx(); c.execute("PRAGMA journal_mode=WAL"); c.executescript('''
CREATE TABLE IF NOT EXISTS fixture(id INTEGER PRIMARY KEY CHECK(id=1),contract_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,target_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_digest TEXT NOT NULL,expected_digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS budgets(name TEXT PRIMARY KEY,initial INTEGER NOT NULL,reserved INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS acquisitions(target_id TEXT PRIMARY KEY,lineage_id TEXT NOT NULL UNIQUE,effect_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,recovery_classification TEXT,failure_reason TEXT,dispatch_count INTEGER NOT NULL DEFAULT 0,cancel_count INTEGER NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'fs-first');
CREATE TABLE IF NOT EXISTS commands(client_request_id TEXT PRIMARY KEY,target_id TEXT NOT NULL,lineage_id TEXT NOT NULL,command TEXT NOT NULL,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts(target_id TEXT PRIMARY KEY,effect_id TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,accepted INTEGER NOT NULL CHECK(accepted IN(0,1)),materialized INTEGER NOT NULL CHECK(materialized IN(0,1)));
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,detail TEXT NOT NULL);
''')
        c.execute("INSERT OR IGNORE INTO fixture VALUES(1,?,?,?,?,?,?)",(SNAPSHOT["contract_id"],SNAPSHOT["snapshot_id"],SNAPSHOT["selected_target_id"],SNAPSHOT_JSON,SNAPSHOT_DIGEST,EXPECTED_DIGEST))
        for n,i in BUDGETS.items(): c.execute("INSERT OR IGNORE INTO budgets(name,initial,reserved,consumed) VALUES(?,?,0,0)",(n,i))
        c.close()
    def audit(self,event,detail):
        c=self.cx(); c.execute("INSERT INTO audit(event,detail) VALUES(?,?)",(event,json.dumps(detail,sort_keys=True))); c.close()
    def marker(self,marker):
        rec={"pid":os.getpid(),"marker":marker}
        with self.markers.open("a",encoding="utf-8") as f: f.write(json.dumps(rec,sort_keys=True)+"\n"); f.flush(); os.fsync(f.fileno())
        self.audit("PROCESS_MARKER",rec)
    def stage(self): return self.stage_dir/f'{SNAPSHOT["selected_target_id"]}.part'
    def final(self): return self.final_dir/f'{SNAPSHOT["selected_target_id"]}.bin'
    def row(self):
        c=self.cx(); r=c.execute("SELECT * FROM acquisitions WHERE target_id=?",(SNAPSHOT["selected_target_id"],)).fetchone(); c.close(); return r
    def artifact(self):
        c=self.cx(); r=c.execute("SELECT * FROM artifacts WHERE target_id=?",(SNAPSHOT["selected_target_id"],)).fetchone(); c.close(); return r
    def status(self,status,recovery=None,failure=None):
        c=self.cx(); c.execute("UPDATE acquisitions SET status=?,recovery_classification=COALESCE(?,recovery_classification),failure_reason=? WHERE target_id=?",(status,recovery,failure,SNAPSHOT["selected_target_id"])); c.close()
    def lineage(self,request_id,mode="fs-first",command="submit"):
        c=self.cx()
        try:
            c.execute("BEGIN IMMEDIATE"); old=c.execute("SELECT * FROM commands WHERE client_request_id=?",(request_id,)).fetchone()
            if old: c.execute("COMMIT"); return old["lineage_id"],False
            r=c.execute("SELECT * FROM acquisitions WHERE target_id=?",(SNAPSHOT["selected_target_id"],)).fetchone(); created=False
            if not r:
                lin="lineage:"+SNAPSHOT["selected_target_id"]; eff="effect:"+SNAPSHOT["selected_target_id"]
                c.execute("INSERT INTO acquisitions(target_id,lineage_id,effect_id,status,mode) VALUES(?,?,?,?,?)",(SNAPSHOT["selected_target_id"],lin,eff,"RESERVED",mode))
                for n in BUDGETS: c.execute("UPDATE budgets SET reserved=reserved+1 WHERE name=?",(n,))
                c.execute("INSERT INTO audit(event,detail) VALUES('BUDGET_RESERVED',?)",(json.dumps({"lineage_id":lin}),)); created=True
            else: lin=r["lineage_id"]
            c.execute("INSERT INTO commands VALUES(?,?,?,?,?)",(request_id,SNAPSHOT["selected_target_id"],lin,command,"BOUND")); c.execute("COMMIT"); return lin,created
        except: c.execute("ROLLBACK"); raise
        finally: c.close()
    def dispatch(self):
        c=self.cx()
        try:
            c.execute("BEGIN IMMEDIATE"); r=c.execute("SELECT * FROM acquisitions WHERE target_id=?",(SNAPSHOT["selected_target_id"],)).fetchone()
            if r["dispatch_count"]==0:
                c.execute("UPDATE acquisitions SET dispatch_count=1,status='EFFECT_STARTED' WHERE target_id=?",(SNAPSHOT["selected_target_id"],))
                for n in BUDGETS: c.execute("UPDATE budgets SET reserved=reserved-1,consumed=consumed+1 WHERE name=? AND reserved>0",(n,))
                c.execute("INSERT INTO audit(event,detail) VALUES('EFFECT_DISPATCHED',?)",(json.dumps({"effect_id":r["effect_id"]}),))
            c.execute("COMMIT")
        except: c.execute("ROLLBACK"); raise
        finally: c.close()
    def write_stage(self,partial=False,corrupt=False):
        data=BAD_BYTES if corrupt else FIXTURE_BYTES; p=self.stage(); existing=p.stat().st_size if p.exists() else 0
        if existing and p.read_bytes()!=data[:existing]: self.status("FAILED_INTEGRITY","STAGED_PREFIX_MISMATCH","staged prefix mismatch"); return False
        end=len(data)//2 if partial else len(data)
        if existing<end:
            with p.open("ab") as f: f.write(data[existing:end]); f.flush(); os.fsync(f.fileno())
        self.status("STAGED_PARTIAL" if partial else "STAGED_COMPLETE"); self.audit("STAGE_WRITE",{"bytes":end,"partial":partial,"corrupt":corrupt}); return True
    def complete_stage(self):
        p=self.stage(); existing=p.stat().st_size if p.exists() else 0
        if not p.exists(): return self.write_stage()
        if p.read_bytes()!=FIXTURE_BYTES[:existing]: self.status("FAILED_INTEGRITY","STAGED_PREFIX_MISMATCH","staged prefix mismatch"); return False
        if existing<len(FIXTURE_BYTES):
            with p.open("ab") as f: f.write(FIXTURE_BYTES[existing:]); f.flush(); os.fsync(f.fileno())
        self.status("STAGED_COMPLETE"); self.audit("STAGE_RESUMED",{"from":existing,"to":len(FIXTURE_BYTES)}); return True
    def validate(self,p:Path):
        if not p.exists(): return False,None
        d=hashlib.sha256(p.read_bytes()).hexdigest(); return d==EXPECTED_DIGEST,d
    def put_artifact(self,path,digest,materialized,recovery=None):
        c=self.cx(); c.execute("INSERT OR REPLACE INTO artifacts VALUES(?,?,?,?,1,?)",(SNAPSHOT["selected_target_id"],"effect:"+SNAPSHOT["selected_target_id"],str(path),digest,1 if materialized else 0)); c.execute("UPDATE acquisitions SET status=?,recovery_classification=COALESCE(?,recovery_classification) WHERE target_id=?",("ACCEPTED" if materialized else "ACCEPTED_PENDING_FINALIZE",recovery,SNAPSHOT["selected_target_id"])); c.close()
    def state(self):
        c=self.cx(); fix=dict(c.execute("SELECT * FROM fixture WHERE id=1").fetchone()); budgets=[]
        for r in c.execute("SELECT * FROM budgets ORDER BY name"):
            d=dict(r); d["remaining"]=d["initial"]-d["reserved"]-d["consumed"]; budgets.append(d)
        acq=c.execute("SELECT * FROM acquisitions WHERE target_id=?",(SNAPSHOT["selected_target_id"],)).fetchone(); arts=[dict(r) for r in c.execute("SELECT * FROM artifacts")]; integ=c.execute("PRAGMA integrity_check").fetchone()[0]; c.close()
        mat=sum(1 for a in arts if a["accepted"] and a["materialized"]); terminal="NO_ACQUISITION"
        if acq: terminal="SUCCESS" if acq["status"]=="ACCEPTED" and mat==1 else ("FAILED" if acq["status"].startswith("FAILED") else "NON_TERMINAL")
        return {"fixture":fix,"budgets":budgets,"acquisition":dict(acq) if acq else None,"accepted_artifact_count":sum(1 for a in arts if a["accepted"]),"materialized_accepted_artifact_count":mat,"accepted_artifact_digest":arts[0]["digest"] if arts else None,"staging_artifact_count":sum(1 for p in self.stage_dir.iterdir() if p.is_file()),"external_effect_execution_count":dict(acq)["dispatch_count"] if acq else 0,"terminal":terminal,"sqlite_integrity":integ,"final_file_exists":self.final().exists(),"final_file_digest":hashlib.sha256(self.final().read_bytes()).hexdigest() if self.final().exists() else None}
