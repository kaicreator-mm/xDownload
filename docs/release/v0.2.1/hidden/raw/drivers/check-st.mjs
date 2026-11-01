import { INSTALL_ID, USER_ID, PIPE, runCli } from './lib.mjs';
const r = runCli(['status', '--contract', process.argv[2], '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
const j = JSON.parse(r.stdout);
console.log(JSON.stringify({ stop: j.StopReason, rfs: j.RequestFulfillmentStatus, diag: j.diagnostics }, null, 1).slice(0, 900));
process.exit(0);
