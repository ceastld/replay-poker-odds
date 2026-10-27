#Requires -Version 5.1
<#
.SYNOPSIS
  Prepare Chrome to load Replay Poker 胜率浮层 locally (MV3 unpacked / --load-extension).

.PARAMETER ExtensionPath
  Absolute or relative path to the extension folder (contains manifest.json).
  Defaults to this script's directory.

.PARAMETER RestartChrome
  Stop all chrome.exe processes (with a clear warning), then start Chrome with --load-extension.
#>
[CmdletBinding()]
param(
  [string]$ExtensionPath = '',
  [switch]$RestartChrome
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) { Write-Host "[replay-poker-odds] $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "[replay-poker-odds] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "[replay-poker-odds] $msg" -ForegroundColor Red }

# ─── 1) Resolve extension path ───────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($ExtensionPath)) {
  $ExtensionPath = $PSScriptRoot
}
$ExtensionPath = [System.IO.Path]::GetFullPath($ExtensionPath)
$manifest = Join-Path $ExtensionPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifest)) {
  Write-Err "manifest.json not found under: $ExtensionPath"
  exit 1
}
Write-Info "Extension path: $ExtensionPath"

# ─── 2) Find chrome.exe ──────────────────────────────────────────────────
function Find-ChromeExe {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }

  # Registry: App Paths
  $regPaths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
  )
  foreach ($rp in $regPaths) {
    try {
      if (Test-Path -LiteralPath $rp) {
        $v = (Get-ItemProperty -LiteralPath $rp).'(default)'
        if ($v -and (Test-Path -LiteralPath $v)) { return $v }
      }
    } catch { }
  }

  # Uninstall keys sometimes hold InstallLocation
  $uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $uninstallRoots) {
    try {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          $props = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
          $dn = [string]$props.DisplayName
          if ($dn -match 'Google Chrome' -and $props.InstallLocation) {
            $exe = Join-Path $props.InstallLocation 'chrome.exe'
            if (Test-Path -LiteralPath $exe) { return $exe }
            $exe2 = Join-Path $props.InstallLocation 'Application\chrome.exe'
            if (Test-Path -LiteralPath $exe2) { return $exe2 }
          }
        } catch { }
      }
    } catch { }
  }
  return $null
}

$chromeExe = Find-ChromeExe
if (-not $chromeExe) {
  Write-Err 'chrome.exe not found. Install Google Chrome, or edit this script with the full path.'
  exit 1
}
Write-Info "Chrome: $chromeExe"

