@echo off
REM Gera o executavel portatil OrbitaUpdater.exe (rode em uma maquina Windows)
cd /d "%~dp0"

REM Acha um Python de verdade (o "python" da Microsoft Store e so um atalho vazio)
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if not defined PY (
    python -c "import sys" >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo Python nao encontrado. Instale com:
    echo   winget install -e --id Python.Python.3.12
    pause
    exit /b 1
)

REM Usa "python -m" para nao depender da pasta Scripts estar no PATH
%PY% -m pip install -r requirements.txt pyinstaller || goto :erro
%PY% -m PyInstaller --noconfirm --clean --onefile --noconsole --name OrbitaUpdater ^
    --hidden-import win11toast --collect-submodules winrt main.py || goto :erro

echo.
echo Executavel gerado em dist\OrbitaUpdater.exe
pause
exit /b 0

:erro
echo.
echo ERRO no build - veja as mensagens acima.
pause
exit /b 1
