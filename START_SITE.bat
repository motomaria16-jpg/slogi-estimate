@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000/"
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py --host 127.0.0.1 --port 8000
) else (
  python server.py --host 127.0.0.1 --port 8000
)
pause
