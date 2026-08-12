@echo off
cd /d "%~dp0"
echo ============================================
echo  Running tests with logging enabled
echo  Logs: tests\output\logs\
echo ============================================
echo.
python -m pytest tests -v %*
echo.
echo ============================================
echo  Done. Check tests\output\logs\ for log files
echo ============================================
pause
