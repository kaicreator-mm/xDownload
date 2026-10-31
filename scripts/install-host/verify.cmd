@echo off
rem xDownload installer integrity readback. Re-hashes every file listed in
rem SHA256SUMS and compares with installer-identity.json. Exit 0 = the
rem extracted installer is byte-identical to the composed package; exit 2 =
rem tampered or incomplete; do NOT run install.cmd on a failed verification.
node "%~dp0verify-installer.mjs" "%~dp0."
