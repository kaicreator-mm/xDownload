#!/usr/bin/env python3
import hashlib, json, os, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path

HERE=Path(__file__).resolve().parent
RUNTIME=HERE/"runtime.py"; CLIENT=HERE/"client.py"
EXPECTED_DIGEST=hashlib.sha256((b"xDownload-E3-durable-artifact-v1\n"*128)).hexdigest()
EXPECTED_SNAPSHOT_DIGEST=hashlib.sha256(json.dumps({"contract_id":"contract-e3-001","snapshot_id":"snapshot-e3-001","selected_target_id":"target-e3-001","members":["target-e3-001"],"continuation_scope":"frozen-none"},sort_keys=True,separators=(",",":")).encode()).hexdigest()

class Runtime:
    def __init__(self, root): self.root=Path(root); self.p=None
    @property
    def sock(self): return self.root/"runtime.sock"
    def start(self, defer_recovery=False):
        cmd=[sys.executable,str(RUNTIME),"--root",str(self.root)]
        if defer_recovery: cmd.append("--defer-recovery")
        self.p=subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline=time.time()+5
        while time.time()<deadline:
            if self.p.poll() is not None:
                raise RuntimeError(f"runtime exited early {self.p.returncode}: {self.p.stderr.read()}")
            if self.sock.exists():
                try:
                    s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(.2); s.connect(str(self.sock)); s.sendall(b'{"op":"status"}\n'); line=s.makefile("r").readline(); s.close()
                    if line: return self.p.pid
                except (ConnectionRefusedError, FileNotFoundError, socket.timeout):
                    pass
            time.sleep(.02)
        raise TimeoutError("runtime socket not ready")
    def wait_killed(self):
        rc=self.p.wait(timeout=5)
        assert rc == -signal.SIGKILL, f"expected SIGKILL, got {rc} stderr={self.p.stderr.read()}"
        return rc
    def request(self, obj, allow_eof=False):
        s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.connect(str(self.sock)); s.sendall((json.dumps(obj)+"\n").encode()); f=s.makefile("r")
        line=f.readline(); s.close()
        if not line:
            if allow_eof: return None
            raise RuntimeError("unexpected EOF")
        return json.loads(line)
    def stop(self):
        if self.p and self.p.poll() is None:
            self.request({"op":"shutdown"}); self.p.wait(timeout=5)
        return self.p.returncode if self.p else None


def assert_common(state, expected_terminal="SUCCESS", accepted=1, effect_count=1):
    assert state["sqlite_integrity"]=="ok", state
    assert state["fixture"]["snapshot_digest"]==EXPECTED_SNAPSHOT_DIGEST, state
    assert state["fixture"]["snapshot_id"]=="snapshot-e3-001"
    assert state["fixture"]["target_id"]=="target-e3-001"
    assert state["external_effect_execution_count"]==effect_count, state
    assert state["accepted_artifact_count"]==accepted, state
    assert state["terminal"]==expected_terminal, state
    if accepted:
        assert state["materialized_accepted_artifact_count"]==1, state
        assert state["accepted_artifact_digest"]==EXPECTED_DIGEST, state
        assert state["final_file_digest"]==EXPECTED_DIGEST, state
    for b in state["budgets"]:
        assert b["reserved"]==0, state
        assert b["consumed"]==1, state
        assert b["remaining"]==b["initial"]-1, state


def markers(root):
    p=Path(root)/"process-markers.jsonl"
    return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

def scenario_root(base, name):
    p=base/name
    if p.exists(): shutil.rmtree(p)
    p.mkdir(parents=True)
    return p

def clean_restart_and_state(root):
    r=Runtime(root); pid=r.start(); state=r.request({"op":"status"}); r.stop(); return pid,state

def hardkill_submit(root, crash_point, **extra):
    r=Runtime(root); pid1=r.start();
    req={"op":"submit","client_request_id":"req-1","crash_point":crash_point}; req.update(extra)
    # Runtime kills itself; client sees EOF or reset.
    try: r.request(req,allow_eof=True)
    except (ConnectionResetError, BrokenPipeError): pass
    r.wait_killed()
    r2=Runtime(root); pid2=r2.start(); state=r2.request({"op":"status"}); r2.stop()
    assert pid1 != pid2
    return pid1,pid2,state

def s1(base):
    root=scenario_root(base,"S1")
    r=Runtime(root); p1=r.start(); out=r.request({"op":"submit","client_request_id":"req-1"}); assert_common(out["state"]); r.stop()
    p2,state=clean_restart_and_state(root); assert p1!=p2; assert_common(state)
    return {"pids":[p1,p2],"state":state,"markers":markers(root)}

