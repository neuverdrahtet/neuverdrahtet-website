# JARVIS mit Hermes Agent - Installer fuer Windows 10/11 (PowerShell, keine Adminrechte noetig)
# Aufruf in PowerShell:
#   irm https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/claude/jarvis-hermes-setup-2nsqrk/jarvis/install.ps1 | iex
# Kann gefahrlos mehrfach laufen.

# 'Continue': PowerShell 5.1 wuerde sonst schon bei Warnungen externer Programme abbrechen.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Branch = if ($env:JARVIS_BRANCH) { $env:JARVIS_BRANCH } else { 'claude/jarvis-hermes-setup-2nsqrk' }
$Raw = "https://raw.githubusercontent.com/neuverdrahtet/neuverdrahtet-website/$Branch/jarvis"
$HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$HermesBinDir = Join-Path $HermesHome 'bin'
$JarvisHome = Join-Path $env:USERPROFILE '.jarvis'

function Step($t) { Write-Host "`n== $t ==" -ForegroundColor DarkYellow }
function Good($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t) { Write-Host "  $t" }

& {
  # ------------------------------------------------------------ 1. Hermes
  Step '1/8 Hermes Agent installieren'
  if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path (Join-Path $HermesBinDir 'hermes.exe'))) {
      Info 'Starte den offiziellen Installer von Nous Research ...'
      powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"
      if ($LASTEXITCODE -ne 0) { throw 'Hermes-Installation fehlgeschlagen (siehe oben).' }
    }
    $env:PATH = "$HermesBinDir;$env:PATH"
  }
  $cmd = Get-Command hermes -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'hermes nicht gefunden. Neues PowerShell-Fenster oeffnen und den Befehl erneut ausfuehren.' }
  $Hermes = $cmd.Source
  Good "Hermes: $(& $Hermes --version 2>$null | Select-Object -First 1)"

  # ------------------------------------------------------------ 2. ChatGPT-Abo
  Step '2/8 ChatGPT-Abo verbinden (OAuth) und Modell waehlen'
  $provider = (& $Hermes config get model.provider --raw 2>$null | Out-String).Trim()
  if ($provider -eq 'openai-codex' -and $env:JARVIS_RELOGIN -ne '1') {
    Good 'ChatGPT-Abo ist bereits verbunden (openai-codex).'
  } else {
    Info 'Gleich startet der Hermes-Modellassistent. Dort:'
    Info '  1. "ChatGPT or Codex Subscription" auswaehlen'
    Info '  2. Den angezeigten Link im Browser oeffnen, mit dem OpenAI-Konto anmelden'
    Info '     und den angezeigten Code eingeben'
    Info '  3. Ein gpt-6-...-Modell waehlen (z. B. gpt-6-sol), falls es angeboten wird.'
    Info '     Die Liste kommt live von OpenAI - was fehlt, ist fuer dein Abo nicht freigeschaltet.'
    Read-Host '  Enter druecken, um zu starten' | Out-Null
    & $Hermes model
  }
  $model = (& $Hermes config get model.default --raw 2>$null | Out-String).Trim()
  Info "Eingestelltes Modell: $model"
  Info 'Teste eine echte Antwort ...'
  $answer = (& $Hermes -z 'Antworte exakt mit diesem Satz und sonst nichts: JARVIS ist online.' 2>&1 | Out-String).Trim()
  Info "Antwort: $answer"
  if ($answer -notmatch 'online') { throw "Keine gueltige Antwort vom Modell. 'hermes model' erneut ausfuehren und Ausgabe an Claude schicken." }
  Good 'Modellzugriff funktioniert.'

  # ------------------------------------------------------------ Python von Hermes finden
  $py = $null
  $activate = Join-Path $HermesHome 'hermes-agent\activate.ps1'
  if (Test-Path $activate) {
    . $activate
    $ErrorActionPreference = 'Continue'
    $py = (Get-Command python -ErrorAction SilentlyContinue).Source
  }
  if (-not $py) {
    $py = Get-ChildItem $HermesHome -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\\.?venv\\Scripts\\python\.exe$' } |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $py) { throw 'Python von Hermes nicht gefunden. Bitte "hermes doctor" ausfuehren und Ausgabe an Claude schicken.' }

  # ------------------------------------------------------------ 3.-8. gemeinsame Einrichtung
  New-Item -ItemType Directory -Force -Path $JarvisHome | Out-Null
  $setup = Join-Path $JarvisHome 'jarvis_setup.py'
  Invoke-WebRequest "$Raw/jarvis_setup.py" -OutFile $setup -UseBasicParsing
  $env:HERMES_BIN = $Hermes
  $env:HERMES_HOME = $HermesHome
  $env:JARVIS_RAW = $Raw
  $env:PYTHONIOENCODING = 'utf-8'
  & $py $setup
  if ($LASTEXITCODE -ne 0) { Write-Host '  Einrichtung nicht abgeschlossen - bitte Ausgabe an Claude schicken.' -ForegroundColor Red }
}
