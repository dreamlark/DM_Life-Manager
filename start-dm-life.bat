@echo off
setlocal EnableExtensions

rem === DM Life launcher (single-backend): server + web-collab, sequential readiness, auto-open browser ===
rem Architecture: web-collab (Vite :5173) -> unified server (:4100, tRPC /trpc + WS /ws + health /health).
rem No engine process: personal domain + family sharing both live in server (ADR-006 single-backend).

rem Ports (edit if a port is already in use by something else)
set "SERVER_PORT=4100"
set "WEB_PORT=5173"

rem Project root = folder containing this .bat (strip trailing backslash)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOGDIR=%ROOT%\.logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

rem Create a desktop shortcut "DMlife" (3D floating anime icon); always overwrite to pick up icon updates
rem Icon cache flush: delete IconCache.db + restart explorer.exe (only reliable way to clear in-memory icon handles)
powershell -NoProfile -Command "$scp=Join-Path $env:USERPROFILE 'Desktop\DMlife.lnk'; $ico=Join-Path '%ROOT%' 'assets\DMlife.ico'; $shell=New-Object -ComObject WScript.Shell; $lnk=$shell.CreateShortcut($scp); $lnk.TargetPath=Join-Path '%ROOT%' 'start-dm-life.bat'; $lnk.WorkingDirectory='%ROOT%'; $lnk.IconLocation=$ico; $lnk.Description='DM Life'; $lnk.Save(); Write-Host '[DM Life] desktop shortcut DMlife.lnk created/updated'; Start-Sleep -Milliseconds 200; if(Test-Path $ico){ (Get-Item $ico).LastWriteTime=Get-Date }; $icdb=Join-Path $env:LOCALAPPDATA 'IconCache.db'; if(Test-Path $icdb){ Remove-Item $icdb -Force -ErrorAction SilentlyContinue; Write-Host '[DM Life] IconCache.db deleted' }; ie4uinit.exe -show 2>$null; Write-Host '[DM Life] icon cache refresh triggered'"

echo [DM Life] Freeing ports used by previous runs (if any) ...
call :killports

echo [DM Life] Starting unified server + web-collab (background, logs in .logs/) ...
start /b "" cmd /c "cd /d %ROOT%\packages\server && set PORT=%SERVER_PORT% && set PGLITE_DIR=%ROOT%\.collab-data && npm run start > %LOGDIR%\server.log 2>&1"
start /b "" cmd /c "cd /d %ROOT%\packages\web-collab && npm run dev -- --port %WEB_PORT% --strictPort > %LOGDIR%\web.log 2>&1"

echo [DM Life] Waiting for server (/health) + web ready ...
call :waitserver
call :waitweb

echo [DM Life] Frontend ready. Opening browser ...
start "" "http://localhost:%WEB_PORT%/"

echo.
echo [DM Life] Running in this single window. Press any key to stop all services.
pause >nul

echo [DM Life] Stopping services ...
call :killports
echo [DM Life] Done.
goto :eof

rem --- kill DM Life ports in ONE PowerShell process ---
:killports
powershell -NoProfile -Command "try { $ports = @(%SERVER_PORT%, %WEB_PORT%); $conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort -and $_.State -eq 'Listen' }; $procs = $conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pidVal in $procs) { try { $proc = Get-Process -Id $pidVal -ErrorAction Stop; taskkill /F /T /PID $pidVal 2>$null; if (Get-Process -Id $pidVal -ErrorAction SilentlyContinue) { Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue }; Write-Host ('[DM Life] killed PID ' + $pidVal + ' (' + $proc.ProcessName + ')') } catch {} }; Start-Sleep -Milliseconds 500; $still = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort -and $_.State -eq 'Listen' }; if ($still) { Write-Host '[DM Life] WARNING: some ports still occupied - may be orphan processes'; $still | ForEach-Object { Write-Host ('  port ' + $_.LocalPort + ' PID ' + $_.OwningProcess) } } } catch {}"
goto :eof

rem --- wait for unified server: poll /health until 200 (PGLite cold boot ~10-30s) ---
:waitserver
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 120; $i++){ try{ $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%SERVER_PORT%/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; if($r.StatusCode -eq 200){ $ok=$true; break } }catch{}; Start-Sleep -Milliseconds 500 }; if($ok){ Write-Host '[DM Life] server ready at http://127.0.0.1:%SERVER_PORT%/ (tRPC /trpc, WS /ws)' }else{ Write-Host '[DM Life] server TIMEOUT - check .logs\server.log' }"
goto :eof

rem --- wait for web dev server, then verify /health proxy reaches server ---
:waitweb
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 60; $i++){try{$t=New-Object System.Net.Sockets.TcpClient;$t.Connect('127.0.0.1', %WEB_PORT%);if($t.Connected){$t.Close();$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if(-not $ok){Write-Host '[DM Life] web TIMEOUT - check .logs\web.log';exit}; $proxy='http://127.0.0.1:%WEB_PORT%/health'; $ok=$false; for($i=0; $i -lt 60; $i++){try{$res=Invoke-WebRequest -Uri $proxy -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if($res.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if($ok){Write-Host '[DM Life] web + /health proxy ready'}else{Write-Host '[DM Life] web ready but /health proxy TIMEOUT - is server running? check .logs\server.log'}"
goto :eof
