import { INSTALL_ID, USER_ID, PIPE, runCli } from './lib.mjs';
const r = runCli(['status', '--contract', 'contract-s1-b2190cfc-ba70-40', '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
console.log(r.stdout.slice(0, 1200));
