#!/usr/bin/env python3
import argparse, json, os, signal, socketserver, threading
from pathlib import Path
from fixture import EXPECTED_DIGEST, FIXTURE_BYTES, SNAPSHOT
from store import Store

class Runtime:
    def __init__(self,s:Store): self.s=s
    def kill(self,where): self.s.marker("HARD_KILL:"+where); os.kill(os.getpid(),signal.SIGKILL)
    def accept_fs_first(self,crash=None):
        st,fin=self.s.stage(),self.s.final(); ok,d=self.s.validate(st)
        if not ok: self.s.status("FAILED_INTEGRITY","DIGEST_MISMATCH",f"expected={EXPECTED_DIGEST};actual={d}"); return
        self.s.status("VALIDATED")
        if fin.exists():
            ok,fd=self.s.validate(fin)
            if not ok: self.s.status("FAILED_INTEGRITY","FINAL_DIGEST_MISMATCH",f"actual={fd}"); return
            if st.exists(): st.unlink()
        else:
            os.replace(st,fin); fd=os.open(str(self.s.final_dir),os.O_RDONLY); os.fsync(fd); os.close(fd)
        self.s.audit("FILESYSTEM_FINALIZED",{"path":str(fin),"digest":d})
        if crash=="after_fs_finalize_before_db_accept": self.kill(crash)
        self.s.put_artifact(fin,d,True,"NORMAL")
    def accept_db_first(self,crash=None):
        st,fin=self.s.stage(),self.s.final(); ok,d=self.s.validate(st)
        if not ok: self.s.status("FAILED_INTEGRITY","DIGEST_MISMATCH",f"expected={EXPECTED_DIGEST};actual={d}"); return
        self.s.put_artifact(fin,d,False)
        if crash=="after_db_accept_before_fs_finalize": self.kill(crash)
        os.replace(st,fin); fd=os.open(str(self.s.final_dir),os.O_RDONLY); os.fsync(fd); os.close(fd); self.s.put_artifact(fin,d,True)
    def recover(self,crash=None,corrupt=False):
        r=self.s.row()
        if not r or r["status"].startswith("FAILED") or r["status"]=="CANCELLED": return
        art=self.s.artifact(); st,fin=self.s.stage(),self.s.final()
        if art and art["accepted"]:
            if art["materialized"]:
                ok,d=self.s.validate(Path(art["path"])); self.s.status("ACCEPTED","REOPEN_VERIFIED") if ok else self.s.status("FAILED_INTEGRITY","ACCEPTED_FILE_MISSING_OR_BAD",f"actual={d}"); return
            if st.exists():
                ok,d=self.s.validate(st)
                if not ok: self.s.status("FAILED_INTEGRITY","PENDING_ACCEPT_DIGEST_MISMATCH",f"actual={d}"); return
                os.replace(st,fin); fd=os.open(str(self.s.final_dir),os.O_RDONLY); os.fsync(fd); os.close(fd)
            ok,d=self.s.validate(fin)
            if not ok: self.s.status("FAILED_INTEGRITY","PENDING_ACCEPT_MISSING_OR_BAD",f"actual={d}"); return
            self.s.put_artifact(fin,d,True,"RECOVERED_DB_FIRST"); return
        if fin.exists():
            ok,d=self.s.validate(fin)
            if not ok: self.s.status("FAILED_INTEGRITY","ORPHAN_FINAL_DIGEST_MISMATCH",f"actual={d}"); return
            self.s.put_artifact(fin,d,True,"RECOVERED_FS_FIRST"); return
        if r["status"]=="RESERVED":
            if crash=="after_reservation_before_dispatch": self.kill(crash)
            self.s.dispatch()
        elif r["dispatch_count"]==0: self.s.dispatch()
        if not st.exists():
            if crash=="after_partial_stage": self.s.write_stage(True,corrupt); self.kill(crash)
            self.s.write_stage(False,corrupt)
        elif st.stat().st_size<len(FIXTURE_BYTES) and not corrupt: self.s.complete_stage()
        if crash=="after_complete_stage_before_accept": self.kill(crash)
        if corrupt:
            ok,d=self.s.validate(st)
            if not ok: self.s.status("FAILED_INTEGRITY","DIGEST_MISMATCH",f"expected={EXPECTED_DIGEST};actual={d}"); return
        (self.accept_db_first if r["mode"]=="db-first" else self.accept_fs_first)(crash)
    def submit(self,q):
        lin,new=self.s.lineage(q["client_request_id"],q.get("mode","fs-first"),"submit")
        if new: self.recover(q.get("crash_point"),q.get("corrupt",False))
        return {"lineage_id":lin,"created":new,"state":self.s.state()}
    def cancel(self,q):
        lin,_=self.s.lineage(q["client_request_id"],command="cancel"); c=self.s.cx(); c.execute("UPDATE acquisitions SET status='CANCELLED',cancel_count=cancel_count+1,recovery_classification='CANCELLED_DURABLE' WHERE target_id=?",(SNAPSHOT["selected_target_id"],)); c.close(); return {"lineage_id":lin,"state":self.s.state()}
    def retry(self,q):
        lin,_=self.s.lineage(q["client_request_id"],command="retry"); c=self.s.cx(); c.execute("UPDATE acquisitions SET status=CASE WHEN dispatch_count=0 THEN 'RESERVED' ELSE 'EFFECT_STARTED' END,recovery_classification='RETRY_SAME_LINEAGE' WHERE target_id=?",(SNAPSHOT["selected_target_id"],)); c.close(); self.recover(q.get("crash_point")); return {"lineage_id":lin,"state":self.s.state()}

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        q=json.loads(self.rfile.readline().decode()); r=self.server.runtime
        try:
            if q["op"]=="submit": out=r.submit(q)
            elif q["op"]=="status": out=r.s.state()
            elif q["op"]=="cancel": out=r.cancel(q)
            elif q["op"]=="retry": out=r.retry(q)
            elif q["op"]=="shutdown": out={"ok":True,"pid":os.getpid()}; threading.Thread(target=self.server.shutdown,daemon=True).start()
            else: raise ValueError("unknown op")
            self.wfile.write((json.dumps(out,sort_keys=True)+"\n").encode()); self.wfile.flush()
        except BrokenPipeError: pass
class Server(socketserver.ThreadingUnixStreamServer): daemon_threads=True; allow_reuse_address=True

def main():
    p=argparse.ArgumentParser(); p.add_argument("--root",required=True); p.add_argument("--defer-recovery",action="store_true"); a=p.parse_args(); root=Path(a.root); root.mkdir(parents=True,exist_ok=True); sock=root/"runtime.sock"
    if sock.exists(): sock.unlink()
    s=Store(root); s.marker("START"); r=Runtime(s)
    if not a.defer_recovery: r.recover()
    else: s.audit("RECOVERY_DEFERRED",{"pid":os.getpid()})
    server=Server(str(sock),Handler); server.runtime=r
    try: server.serve_forever(.05)
    finally:
        s.marker("STOP"); server.server_close()
        if sock.exists(): sock.unlink()
if __name__=="__main__": main()
