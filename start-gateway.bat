@echo off
setlocal

set "PACKAGE_DIR=%~dp0"
set "CONFIG_FILE=%PACKAGE_DIR%config.json"
set "PROGRAM_FILE=%PACKAGE_DIR%llm-openai-gateway.js"
set "LOG_DIR=%PACKAGE_DIR%logs"

if /i not "%~1"=="--console" (
  start "LLM Gateway Logs" "%ComSpec%" /k call "%~f0" --console
  exit /b 0
)

rem Node.js writes UTF-8. Use the UTF-8 console code page so PowerShell
rem does not decode Chinese output using the legacy Windows code page.
chcp 65001 >nul

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "RUN_ID=%%T"
set "LOG_FILE=%LOG_DIR%\gateway-%RUN_ID%.log"

if not exist "%CONFIG_FILE%" (
  echo Missing config.json. Copy config.example.json to config.json first.
  exit /b 1
)

if not exist "%PROGRAM_FILE%" (
  echo Missing for dllm-openai-gateway.js.
  exit /b 1
)

for /f "usebackq tokens=*" %%A in (`node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); for (const [k,v] of Object.entries(c)) console.log(k+'='+String(v))" "%CONFIG_FILE%"`) do (
  for /f "tokens=1,* delims==" %%B in ("%%A") do (
    if /i "%%B"=="gatewayHost" set "LLM_GATEWAY_HOST=%%C"
    if /i "%%B"=="gatewayPort" set "LLM_GATEWAY_PORT=%%C"
    if /i "%%B"=="model" set "LLM_GATEWAY_MODEL=%%C"
    if /i "%%B"=="opencodePort" set "LLM_OPENCODE_PORT=%%C"
    if /i "%%B"=="reuseOpenCode" set "LLM_REUSE_OPENCODE=%%C"
    if /i "%%B"=="providerId" set "LLM_PROVIDER_ID=%%C"
  )
)

echo Starting LLM OpenAI gateway...
echo Log file: %LOG_FILE%
>>"%LOG_FILE%" echo Starting LLM OpenAI gateway...
>>"%LOG_FILE%" echo Log file: %LOG_FILE%
echo Base URL: http://%LLM_GATEWAY_HOST%:%LLM_GATEWAY_PORT%/v1
>>"%LOG_FILE%" echo Base URL: http://%LLM_GATEWAY_HOST%:%LLM_GATEWAY_PORT%/v1
echo Model: %LLM_GATEWAY_MODEL%
>>"%LOG_FILE%" echo Model: %LLM_GATEWAY_MODEL%
if /i "%LLM_REUSE_OPENCODE%"=="true" echo OpenCode: reuse existing server when available
if /i "%LLM_REUSE_OPENCODE%"=="true" >>"%LOG_FILE%" echo OpenCode: reuse existing server when available
node "%PROGRAM_FILE%" 2^>^&1 | powershell -NoProfile -Command "$utf8 = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false; [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; $writer = New-Object -TypeName System.IO.StreamWriter -ArgumentList '%LOG_FILE%', $true, $utf8; try { foreach ($line in $input) { $writer.WriteLine($line); Write-Output $line } } finally { $writer.Dispose() }"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Gateway stopped with exit code %EXIT_CODE%.
>>"%LOG_FILE%" echo Gateway stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
