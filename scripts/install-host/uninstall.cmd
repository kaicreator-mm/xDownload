@echo off
rem xDownload per-user uninstall (Windows x64). Removes the HKCU Native
rem Messaging registration and the per-user install files under
rem %USERPROFILE%\.xdownload\install; the extracted package directory is never
rem modified. Stop a running single Core (xdownload-core-start.cmd window)
rem before uninstalling.
node "%~dp0payload\native-host\xdownload-install-host.js" uninstall %*