def s2(base):
    root=scenario_root(base,"S2")
    r=Runtime(root); p=r.start()
    req=json.dumps({"op":"submit","client_request_id":"same-idempotency-key"})
    procs=[subprocess.Popen([sys.executable,str(CLIENT),"--socket",str(r.sock),"--request",req],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
    outs=[]
    for cp in procs:
        o,e=cp.communicate(timeout=5); assert cp.returncode==0,(cp.returncode,o,e); outs.append(json.loads(o))
    state=r.request({"op":"status"}); r.stop(); assert_common(state)
    assert {o["lineage_id"] for o in outs}=={"lineage:target-e3-001"}
    assert sum(1 for o in outs if o["created"])==1
    return {"pid":p,"client_pids":[cp.pid for cp in procs],"client_results":outs,"state":state,"markers":markers(root)}

def s3(base):
    root=scenario_root(base,"S3"); p1,p2,state=hardkill_submit(root,"after_reservation_before_dispatch"); assert_common(state)
    return {"pids":[p1,p2],"state":state,"markers":markers(root)}

def s4(base):
    root=scenario_root(base,"S4"); p1,p2,state=hardkill_submit(root,"after_partial_stage"); assert_common(state)
    assert state["acquisition"]["recovery_classification"] in ("NORMAL","REOPEN_VERIFIED")
    return {"pids":[p1,p2],"state":state,"markers":markers(root)}

def s5(base):
    root=scenario_root(base,"S5"); p1,p2,state=hardkill_submit(root,"after_complete_stage_before_accept"); assert_common(state)
    return {"pids":[p1,p2],"state":state,"markers":markers(root)}

def s6(base):
    rootA=scenario_root(base,"S6_fs_first"); p1,p2,a=hardkill_submit(rootA,"after_fs_finalize_before_db_accept",mode="fs-first"); assert_common(a); assert a["acquisition"]["recovery_classification"]=="RECOVERED_FS_FIRST"
    rootB=scenario_root(base,"S6_db_first"); p3,p4,b=hardkill_submit(rootB,"after_db_accept_before_fs_finalize",mode="db-first"); assert_common(b); assert b["acquisition"]["recovery_classification"] in ("RECOVERED_DB_FIRST","REOPEN_VERIFIED")
    return {"fs_first":{"pids":[p1,p2],"state":a,"markers":markers(rootA)},"db_first":{"pids":[p3,p4],"state":b,"markers":markers(rootB)}}

def s7(base):
    root=scenario_root(base,"S7")
    r=Runtime(root); p1=r.start()
    try: r.request({"op":"submit","client_request_id":"req-submit","crash_point":"after_partial_stage"},allow_eof=True)
    except ConnectionResetError: pass
    r.wait_killed()
    # Reopen the real DB/filesystem but deliberately defer automatic reconciliation so cancellation can win durably.
    r2=Runtime(root); p2=r2.start(defer_recovery=True)
    active=r2.request({"op":"status"})
    assert active["acquisition"]["status"]=="STAGED_PARTIAL", active
    cancel=r2.request({"op":"cancel","client_request_id":"req-cancel"}); assert cancel["lineage_id"]=="lineage:target-e3-001"
    r2.stop()
    # Fresh restart must preserve cancellation and must not replenish budget or create a second effect.
    r3=Runtime(root); p3=r3.start(); cancelled=r3.request({"op":"status"})
    assert cancelled["acquisition"]["status"]=="CANCELLED", cancelled
    assert cancelled["external_effect_execution_count"]==1
    for b in cancelled["budgets"]: assert b["consumed"]==1 and b["reserved"]==0
    retry=r3.request({"op":"retry","client_request_id":"req-retry"}); state=retry["state"]
    assert_common(state); assert retry["lineage_id"]=="lineage:target-e3-001"; assert state["acquisition"]["cancel_count"]==1
    r3.stop()
    p4, final=clean_restart_and_state(root); assert_common(final)
    assert final["external_effect_execution_count"]==1
    return {"pids":[p1,p2,p3,p4],"active_state":active,"cancelled_state":cancelled,"state":final,"markers":markers(root)}

def s8(base):
    root=scenario_root(base,"S8"); p1,p2,state=hardkill_submit(root,"after_complete_stage_before_accept",corrupt=True)
    assert state["sqlite_integrity"]=="ok"; assert state["fixture"]["snapshot_digest"]==EXPECTED_SNAPSHOT_DIGEST
    assert state["external_effect_execution_count"]==1; assert state["accepted_artifact_count"]==0; assert state["terminal"]=="FAILED"
    assert state["acquisition"]["recovery_classification"]=="DIGEST_MISMATCH"
    for b in state["budgets"]:
        assert b["consumed"]==1 and b["reserved"]==0 and b["remaining"]==b["initial"]-1
    return {"pids":[p1,p2],"state":state,"markers":markers(root)}

def main():
    base=Path(tempfile.mkdtemp(prefix="xdownload-e3-"))
    results={}
    try:
        for name,fn in [("S1",s1),("S2",s2),("S3",s3),("S4",s4),("S5",s5),("S6",s6),("S7",s7),("S8",s8)]:
            results[name]=fn(base); print(name,"PASS",flush=True)
    except Exception as e:
        results["failure"]={"type":type(e).__name__,"message":str(e)}
        print(json.dumps(results,indent=2,sort_keys=True)); raise
    print(json.dumps({"result":"PASS","root":str(base),"scenarios":results},indent=2,sort_keys=True))
if __name__=="__main__": main()
