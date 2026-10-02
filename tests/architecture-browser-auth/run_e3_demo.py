#!/usr/bin/env python3
import hashlib
import http.server
import json
import os
import platform
import secrets
import select
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

EXPECTED_EXTENSION_ID = "pfmdeelofnfcfabikilcoichkfclmgoj"
HOST_NAME = "com.kaicreator.xdownload.auth_demo"
DENIED_HOST_NAME = "com.kaicreator.xdownload.denied"
EXPECTED_RESOURCE = b"XD_AUTHORIZED_RESOURCE_v1\n"
EXPECTED_RESOURCE_DIGEST = hashlib.sha256(EXPECTED_RESOURCE).hexdigest()


class DemoState:
    def __init__(self):
        self.secret = secrets.token_urlsafe(32)
        self.session_valid = True
        self.lock = threading.Lock()
        self.counters = {
            "login_requests": 0,
            "page_requests": 0,
            "warmup_requests": 0,
            "resource_requests": 0,
            "resource_authorized": 0,
            "resource_unauthorized": 0,
            "irrelevant_requests": 0,
            "expire_requests": 0,
            "cross_origin_resource_requests": 0,
        }
        self.events = []

    def event(self, name, **meta):
        with self.lock:
            self.events.append({"event": name, **meta})


class ReusableHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "xDownloadE3Fixture/0.1"

    def log_message(self, fmt, *args):
        return

    @property
    def state(self):
        return self.server.state

    def _host_is_localhost(self):
        return self.headers.get("Host", "").split(":", 1)[0] == "localhost"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/login":
            self.state.counters["login_requests"] += 1
            self.send_response(302)
            self.send_header("Set-Cookie", f"xd_session={self.state.secret}; Path=/; HttpOnly; SameSite=Lax")
            self.send_header("Location", "/page")
            self.end_headers()
            self.state.event("login")
            return
        if parsed.path == "/warmup":
            self.state.counters["warmup_requests"] += 1
            body = b"<!doctype html><html><body>warmup</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.state.event("warmup")
            return
        if parsed.path == "/page":
            self.state.counters["page_requests"] += 1
            body = b"""<!doctype html><html><body><h1>xDownload E3</h1><script>
Promise.all([
  fetch('/resource?case=relevant', {credentials:'include'}).then(r => r.arrayBuffer()),
  fetch('/irrelevant?case=noise', {credentials:'include'}).then(r => r.text())
]).catch(() => {});
</script></body></html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.state.event("page")
            return
        if parsed.path == "/resource":
            self.state.counters["resource_requests"] += 1
            if self._host_is_localhost():
                self.state.counters["cross_origin_resource_requests"] += 1
            cookie = self.headers.get("Cookie", "")
            authorized = self.state.session_valid and f"xd_session={self.state.secret}" in cookie
            if authorized:
                self.state.counters["resource_authorized"] += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(EXPECTED_RESOURCE)))
                self.end_headers()
                self.wfile.write(EXPECTED_RESOURCE)
                self.state.event("resource", authorized=True, host="localhost" if self._host_is_localhost() else "127.0.0.1")
            else:
                self.state.counters["resource_unauthorized"] += 1
                self.send_response(401)
                self.end_headers()
                self.state.event("resource", authorized=False, host="localhost" if self._host_is_localhost() else "127.0.0.1")
            return
        if parsed.path == "/irrelevant":
            self.state.counters["irrelevant_requests"] += 1
            body = b"noise"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.state.event("irrelevant")
            return
        if parsed.path == "/expire":
            self.state.counters["expire_requests"] += 1
            self.state.session_valid = False
            self.send_response(204)
            self.end_headers()
            self.state.event("session_expired")
            return
        self.send_response(404)
        self.end_headers()


def chromium_version(binary):
    return subprocess.check_output([binary, "--version"], text=True).strip()


def write_native_manifest(path, name, executable, allowed_extension_id):
    manifest = {
        "name": name,
        "description": "xDownload E3 research-only native host",
        "path": str(executable),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{allowed_extension_id}/"],
    }
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def scan_secret(paths, secret):
    hits = []
    raw = secret.encode("utf-8")
    for path in paths:
        if not path.exists() or not path.is_file():
            continue
        data = path.read_bytes()
        if raw in data:
            hits.append(str(path))
    return hits




class CdpPipe:
    def __init__(self, proc, write_fd, read_fd):
        self.proc = proc
        self.write_fd = write_fd
        self.read_fd = read_fd
        self.buffer = b""
        self.next_id = 0

    @classmethod
    def launch(cls, cmd, env, log_handle):
        r_in, w_in = os.pipe()
        r_out, w_out = os.pipe()
        parent_write = os.dup(w_in)
        parent_read = os.dup(r_out)

        def save_fd(fd):
            try:
                return os.dup(fd)
            except OSError:
                return None

        saved3 = save_fd(3)
        saved4 = save_fd(4)
        os.dup2(r_in, 3)
        os.dup2(w_out, 4)
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=log_handle, env=env,
                pass_fds=(3, 4), close_fds=True
            )
        finally:
            if saved3 is None:
                try: os.close(3)
                except OSError: pass
            else:
                os.dup2(saved3, 3)
                os.close(saved3)
            if saved4 is None:
                try: os.close(4)
                except OSError: pass
            else:
                os.dup2(saved4, 4)
                os.close(saved4)
            for fd in set((r_in, w_in, r_out, w_out)):
                if fd not in (parent_write, parent_read, 3, 4):
                    try: os.close(fd)
                    except OSError: pass
        return cls(proc, parent_write, parent_read)

    def _recv(self, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            if b"\0" in self.buffer:
                raw, self.buffer = self.buffer.split(b"\0", 1)
                if raw:
                    return json.loads(raw.decode("utf-8"))
                continue
            ready, _, _ = select.select([self.read_fd], [], [], max(0, end - time.time()))
            if not ready:
                break
            chunk = os.read(self.read_fd, 65536)
            if not chunk:
                raise RuntimeError("cdp_pipe_eof")
            self.buffer += chunk
        raise TimeoutError("cdp_response_timeout")

    def call(self, method, params=None, timeout=10):
        self.next_id += 1
        request_id = self.next_id
        payload = {"id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        os.write(self.write_fd, json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\0")
        while True:
            response = self._recv(timeout)
            if response.get("id") == request_id:
                return response

    def close(self):
        for fd in (self.write_fd, self.read_fd):
            try: os.close(fd)
            except OSError: pass


def evaluate(native, state, denied_launched, external_secret_hits):
    e = native.get("extension_evidence", {})
    b = native.get("broker", {})
    results = {}
    s1 = e.get("s1", {})
    results["S1"] = bool(s1.get("ok") and s1.get("http_status") == 200 and s1.get("digest") == EXPECTED_RESOURCE_DIGEST and e.get("relevant_observation", {}).get("tab_id", -1) >= 0)
    s2 = e.get("s2", {})
    results["S2"] = bool(s2.get("relevant_captured") and s2.get("irrelevant_captured") and s2.get("irrelevant_not_selected"))
    s3 = e.get("s3", {})
    results["S3"] = bool(s3.get("ok") is False and s3.get("reason") == "scope_mismatch" and s3.get("network_attempted") is False and state.counters["cross_origin_resource_requests"] == 0)
    s4 = e.get("s4", {})
    results["S4"] = bool(s4.get("rejected") and s4.get("reason") in ("message_too_large", "unexpected_schema"))
    s5 = e.get("s5", {})
    results["S5"] = bool(s5.get("rejected") and not denied_launched)
    results["S6"] = not any([
        b.get("raw_secret_seen_by_core"),
        b.get("raw_secret_seen_in_durable_state"),
        b.get("raw_secret_seen_in_log"),
        b.get("raw_secret_seen_in_recipe"),
        b.get("raw_secret_seen_by_model_sink"),
        external_secret_hits,
    ])
    s7 = e.get("s7", {})
    results["S7"] = bool(s7.get("ok") is False and s7.get("status") == "auth_required" and s7.get("http_status") == 401 and s7.get("authorization_context_ref") == s1.get("authorization_context_ref"))
    s8 = e.get("s8", {})
    results["S8"] = bool(s8.get("supported") and s8.get("set_partitioned_cookie") and s8.get("correct_partition_lookup") and s8.get("wrong_partition_lookup_absent") and s8.get("correct_capability_binding") and s8.get("wrong_capability_binding_rejected"))
    return results


def main():
    here = Path(__file__).resolve().parent
    extension_dir = here / "extension"
    native_host = here / "native_host.py"
    chromium = "/usr/lib/chromium/chromium" if Path("/usr/lib/chromium/chromium").exists() else (shutil.which("chromium") or shutil.which("google-chrome") or shutil.which("google-chrome-stable"))
    if not chromium:
        print(json.dumps({"result": "BLOCKED", "reason": "reference_browser_not_found"}))
        return 2

    work = Path(tempfile.mkdtemp(prefix="xdownload-e3-"))
    home = work / "home"
    profile = work / "profile"
    evidence_path = work / "native-evidence.json"
    browser_log = work / "chromium.log"
    server_log = work / "server-events.json"
    denied_marker = work / "denied-host-launched"
    host_dir = home / ".config" / "chromium" / "NativeMessagingHosts"
    host_dir.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    profile_host_dir = profile / "NativeMessagingHosts"
    profile_host_dir.mkdir(parents=True, exist_ok=True)

    normal_wrapper = work / "native-host-wrapper.sh"
    normal_wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} '{native_host}' \"$@\"\n", encoding="utf-8")
    normal_wrapper.chmod(0o755)
    denied_wrapper = work / "denied-host-wrapper.sh"
    denied_wrapper.write_text(f"#!/bin/sh\ntouch '{denied_marker}'\nexec {sys.executable} '{native_host}' \"$@\"\n", encoding="utf-8")
    denied_wrapper.chmod(0o755)
    write_native_manifest(host_dir / f"{HOST_NAME}.json", HOST_NAME, normal_wrapper, EXPECTED_EXTENSION_ID)
    write_native_manifest(host_dir / f"{DENIED_HOST_NAME}.json", DENIED_HOST_NAME, denied_wrapper, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    write_native_manifest(profile_host_dir / f"{HOST_NAME}.json", HOST_NAME, normal_wrapper, EXPECTED_EXTENSION_ID)
    write_native_manifest(profile_host_dir / f"{DENIED_HOST_NAME}.json", DENIED_HOST_NAME, denied_wrapper, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

    state = DemoState()
    server = ReusableHTTPServer(("127.0.0.1", 0), Handler)
    server.state = state
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    login_url = f"http://127.0.0.1:{port}/login"
    warmup_url = f"http://127.0.0.1:{port}/warmup"

    xvfb = shutil.which("Xvfb")
    if not xvfb:
        print(json.dumps({"result": "BLOCKED", "reason": "xvfb_not_found_for_real_browser"}))
        return 2
    display_num = next((n for n in range(90, 120) if not Path(f"/tmp/.X11-unix/X{n}").exists()), None)
    if display_num is None:
        print(json.dumps({"result": "BLOCKED", "reason": "no_free_x_display"}))
        return 2
    display = f":{display_num}"
    xvfb_log = work / "xvfb.log"
    xvfb_handle = xvfb_log.open("wb")
    xvfb_proc = subprocess.Popen([xvfb, display, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], stdout=xvfb_handle, stderr=subprocess.STDOUT)
    time.sleep(0.5)
    if xvfb_proc.poll() is not None:
        xvfb_handle.close()
        print(json.dumps({"result": "BLOCKED", "reason": "xvfb_failed_to_start", "xvfb_log": str(xvfb_log)}))
        return 2

    env = os.environ.copy()
    env["DISPLAY"] = display
    env["HOME"] = str(home)
    env["XD_EVIDENCE_PATH"] = str(evidence_path)
    env["XD_DENIED_MARKER"] = str(denied_marker)

    cmd = [
        chromium,
        f"--user-data-dir={profile}",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--remote-debugging-pipe",
        "--enable-unsafe-extension-debugging",
        "--window-size=1200,800",
        "about:blank",
    ]
    started = time.time()
    cdp_error = None
    extension_load = None
    with browser_log.open("wb") as log:
        cdp = CdpPipe.launch(cmd, env, log)
        proc = cdp.proc
        try:
            version_reply = cdp.call("Browser.getVersion", timeout=10)
            extension_load = cdp.call("Extensions.loadUnpacked", {"path": str(extension_dir)}, timeout=15)
            if "error" in extension_load:
                cdp_error = extension_load["error"].get("message", "extension_load_failed")
            else:
                loaded_id = extension_load.get("result", {}).get("id")
                if loaded_id != EXPECTED_EXTENSION_ID:
                    cdp_error = f"extension_id_mismatch:{loaded_id}"
                else:
                    warmup_reply = cdp.call("Target.createTarget", {"url": warmup_url}, timeout=10)
                    if "error" in warmup_reply:
                        cdp_error = warmup_reply["error"].get("message", "warmup_target_create_failed")
                    else:
                        time.sleep(1.0)
                        target_reply = cdp.call("Target.createTarget", {"url": login_url}, timeout=10)
                        if "error" in target_reply:
                            cdp_error = target_reply["error"].get("message", "target_create_failed")
            deadline = time.time() + (45 if cdp_error is None else 2)
            while time.time() < deadline and not evidence_path.exists():
                if proc.poll() is not None:
                    break
                time.sleep(0.2)
            if evidence_path.exists():
                time.sleep(0.5)
        except Exception as exc:
            cdp_error = f"cdp_error:{type(exc).__name__}:{exc}"
        finally:
            cdp.close()
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
    server.shutdown()
    server.server_close()
    if xvfb_proc.poll() is None:
        xvfb_proc.terminate()
        try:
            xvfb_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            xvfb_proc.kill()
            xvfb_proc.wait(timeout=3)
    xvfb_handle.close()
    thread.join(timeout=2)
    server_log.write_text(json.dumps({"counters": state.counters, "events": state.events}, indent=2), encoding="utf-8")

    if not evidence_path.exists():
        print(json.dumps({
            "result": "BLOCKED",
            "reason": "native_evidence_not_produced",
            "browser_exit": proc.returncode,
            "cdp_error": cdp_error,
            "extension_load": extension_load,
            "workdir": str(work),
            "browser_log": str(browser_log),
        }, indent=2))
        return 2

    native = json.loads(evidence_path.read_text(encoding="utf-8"))
    secret_hits = scan_secret([evidence_path, browser_log, server_log], state.secret)
    scenarios = evaluate(native, state, denied_marker.exists(), secret_hits)
    result = "PASS" if all(scenarios.values()) else "FAIL"
    combined = {
        "result": result,
        "evidence_strength": "E3",
        "environment": {
            "platform": platform.platform(),
            "python": sys.version.split()[0],
            "browser": chromium_version(chromium),
            "browser_binary": chromium,
            "display": display,
        },
        "identity": {
            "extension_id": native.get("extension_evidence", {}).get("extension_id"),
            "expected_extension_id": EXPECTED_EXTENSION_ID,
            "native_host_identity": native.get("native_host_identity"),
            "browser_sender_origin": native.get("browser_sender_origin"),
        },
        "scenarios": scenarios,
        "server_counters": state.counters,
        "secret_non_propagation": {
            "raw_secret_seen_by_core": native.get("broker", {}).get("raw_secret_seen_by_core"),
            "raw_secret_seen_in_durable_state": native.get("broker", {}).get("raw_secret_seen_in_durable_state"),
            "raw_secret_seen_in_log": native.get("broker", {}).get("raw_secret_seen_in_log"),
            "raw_secret_seen_in_recipe": native.get("broker", {}).get("raw_secret_seen_in_recipe"),
            "raw_secret_seen_by_model_sink": native.get("broker", {}).get("raw_secret_seen_by_model_sink"),
            "external_nonsecret_artifact_scan_hits": len(secret_hits),
        },
        "observables": {
            "page_origin": native.get("extension_evidence", {}).get("page_origin"),
            "tab_id": native.get("extension_evidence", {}).get("tab_id"),
            "frame_id": native.get("extension_evidence", {}).get("relevant_observation", {}).get("frame_id"),
            "observed_request_id": native.get("extension_evidence", {}).get("relevant_observation", {}).get("request_id"),
            "resource_url": native.get("extension_evidence", {}).get("relevant_observation", {}).get("resource_url"),
            "contract_id": "contract-demo-001",
            "snapshot_id": "snapshot-demo-001",
            "authorization_context_ref": native.get("extension_evidence", {}).get("s1", {}).get("authorization_context_ref"),
            "native_message_count": native.get("extension_evidence", {}).get("native_message_count_before_finalize"),
            "native_payload_sizes": native.get("extension_evidence", {}).get("native_payload_sizes_before_finalize"),
            "authorized_resource_status": native.get("extension_evidence", {}).get("s1", {}).get("http_status"),
            "authorized_resource_digest": native.get("extension_evidence", {}).get("s1", {}).get("digest"),
            "rejected_misuse_reason": native.get("extension_evidence", {}).get("s3", {}).get("reason"),
            "native_host_allowlist_error": native.get("extension_evidence", {}).get("s5", {}).get("reason"),
            "partition_result": native.get("extension_evidence", {}).get("s8"),
        },
        "timing_seconds": round(time.time() - started, 3),
        "artifact_paths": {
            "workdir": str(work),
            "native_evidence": str(evidence_path),
            "browser_log": str(browser_log),
            "server_log": str(server_log),
        },
    }
    combined_path = work / "e3-result.json"
    combined_path.write_text(json.dumps(combined, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(combined, indent=2, sort_keys=True))
    return 0 if result == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
