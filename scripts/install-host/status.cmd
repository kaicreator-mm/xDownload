@echo off
rem xDownload install status readback (Windows x64). Reports the live HKCU
rem Native Messaging registration (host manifest path) and the bound per-user
rem broker config (Core pipe namespace). Machine state is only read, never
rem changed.
node "%~dp0payload\native-host\xdownload-install-host.js" status
