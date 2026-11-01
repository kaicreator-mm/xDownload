import { INSTALL_ID, USER_ID, PIPE, runCli } from './lib.mjs';
const digest = '31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be';
const r = runCli(['download', '--url', 'http://127.0.0.1:49651/file.bin',
  '--sha256', digest, '--total-bytes', '262144',
  '--timeout-ms', '60000', '--poll-ms', '200',
  '--pipe-name', PIPE, '--install-id', INSTALL_ID, '--user-id', USER_ID], { timeoutMs: 90000 });
console.log(JSON.stringify({ exit: r.exit, stdout: r.stdout.slice(0, 500), stderr: r.stderr.slice(0, 150) }));
process.exit(0);
