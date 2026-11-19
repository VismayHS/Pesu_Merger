@echo off
rem Started from inside the ZIP? Windows then copies only this file to a temporary folder, so it cannot work.
if not exist "%~dp0install.ps1" goto zipped
echo "%~dp0" | findstr /i /c:"\AppData\Local\Temp\" >nul && goto zipped
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
exit /b

:zipped
echo.
echo   NOT FINISHED: this was opened from inside the ZIP file, so it cannot run.
echo.
echo   1. Close this window.
echo   2. In Downloads, right-click Pesu_Merger-main.zip and choose "Extract All...", then "Extract".
echo   3. In the folder that opens, go into native-host and double-click install.bat again.
echo.
pause
exit /b 1
