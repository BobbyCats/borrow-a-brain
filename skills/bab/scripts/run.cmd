@echo off
setlocal
if exist "%~dp0..\bin\bab.exe" goto native
where node.exe >nul 2>nul
if errorlevel 1 goto missing
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto missing
node.exe "%~dp0run.mjs" %*
exit /b %errorlevel%
:native
"%~dp0..\bin\bab.exe" %*
exit /b %errorlevel%
:missing
echo Borrow a Brain needs a compatible standalone package or Node.js 22+. Ask the installation agent to prepare it and retry. 1>&2
exit /b 78
