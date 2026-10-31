@echo off
rem xDownload T09 per-user install (Windows x64). Binds the exact browser-minted
rem extension origin, the canonical Windows-pipe Core namespace and the HKCU
rem Native Messaging registration. Never elevates, never overwrites an existing
rem registration (run uninstall.cmd first).
rem
rem Usage: install.cmd --extension-id <32-letter id from chrome://extensions> [options]
rem Options: --install-id <id>   install identity (default: xdownload)
rem          --user-id <id>      peer user id (default: sanitized OS username)
rem          --launch-core       start the single Core right after binding
if not exist "%~dp0payload\native-host\xdownload-install-host.js" (
  echo install.cmd: payload\native-host\xdownload-install-host.js not found; run from the extracted installer directory 1>&2
  exit /b 2
)
node "%~dp0payload\native-host\xdownload-install-host.js" setup %*
