import { killCoreByPidFile, logRun } from './lib.mjs';
const killed = killCoreByPidFile();
logRun({ event: 'teardown-core-killed', killed });
console.log(JSON.stringify({ coreKilled: killed }));
process.exit(0);
