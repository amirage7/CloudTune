@echo off
chcp 65001 >nul
title CloudTune - Install yt-dlp and FFmpeg
echo.
echo CloudTune V0.5 - Bilibili MP3 Tools Setup
echo.
echo This helper installs official yt-dlp and FFmpeg using Windows winget.
echo Read the program license and ensure you only download audio with permission.
echo.
where winget >nul 2>nul
if errorlevel 1 (
    echo winget was not found. Open README.md for manual installation.
    pause
    exit /b 1
)
choice /C YN /M "Install yt-dlp and FFmpeg now"
if errorlevel 2 exit /b 0
echo.
echo [1/2] Installing yt-dlp from winget ...
winget install --source winget --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements
if errorlevel 1 echo yt-dlp installation may have failed. See the instructions in README.md.
echo.
echo [2/2] Installing FFmpeg from winget ...
winget install --source winget --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
if errorlevel 1 echo FFmpeg installation may have failed. See the instructions in README.md.
echo.
echo Please CLOSE CloudTune and all command windows, then run start-windows.bat again.
echo Confirm "yt-dlp / FFmpeg ready" under Settings in the browser.
pause
