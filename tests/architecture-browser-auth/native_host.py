#!/usr/bin/env python3
import hashlib
import json
import os
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HOST_IDENTITY = "com.kaicreator.xdownload.auth_demo"
EVIDENCE_PATH = Path(os.environ["XD_EVIDENCE_PATH"])


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    if len(raw_len) != 4:
        raise RuntimeError("short_native_length")
    length = struct.unpack("=I", raw_len)[0]
    if length > 1024 * 1024:
        raise RuntimeError("native_message_too_large")
    data = sys.stdin.buffer.read(length)
    if len(data) != length:
        raise RuntimeError("short_native_payload")
    return json.loads(data.decode("utf-8"))


def write_message(payload):
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def contains_secret(value: Any, secrets: set[str]) -> bool:
    text = canonical(value)
    return any(secret and secret in text for secret in secrets)


class Broker:
    def __init__(self):
        self.capabilities = {}
        self.secrets: set[str] = set()
        self.core_records = []
        self.recipe_records = []
        self.model_records = []
        self.log_records = []
        self.raw_secret_seen_by_core = False
        self.raw_secret_seen_in_recipe = False
        self.raw_secret_seen_by_model_sink = False
        self.network_attempts = 0
        self.rejected_misuse_reasons = []
        self.native_messages_seen = 0
        self.native_payload_sizes = []

    def secret_fingerprint(self, secret: str) -> str:
        return hashlib.sha256(secret.encode("utf-8")).hexdigest()

    def create_capability(self, msg):
        binding = msg.get("binding") or {}
        cookie_header = msg.get("cookie_header")
        required = ["origin", "target_url", "contract_id", "snapshot_id", "tab_id", "frame_id", "request_id"]
        if not isinstance(cookie_header, str) or not cookie_header or any(k not in binding for k in required):
            return {"ok": False, "reason": "invalid_capability_request"}
        origin = binding["origin"]
        target = binding["target_url"]
        try:
            target_origin = urllib.parse.urlsplit(target)
            expected_origin = urllib.parse.urlsplit(origin)
        except Exception:
            return {"ok": False, "reason": "invalid_url"}
        target_origin_text = f"{target_origin.scheme}://{target_origin.netloc}"
        expected_origin_text = f"{expected_origin.scheme}://{expected_origin.netloc}"
        if target_origin_text != expected_origin_text:
            return {"ok": False, "reason": "origin_target_mismatch"}
        secret_value = cookie_header.split("=", 1)[1] if "=" in cookie_header else cookie_header
        self.secrets.add(cookie_header)
        self.secrets.add(secret_value)
        binding_digest = hashlib.sha256(canonical(binding).encode()).hexdigest()
        secret_fp = self.secret_fingerprint(secret_value)
        ref = "authctx_" + hashlib.sha256((binding_digest + secret_fp).encode()).hexdigest()[:24]
        self.capabilities[ref] = {
            "binding": binding,
            "cookie_header": cookie_header,
            "secret_fingerprint": secret_fp,
            "binding_digest": binding_digest,
        }
        self.log_records.append({"event": "capability_created", "ref": ref, "binding_digest": binding_digest})
        return {
            "ok": True,
            "authorization_context_ref": ref,
            "binding_digest": binding_digest,
            "secret_fingerprint": secret_fp,
            "raw_secret_echoed": False,
        }

    def _validate_binding(self, ref, binding):
        cap = self.capabilities.get(ref)
        if not cap:
            return None, {"ok": False, "reason": "unknown_capability", "network_attempted": False}
        if canonical(cap["binding"]) != canonical(binding):
            self.rejected_misuse_reasons.append("scope_mismatch")
            self.log_records.append({"event": "capability_rejected", "ref": ref, "reason": "scope_mismatch"})
            return None, {"ok": False, "reason": "scope_mismatch", "network_attempted": False}
        return cap, None

    def check_capability(self, msg):
        cap, error = self._validate_binding(msg.get("authorization_context_ref"), msg.get("binding") or {})
        if error:
            return error
        return {"ok": True, "binding_digest": cap["binding_digest"]}

    def acquire(self, msg):
        ref = msg.get("authorization_context_ref")
        binding = msg.get("binding") or {}
        cap, error = self._validate_binding(ref, binding)
        if error:
            return error
        req = urllib.request.Request(binding["target_url"], headers={"Cookie": cap["cookie_header"], "User-Agent": "xDownload-E3-Broker/0.1"})
        self.network_attempts += 1
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                data = response.read()
                status = response.status
            return {
                "ok": status == 200,
                "status": "acquired" if status == 200 else "http_error",
                "http_status": status,
                "bytes": len(data),
                "digest": hashlib.sha256(data).hexdigest(),
                "authorization_context_ref": ref,
                "network_attempted": True,
            }
        except urllib.error.HTTPError as exc:
            status = exc.code
            if status in (401, 403):
                return {
                    "ok": False,
                    "status": "auth_required",
                    "http_status": status,
                    "authorization_context_ref": ref,
                    "network_attempted": True,
                    "reason": "session_invalid_or_expired",
                }
            return {"ok": False, "status": "http_error", "http_status": status, "network_attempted": True}
        except Exception as exc:
            return {"ok": False, "status": "network_error", "reason": type(exc).__name__, "network_attempted": True}

    def record_core(self, msg):
        payload = msg.get("payload")
        leaked = contains_secret(payload, self.secrets)
        self.raw_secret_seen_by_core |= leaked
        if not leaked:
            self.core_records.append(payload)
        return {"ok": not leaked, "raw_secret_seen": leaked}

    def record_recipe(self, msg):
        payload = msg.get("payload")
        leaked = contains_secret(payload, self.secrets)
        self.raw_secret_seen_in_recipe |= leaked
        if not leaked:
            self.recipe_records.append(payload)
        return {"ok": not leaked, "raw_secret_seen": leaked}

    def record_model(self, msg):
        payload = msg.get("payload")
        leaked = contains_secret(payload, self.secrets)
        self.raw_secret_seen_by_model_sink |= leaked
        if not leaked:
            self.model_records.append(payload)
        return {"ok": not leaked, "raw_secret_seen": leaked}

    def finalize(self, msg):
        extension_evidence = msg.get("extension_evidence") or {}
        durable = {
            "native_host_identity": HOST_IDENTITY,
            "browser_sender_origin": sys.argv[1] if len(sys.argv) > 1 else None,
            "extension_evidence": extension_evidence,
            "broker": {
                "capability_count": len(self.capabilities),
                "network_attempts": self.network_attempts,
                "rejected_misuse_reasons": self.rejected_misuse_reasons,
                "core_records": self.core_records,
                "recipe_records": self.recipe_records,
                "model_records": self.model_records,
                "log_records": self.log_records,
                "raw_secret_seen_by_core": self.raw_secret_seen_by_core,
                "raw_secret_seen_in_recipe": self.raw_secret_seen_in_recipe,
                "raw_secret_seen_by_model_sink": self.raw_secret_seen_by_model_sink,
                "raw_secret_seen_in_log": contains_secret(self.log_records, self.secrets),
            },
        }
        durable_secret_leak = contains_secret(durable, self.secrets)
        durable["broker"]["raw_secret_seen_in_durable_state"] = durable_secret_leak
        EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE_PATH.write_text(json.dumps(durable, indent=2, sort_keys=True), encoding="utf-8")
        return {"ok": not durable_secret_leak, "reason": None if not durable_secret_leak else "durable_secret_leak"}

    def handle(self, msg):
        self.native_messages_seen += 1
        self.native_payload_sizes.append(len(canonical(msg).encode("utf-8")))
        op = msg.get("op")
        if op == "createCapability":
            return self.create_capability(msg)
        if op == "checkCapability":
            return self.check_capability(msg)
        if op == "acquire":
            return self.acquire(msg)
        if op == "coreRecord":
            return self.record_core(msg)
        if op == "recipeRecord":
            return self.record_recipe(msg)
        if op == "modelRecord":
            return self.record_model(msg)
        if op == "finalize":
            return self.finalize(msg)
        return {"ok": False, "reason": "unknown_operation"}


def main():
    broker = Broker()
    while True:
        try:
            msg = read_message()
            if msg is None:
                return 0
            response = broker.handle(msg)
            write_message(response)
        except Exception as exc:
            write_message({"ok": False, "reason": f"host_error:{type(exc).__name__}"})


if __name__ == "__main__":
    raise SystemExit(main())
