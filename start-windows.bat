@echo off
chcp 65001 >nul
title CloudTune
cd /d "%~dp0"
set "CLOUDTUNE_NODE=%~dp0runtime\node.exe"
if exist "%CLOUDTUNE_NODE%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo 运行环境缺失，请下载完整便携包并解压全部文件。
  pause
  exit /b 1
)
set "CLOUDTUNE_NODE=node"
:run
if not exist node_modules\opencc-js (
  echo 依赖文件缺失，请重新解压完整便携包。
  pause
  exit /b 1
)
"%CLOUDTUNE_NODE%" network-bootstrap.js
if errorlevel 1 pause

