@echo off
setlocal
cd /d "%~dp0"
set "APP_MODE=local"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Python 3.10 or newer was not found in PATH.
    echo Install Python, then run this file again.
    pause
    exit /b 1
  )
  set "PY_CMD=python"
)

echo ================================================================
echo C2000 Config Studio for F28034 [R3 LOCAL]
echo The actual PID, port, and build ID are stored in generator\instance.json.
echo The browser opens only after /api/health confirms this build.
echo ================================================================
%PY_CMD% app.py
if errorlevel 1 (
  echo [ERROR] Config Studio exited with an error.
  pause
)
endlocal
