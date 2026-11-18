@echo off
for %%B in ("Google\Chrome" "BraveSoftware\Brave-Browser" "Microsoft\Edge" "Chromium" "Vivaldi" "Mozilla") do (
  reg delete "HKCU\Software\%%~B\NativeMessagingHosts\com.pesu.downloader" /f >nul 2>&1
)
echo PESU Downloader helper unregistered.
pause