# ─── 3) Enable developer_mode in Default Preferences (careful JSON merge) ─
function Set-ChromeDeveloperMode {
  # Surgical text patch only — NEVER re-serialize the whole Preferences tree
  # (ConvertTo-Json can corrupt large ints / key order Chrome expects).
  $userData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  $prefsFile = Join-Path $userData 'Default\Preferences'
  if (-not (Test-Path -LiteralPath $prefsFile)) {
    Write-Warn "Preferences not found (Chrome may not have been launched yet): $prefsFile"
    Write-Warn 'Skip developer_mode toggle. You can still use --load-extension via the bat file,'
    Write-Warn 'or turn on 开发者模式 manually at chrome://extensions/'
    return $false
  }

  $chromeRunning = @(Get-Process -Name chrome -ErrorAction SilentlyContinue).Count -gt 0
  if ($chromeRunning) {
    Write-Warn 'Chrome is running. Preferences may be overwritten by Chrome on exit.'
    Write-Warn 'developer_mode will still be patched; if it does not stick, close Chrome and re-run, or toggle manually.'
  }

  try {
    $raw = [System.IO.File]::ReadAllText($prefsFile, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) {
      Write-Warn 'Preferences file is empty; skip.'
      return $false
    }

    $updated = $null
    if ($raw -match '"developer_mode"\s*:\s*true\b') {
      Write-Info 'extensions.ui.developer_mode already true'
      return $true
    }
    elseif ($raw -match '"developer_mode"\s*:\s*false\b') {
      $updated = [regex]::Replace($raw, '"developer_mode"\s*:\s*false\b', '"developer_mode":true', 1)
    }
    elseif ($raw -match '"extensions"\s*:\s*\{[^}]*"ui"\s*:\s*\{') {
      # Prefer extensions…ui pair: insert developer_mode into that ui object
      $updated = [regex]::Replace(
        $raw,
        '("extensions"\s*:\s*\{(?:(?!\}\s*,\s*"\w).)*?"ui"\s*:\s*\{)',
        '$1"developer_mode":true,',
        1
      )
      if ($updated -eq $raw) {
        # Simpler fallback: first ui after extensions key position
        $idx = $raw.IndexOf('"extensions"')
        if ($idx -ge 0) {
          $tail = $raw.Substring($idx)
          $patchedTail = [regex]::Replace($tail, '("ui"\s*:\s*\{)', '$1"developer_mode":true,', 1)
          if ($patchedTail -ne $tail) {
            $updated = $raw.Substring(0, $idx) + $patchedTail
          }
        }
      }
    }
    elseif ($raw -match '"extensions"\s*:\s*\{') {
      $updated = [regex]::Replace(
        $raw,
        '("extensions"\s*:\s*\{)',
        '$1"ui":{"developer_mode":true},',
        1
      )
    }
    else {
      # Last resort: append a top-level sibling before the final closing brace
      $trimmed = $raw.TrimEnd()
      if (-not $trimmed.EndsWith('}')) {
        Write-Warn 'Preferences does not look like a JSON object; skip developer_mode patch.'
        return $false
      }
      $without = $trimmed.Substring(0, $trimmed.Length - 1).TrimEnd()
      if ($without.EndsWith(',')) {
        $updated = $without + '"extensions":{"ui":{"developer_mode":true}}}'
      } else {
        $updated = $without + ',"extensions":{"ui":{"developer_mode":true}}}'
      }
    }

    if ($null -eq $updated -or $updated -eq $raw) {
      Write-Warn 'No Preferences change applied.'
      return $false
    }

    # Lightweight sanity: still starts with { and ends with }
    $t = $updated.Trim()
    if (-not ($t.StartsWith('{') -and $t.EndsWith('}'))) {
      Write-Warn 'Patched Preferences failed basic brace check; abort write.'
      return $false
    }

    $bak = $prefsFile + '.rp-odds.bak'
    if (-not (Test-Path -LiteralPath $bak)) {
      Copy-Item -LiteralPath $prefsFile -Destination $bak -Force
      Write-Info "Backup: $bak"
    }

    $tmp = $prefsFile + '.rp-odds.tmp'
    [System.IO.File]::WriteAllText($tmp, $updated, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $prefsFile -Force
    Write-Info 'Set extensions.ui.developer_mode = true (surgical patch)'
    return $true
  } catch {
    Write-Warn "Could not update Preferences: $($_.Exception.Message)"
    Write-Warn 'Open chrome://extensions/ and enable 开发者模式 manually.'
    return $false
  }
}

Set-ChromeDeveloperMode | Out-Null

# ─── 4) Create start-replay-chrome.bat ────────────────────────────────────
$batPath = Join-Path $ExtensionPath 'start-replay-chrome.bat'
# Quote extension path for Chrome; escape for cmd: wrap in double quotes
$extForCmd = $ExtensionPath
$chromeQuoted = '"' + $chromeExe + '"'
$loadArg = '--load-extension="' + $extForCmd + '"'

$batLines = @(
  '@echo off',
  'REM Auto-generated by install-chrome.ps1 — launches Chrome with Replay Poker odds extension',
  'REM DISPLAY ONLY: never auto-plays. Close other Chrome windows if the extension does not appear.',
  '',
  ('start "" {0} {1}' -f $chromeQuoted, $loadArg)
)
Set-Content -LiteralPath $batPath -Value ($batLines -join "`r`n") -Encoding ASCII
Write-Info "Wrote: $batPath"

# Optionally append to an existing user Chrome shortcut only if safe (Desktop shortcut named Google Chrome)
function Try-UpdateDesktopShortcut {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $candidates = @(
    (Join-Path $desktop 'Google Chrome.lnk'),
    (Join-Path $desktop 'Chrome.lnk')
  )
  $publicDesktop = Join-Path $env:PUBLIC 'Desktop'
  if (Test-Path -LiteralPath $publicDesktop) {
    $candidates += (Join-Path $publicDesktop 'Google Chrome.lnk')
  }

  $targetLnk = $null
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { $targetLnk = $c; break }
  }
  if (-not $targetLnk) {
    Write-Info 'No Desktop Chrome shortcut found; skipping shortcut edit (bat is enough).'
    return
  }

  try {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($targetLnk)
    $args = [string]$sc.Arguments
    # Only append if Arguments does not already contain load-extension for this path,
    # and does not already have a different --load-extension (avoid clobbering other ext packs).
    if ($args -match '--load-extension') {
      if ($args -like ("*{0}*" -f $ExtensionPath)) {
        Write-Info "Desktop shortcut already loads this extension: $targetLnk"
      } else {
        Write-Warn "Desktop shortcut already has --load-extension (different path). Leaving it unchanged: $targetLnk"
        Write-Warn 'Use start-replay-chrome.bat instead.'
      }
      return
    }
    $newArgs = ($args.Trim() + ' ' + $loadArg).Trim()
    $sc.Arguments = $newArgs
    $sc.Save()
    Write-Info "Appended --load-extension to Desktop shortcut: $targetLnk"
  } catch {
    Write-Warn "Could not update Desktop shortcut safely: $($_.Exception.Message)"
    Write-Warn 'Use start-replay-chrome.bat instead.'
  }
}

Try-UpdateDesktopShortcut

# ─── 5) Optional RestartChrome ────────────────────────────────────────────
if ($RestartChrome) {
  Write-Warn '=== -RestartChrome ==='
  Write-Warn 'This will STOP all chrome.exe processes (unsaved tabs may be lost), then start Chrome with --load-extension.'
  Write-Warn 'Press Ctrl+C within 5 seconds to cancel...'
  Start-Sleep -Seconds 5
  Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  Write-Info "Starting Chrome with --load-extension..."
  Start-Process -FilePath $chromeExe -ArgumentList @($loadArg)
} else {
  $running = @(Get-Process -Name chrome -ErrorAction SilentlyContinue).Count -gt 0
  if ($running) {
    Write-Warn 'Chrome is already running. --load-extension only applies to a NEW browser process.'
    Write-Warn 'Options: close Chrome and double-click start-replay-chrome.bat,'
    Write-Warn '         or load unpacked at chrome://extensions/,'
    Write-Warn '         or re-run: .\install-chrome.ps1 -RestartChrome'
  } else {
    Write-Info 'Chrome is not running. You can double-click start-replay-chrome.bat now.'
  }
}

Write-Host ''
Write-Info 'Done.'
Write-Info "Bat launcher: $batPath"
Write-Info 'Manual fallback: chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → select this folder.'
