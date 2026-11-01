// Case 0: boot frozen Core host on t19h pipe (detached); smoke CLI status.
import { BASE, INSTALL_ID, USER_ID, PIPE, ensureCore, runCli, logRun } from './lib.mjs';
import path from 'node:path';

const { pid } = await ensureCore(path.join(BASE, 'core-root'), path.join(BASE, 'core.log'));
const st = runCli(['status', '--contract', 'contract-none', '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID]);
console.log(JSON.stringify({ event: 'case0-done', corePid: pid, exit: st.exit, stdout: st.stdout.slice(0, 300) }));
process.exit(0);
