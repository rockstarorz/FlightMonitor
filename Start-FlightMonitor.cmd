@echo off
setlocal
pushd "%~dp0" || exit /b 1
py -3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 goto run_python
echo FlightMonitor needs Python 3.8 or later.
echo Install Python from https://www.python.org/downloads/windows/ then try again.
pause
popd
exit /b 1

:run_py
py -3 launch.py
goto done

:run_python
python launch.py

:done
set "result=%errorlevel%"
if not "%result%"=="0" pause
popd
exit /b %result%
