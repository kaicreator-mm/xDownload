import hashlib, json
FIXTURE_BYTES=b"xDownload-E3-durable-artifact-v1\n"*128
BAD_BYTES=b"CORRUPTED-"+FIXTURE_BYTES[10:]
EXPECTED_DIGEST=hashlib.sha256(FIXTURE_BYTES).hexdigest()
SNAPSHOT={"contract_id":"contract-e3-001","snapshot_id":"snapshot-e3-001","selected_target_id":"target-e3-001","members":["target-e3-001"],"continuation_scope":"frozen-none"}
SNAPSHOT_JSON=json.dumps(SNAPSHOT,sort_keys=True,separators=(",",":"))
SNAPSHOT_DIGEST=hashlib.sha256(SNAPSHOT_JSON.encode()).hexdigest()
BUDGETS={"DiscoveryBudget":3,"TransferBudget":2,"GlobalSafetyBudget":4}
